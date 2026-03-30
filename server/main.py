"""
RxConnect Voice Agent Backend — Pipecat Pipeline Edition
========================================================

Orchestrates a real-time voice-agent pipeline using Pipecat:

    Audio In → Deepgram STT → OpenAI LLM (with pharmacy tools) → Deepgram TTS → Audio Out

Supports two STT paths:
  • **Deepgram Cloud** – direct WebSocket to Deepgram
  • **AWS SageMaker**  – same Deepgram model hosted on a SageMaker endpoint
                         via ``DeepgramSageMakerSTTService``

The browser client (React / ``useVoiceConnection.ts``) speaks a custom
WebSocket protocol (binary PCM in, JSON text out).  A custom
``RxConnectFrameSerializer`` translates between that wire format and
Pipecat frames so ``FastAPIWebsocketTransport`` can drive the pipeline.

See ``server/main_backup.py`` for the previous hand-rolled implementation.
"""

import hashlib
import hmac
import os
import secrets
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from loguru import logger

# ---------------------------------------------------------------------------
# Pipecat core
# ---------------------------------------------------------------------------
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.frames.frames import (
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    TTSSpeakFrame,
)
# ---------------------------------------------------------------------------
# Pipecat services
# ---------------------------------------------------------------------------
from pipecat.services.deepgram.stt import DeepgramSTTService, LiveOptions
from pipecat.services.deepgram.tts import DeepgramTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext

# ---------------------------------------------------------------------------
# Pipecat transport
# ---------------------------------------------------------------------------
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

# ---------------------------------------------------------------------------
# Local modules
# ---------------------------------------------------------------------------
from services.serializer import RxConnectFrameSerializer
from services.processors import (
    AssistantTranscriptAccumulator,
    AudioAccumulator,
    UserTranscriptForwarder,
)
from services.pharmacy import (
    load_pharmacy_data,
    verify_member_id,
    list_member_orders,
    get_order_details,
    get_order_timing,
    get_order_refills,
    lookup_order_status,
    end_session,
)
from pipecat.services.llm_service import FunctionCallParams

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
load_dotenv(Path(__file__).parent / "config" / ".env", override=False)

from config import (
    SAGEMAKER_CONFIG,
    TTS_CONFIG,
    LLM_CONFIG,
    PHARMACY_SYSTEM_PROMPT,
    TOOLS,
    GREETING,
)

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
app = FastAPI(title="RxConnect Voice Agent API – Pipecat")

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ---------------------------------------------------------------------------
# WebSocket auth tokens (unchanged from original)
# ---------------------------------------------------------------------------
WS_TOKEN_SECRET = os.getenv("WS_TOKEN_SECRET", secrets.token_hex(32))
WS_TOKEN_TTL = int(os.getenv("WS_TOKEN_TTL", "60"))


def _create_ws_token() -> str:
    expires = int(time.time()) + WS_TOKEN_TTL
    nonce = secrets.token_hex(8)
    payload = f"{expires}:{nonce}"
    sig = hmac.new(WS_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _verify_ws_token(token: str) -> bool:
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return False
        expires_str, nonce, sig = parts
        if int(expires_str) < int(time.time()):
            return False
        expected = hmac.new(
            WS_TOKEN_SECRET.encode(),
            f"{expires_str}:{nonce}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Session registry
# ---------------------------------------------------------------------------
active_sessions: dict[str, PipelineTask] = {}
MAX_CONCURRENT_SESSIONS = 10

# ---------------------------------------------------------------------------
# STT configuration flag
# ---------------------------------------------------------------------------
USE_SAGEMAKER_STT = SAGEMAKER_CONFIG["enabled"]

# ---------------------------------------------------------------------------
# Pipeline factory — one pipeline per WebSocket session
# ---------------------------------------------------------------------------


def _build_system_prompt(session_state: dict) -> str:
    """Build system prompt with dynamic session context."""
    prompt = PHARMACY_SYSTEM_PROMPT
    if session_state.get("member_id"):
        prompt += f"\nCurrent member: {session_state['member_id']}"
        if session_state.get("order_id"):
            prompt += f", order: {session_state['order_id']}"
    return prompt


async def _create_pipeline(
    websocket: WebSocket,
    session_id: str,
) -> tuple[PipelineTask, PipelineRunner]:
    """Build a Pipecat pipeline for one voice-agent session."""

    # ── Transport ──────────────────────────────────────────────────────
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            vad_enabled=True,
            vad_audio_passthrough=True,
            serializer=RxConnectFrameSerializer(),
        ),
        input_name="RxConnect-in",
        output_name="RxConnect-out",
    )

    # ── STT ────────────────────────────────────────────────────────────
    if USE_SAGEMAKER_STT:
        from services.deepgram_sagemaker_stt import DeepgramSageMakerSTTService

        stt = DeepgramSageMakerSTTService(
            endpoint_name=SAGEMAKER_CONFIG["endpoint_name"],
            region=SAGEMAKER_CONFIG["region"],
            live_options=LiveOptions(
                model="nova-3",
                encoding="linear16",
                sample_rate=16000,
                channels=1,
                smart_format=False,
            ),
        )
        logger.info(f"[{session_id}] STT: SageMaker ({SAGEMAKER_CONFIG['endpoint_name']})")
    else:
        stt = DeepgramSTTService(
            api_key=os.getenv("DEEPGRAM_API_KEY", ""),
            live_options=LiveOptions(
                model="nova-3",
                encoding="linear16",
                sample_rate=16000,
                channels=1,
                smart_format=False,
                interim_results=True,
                endpointing=300,
            ),
        )
        logger.info(f"[{session_id}] STT: Deepgram Cloud (nova-3)")

    # ── LLM ────────────────────────────────────────────────────────────
    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY", ""),
        model=LLM_CONFIG["model"],
        params=OpenAILLMService.InputParams(
            temperature=LLM_CONFIG["temperature"],
            max_tokens=LLM_CONFIG["max_tokens"],
            top_p=0.8,
        ),
    )

    # ── Session state (captured by function handler closures) ──────────
    session_state: dict = {"member_id": None, "order_id": None}

    # ── Register pharmacy tool handlers ────────────────────────────────

    async def _on_verify_member_id(params: FunctionCallParams):
        result = verify_member_id(**params.arguments)
        if result.get("found"):
            if session_state["member_id"] and session_state["member_id"] != result["member_id"]:
                session_state["order_id"] = None
            session_state["member_id"] = result["member_id"]
            # Update system prompt in context with new member info
            if params.context.messages and params.context.messages[0]["role"] == "system":
                params.context.messages[0]["content"] = _build_system_prompt(session_state)
        logger.info(f"[{session_id}] verify_member_id → {result}")
        await params.result_callback(result)

    async def _on_list_member_orders(params: FunctionCallParams):
        result = list_member_orders(**params.arguments)
        if result.get("found"):
            orders = result.get("orders", [])
            if len(orders) == 1:
                session_state["order_id"] = orders[0]["order_id"]
        logger.info(f"[{session_id}] list_member_orders → {result}")
        await params.result_callback(result)

    async def _on_get_order_details(params: FunctionCallParams):
        if "order_id" in params.arguments:
            session_state["order_id"] = params.arguments["order_id"]
        result = get_order_details(**params.arguments)
        logger.info(f"[{session_id}] get_order_details → {result}")
        await params.result_callback(result)

    async def _on_get_order_timing(params: FunctionCallParams):
        if "order_id" in params.arguments:
            session_state["order_id"] = params.arguments["order_id"]
        result = get_order_timing(**params.arguments)
        logger.info(f"[{session_id}] get_order_timing → {result}")
        await params.result_callback(result)

    async def _on_get_order_refills(params: FunctionCallParams):
        if "order_id" in params.arguments:
            session_state["order_id"] = params.arguments["order_id"]
        result = get_order_refills(**params.arguments)
        logger.info(f"[{session_id}] get_order_refills → {result}")
        await params.result_callback(result)

    async def _on_lookup_order_status(params: FunctionCallParams):
        if "order_id" in params.arguments:
            session_state["order_id"] = params.arguments["order_id"]
        result = lookup_order_status(**params.arguments)
        logger.info(f"[{session_id}] lookup_order_status → {result}")
        await params.result_callback(result)

    async def _on_end_session(params: FunctionCallParams):
        result = end_session(**params.arguments)
        logger.info(f"[{session_id}] end_session → {result}")
        await params.result_callback(result)

    llm.register_function("verify_member_id", _on_verify_member_id)
    llm.register_function("list_member_orders", _on_list_member_orders)
    llm.register_function("get_order_details", _on_get_order_details)
    llm.register_function("get_order_timing", _on_get_order_timing)
    llm.register_function("get_order_refills", _on_get_order_refills)
    llm.register_function("lookup_order_status", _on_lookup_order_status)
    llm.register_function("end_session", _on_end_session)

    # ── LLM context (conversation memory + tools) ─────────────────────
    context = OpenAILLMContext(
        messages=[
            {"role": "system", "content": PHARMACY_SYSTEM_PROMPT},
            {"role": "assistant", "content": GREETING},
        ],
        tools=TOOLS,
    )
    context_aggregator = llm.create_context_aggregator(context)

    # ── TTS ────────────────────────────────────────────────────────────
    tts = DeepgramTTSService(
        api_key=os.getenv("DEEPGRAM_API_KEY", ""),
        voice=TTS_CONFIG["model"],
        sample_rate=TTS_CONFIG["sample_rate"],
        encoding="linear16",
    )
    logger.info(f"[{session_id}] TTS: Deepgram ({TTS_CONFIG['model']})")

    # ── Custom processors ──────────────────────────────────────────────
    user_transcript_fwd = UserTranscriptForwarder()
    assistant_transcript_acc = AssistantTranscriptAccumulator()
    audio_acc = AudioAccumulator()

    # ── Pipeline ───────────────────────────────────────────────────────
    #
    #   Audio In ─┐
    #             ▼
    #           STT
    #             │
    #   UserTranscriptForwarder ──(sends {"type":"transcript","speaker":"user"})
    #             │
    #   context_aggregator.user()
    #             │
    #           LLM  ←──── tool calls handled automatically
    #             │
    #   AssistantTranscriptAccumulator ──(sends {"type":"transcript","speaker":"assistant"})
    #             │
    #           TTS
    #             │
    #   AudioAccumulator ──(buffers chunks into one blob)
    #             │
    #   Audio Out ┘
    #             │
    #   context_aggregator.assistant()
    #
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_transcript_fwd,
            context_aggregator.user(),
            llm,
            assistant_transcript_acc,
            tts,
            audio_acc,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    # ── Task + runner ──────────────────────────────────────────────────
    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True),
    )
    runner = PipelineRunner()

    # ── Initial greeting ───────────────────────────────────────────────
    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, ws):
        logger.info(f"[{session_id}] Client connected – sending greeting")
        await task.queue_frames(
            [
                OutputTransportMessageUrgentFrame(
                    message={
                        "type": "transcript",
                        "text": GREETING,
                        "speaker": "assistant",
                    }
                ),
                TTSSpeakFrame(text=GREETING),
                OutputTransportMessageUrgentFrame(
                    message={
                        "type": "status",
                        "status": "connected",
                        "message": "Listening",
                    }
                ),
            ]
        )

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, ws):
        logger.info(f"[{session_id}] Client disconnected")
        await task.cancel()

    return task, runner


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"message": "RxConnect Voice Agent API (Pipecat)", "status": "running"}


@app.get("/api/pharmacy-data")
async def pharmacy_data():
    return load_pharmacy_data()


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "active_sessions": len(active_sessions),
        "max_sessions": MAX_CONCURRENT_SESSIONS,
    }


@app.post("/api/token")
async def issue_ws_token():
    return {"token": _create_ws_token()}


# ---------------------------------------------------------------------------
# WebSocket endpoint — one Pipecat pipeline per connection
# ---------------------------------------------------------------------------

@app.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket, token: str = Query("")):
    if not _verify_ws_token(token):
        await websocket.close(code=4401, reason="Invalid or expired token")
        return

    session_id = uuid.uuid4().hex[:8]

    if len(active_sessions) >= MAX_CONCURRENT_SESSIONS:
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "message": "Server is at capacity. Please try again later.",
        })
        await websocket.close()
        logger.warning(f"[{session_id}] Rejected – at capacity ({len(active_sessions)} active)")
        return

    await websocket.accept()
    logger.info(f"[{session_id}] Connected (active sessions: {len(active_sessions) + 1})")

    try:
        task, runner = await _create_pipeline(websocket, session_id)
        active_sessions[session_id] = task
        await runner.run(task)
    except Exception as e:
        logger.error(f"[{session_id}] Pipeline error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        active_sessions.pop(session_id, None)
        logger.info(f"[{session_id}] Cleaned up (active sessions: {len(active_sessions)})")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
