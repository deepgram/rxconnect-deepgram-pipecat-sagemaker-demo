"""
RxConnect Voice Agent Backend - FastAPI WebSocket Server
Handles: STT (Deepgram / SageMaker) → LLM (OpenAI with Function Calling) → TTS (Deepgram)
"""

import asyncio
import hashlib
import hmac
import json
import os
import base64
import secrets
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv(Path(__file__).parent / "config" / ".env", override=False)

from config import (
    STT_CONFIG,
    SAGEMAKER_CONFIG,
    TTS_CONFIG,
    LLM_CONFIG,
    PHARMACY_SYSTEM_PROMPT,
    TOOLS,
    GREETING,
    GOODBYE_PHRASES,
)

# ---------------------------------------------------------------------------
# Deepgram SDK + SageMaker transport
# ---------------------------------------------------------------------------
from deepgram import AsyncDeepgramClient
from deepgram.core.events import EventType

app = FastAPI(title="RxConnect Voice Agent API")

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
# WebSocket auth tokens
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
            WS_TOKEN_SECRET.encode(), f"{expires_str}:{nonce}".encode(), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

deepgram_api_key = os.getenv("DEEPGRAM_API_KEY")
if not deepgram_api_key:
    print("WARNING: DEEPGRAM_API_KEY not set - STT/TTS will not work!")
else:
    print(f"Deepgram API key loaded: {deepgram_api_key[:8]}...")

tts_client = AsyncDeepgramClient(api_key=deepgram_api_key)

USE_SAGEMAKER_STT = SAGEMAKER_CONFIG["enabled"]

if USE_SAGEMAKER_STT:
    print("Using SageMaker STT endpoint")
    from deepgram_sagemaker import SageMakerTransportFactory
    from deepgram.listen.v1.socket_client import AsyncV1SocketClient

    _sm_factory = SageMakerTransportFactory(
        endpoint_name=SAGEMAKER_CONFIG["endpoint_name"],
        region=SAGEMAKER_CONFIG["region"],
    )
else:
    print("Using Deepgram Cloud STT")
    stt_client = AsyncDeepgramClient(api_key=deepgram_api_key)

# ---------------------------------------------------------------------------
# Connection registry – tracks all active VoiceAgent sessions
# ---------------------------------------------------------------------------
active_sessions: dict[str, "VoiceAgent"] = {}
MAX_CONCURRENT_SESSIONS = 10

# ---------------------------------------------------------------------------
# Pharmacy data
# ---------------------------------------------------------------------------
DATA_FILE = Path(__file__).parent.parent / "data" / "pharmacy-order-data.json"


def normalize_id(id_raw):
    """Normalize IDs to handle transcription variations."""
    number_words = {
        "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
        "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    }
    normalized = id_raw.upper()
    for word, digit in number_words.items():
        normalized = normalized.replace(word.upper(), digit)
    normalized = normalized.replace(" ", "").replace("-", "").replace("_", "")
    return normalized


def load_pharmacy_data():
    """Load pharmacy order data from JSON file."""
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading pharmacy data: {e}")
        return []


def verify_member_id(member_id):
    member_id = normalize_id(member_id)
    orders = load_pharmacy_data()
    member_exists = any(normalize_id(o["member_id"]) == member_id for o in orders)
    if member_exists:
        return {"found": True, "member_id": member_id}
    return {"found": False, "member_id": member_id}


def list_member_orders(member_id):
    member_id = normalize_id(member_id)
    orders = load_pharmacy_data()
    member_orders = [
        {"order_id": o["order_id"], "status": o["status"]}
        for o in orders
        if normalize_id(o["member_id"]) == member_id
    ]
    if member_orders:
        return {
            "found": True,
            "member_id": member_id,
            "order_count": len(member_orders),
            "orders": member_orders,
        }
    return {"found": False, "member_id": member_id}


def get_order_details(**kwargs):
    order_id = normalize_id(kwargs["order_id"])
    member_id = normalize_id(kwargs["member_id"])
    orders = load_pharmacy_data()
    order = next((o for o in orders if normalize_id(o["order_id"]) == order_id), None)
    if order and normalize_id(order["member_id"]) == member_id:
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "status": order["status"],
            "prescriptions": order["prescriptions"],
        }
    elif order:
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def get_order_timing(**kwargs):
    order_id = normalize_id(kwargs["order_id"])
    member_id = normalize_id(kwargs["member_id"])
    orders = load_pharmacy_data()
    order = next((o for o in orders if normalize_id(o["order_id"]) == order_id), None)
    if order and normalize_id(order["member_id"]) == member_id:
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "status": order["status"],
            "timing": order["timing"],
        }
    elif order:
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def get_order_refills(**kwargs):
    order_id = normalize_id(kwargs["order_id"])
    member_id = normalize_id(kwargs["member_id"])
    orders = load_pharmacy_data()
    order = next((o for o in orders if normalize_id(o["order_id"]) == order_id), None)
    if order and normalize_id(order["member_id"]) == member_id:
        refills = [
            {
                "medication": rx["name"],
                "rx_id": rx["rx_id"],
                "refills_remaining": rx["refills_remaining"],
            }
            for rx in order["prescriptions"]
        ]
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "refills": refills,
        }
    elif order:
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def lookup_order_status(**kwargs):
    order_id = normalize_id(kwargs["order_id"])
    member_id = normalize_id(kwargs["member_id"])
    orders = load_pharmacy_data()
    order = next((o for o in orders if normalize_id(o["order_id"]) == order_id), None)
    if order:
        if normalize_id(order["member_id"]) == member_id:
            return {
                "found": True,
                "verified": True,
                "order_id": order["order_id"],
                "member_id": order["member_id"],
                "status": order["status"],
                "prescriptions": order["prescriptions"],
                "timing": order["timing"],
                "pharmacy": order["pharmacy"],
            }
        return {
            "found": True,
            "verified": False,
            "order_id": order_id,
            "member_id": member_id,
        }
    return {"found": False, "verified": False, "order_id": order_id}


FUNCTION_MAP = {
    "verify_member_id": lambda args: verify_member_id(**args),
    "list_member_orders": lambda args: list_member_orders(**args),
    "get_order_details": lambda args: get_order_details(**args),
    "get_order_timing": lambda args: get_order_timing(**args),
    "get_order_refills": lambda args: get_order_refills(**args),
    "lookup_order_status": lambda args: lookup_order_status(**args),
}


# ---------------------------------------------------------------------------
# Voice Agent
# ---------------------------------------------------------------------------
class VoiceAgent:
    def __init__(self, websocket: WebSocket, session_id: str):
        self.session_id = session_id
        self.websocket = websocket
        self.stt_connection = None
        self.conversation_history: list[dict] = []
        self.is_processing = False
        self._processing_lock = asyncio.Lock()
        self.current_member_id = None
        self.current_order_id = None

    def _log(self, msg: str):
        print(f"[{self.session_id}] {msg}")

    async def start_stt(self):
        """Initialize a per-session Deepgram STT connection."""
        try:
            if USE_SAGEMAKER_STT:
                query = "&".join(f"{k}={v}" for k, v in STT_CONFIG.items())
                url = f"wss://api.deepgram.com/v1/listen?{query}"
                transport = _sm_factory(url, {})
                self._sagemaker_transport = transport
                self.stt_connection = AsyncV1SocketClient(websocket=transport)
            else:
                self._stt_client = AsyncDeepgramClient(api_key=deepgram_api_key)
                self._stt_ctx = self._stt_client.listen.v1.connect(**STT_CONFIG)
                self.stt_connection = await self._stt_ctx.__aenter__()

            self.stt_connection.on(EventType.OPEN, self._on_stt_open)
            self.stt_connection.on(EventType.MESSAGE, self._on_stt_message)
            self.stt_connection.on(EventType.ERROR, self._on_stt_error)

            asyncio.create_task(self.stt_connection.start_listening())

            mode = "SageMaker" if USE_SAGEMAKER_STT else "Cloud"
            self._log(f"STT connected via {mode}")
            await self.send_status("connected", f"STT connected via {mode}")
        except Exception as e:
            await self.send_error(f"STT connection failed: {str(e)}")
            import traceback
            traceback.print_exc()

    async def _on_stt_open(self, _):
        self._log("STT connection opened")

    async def _on_stt_message(self, message):
        """Handle STT transcript and trigger LLM (serialised via lock)."""
        try:
            from deepgram.listen.v1.types import ListenV1Results

            if isinstance(message, ListenV1Results) and message.is_final:
                alternatives = message.channel.alternatives if message.channel else []
                transcript = alternatives[0].transcript if alternatives else ""
                self._log(f"STT transcript: '{transcript}' (is_processing={self.is_processing})")
                if transcript.strip() and not self.is_processing:
                    async with self._processing_lock:
                        if self.is_processing:
                            return
                        self.is_processing = True
                        try:
                            await self.send_transcript(transcript, "user")
                            await self.process_with_llm(transcript)
                        finally:
                            self.is_processing = False
        except Exception as e:
            await self.send_error(f"STT message error: {str(e)}")
            self.is_processing = False

    async def _on_stt_error(self, error):
        self._log(f"STT error: {str(error)}")
        await self.send_error(f"STT error: {str(error)}")

    async def process_audio_chunk(self, audio_data):
        """Send audio chunk to STT."""
        if self.stt_connection:
            try:
                await self.stt_connection.send_media(audio_data)
            except Exception as e:
                if not hasattr(self, "_last_audio_error") or (
                    asyncio.get_event_loop().time() - self._last_audio_error > 1
                ):
                    self._log(f"Audio send error: {str(e)}")
                    self._last_audio_error = asyncio.get_event_loop().time()

    def _build_system_prompt(self) -> str:
        """Build system prompt with dynamic session context injected."""
        context_lines: list[str] = []
        if self.current_member_id:
            context_lines.append(f"- The verified member ID for this call is: {self.current_member_id}")
        if self.current_order_id:
            context_lines.append(f"- The most recently discussed order ID is: {self.current_order_id}")
        if not context_lines:
            return PHARMACY_SYSTEM_PROMPT

        context_block = (
            "\n\n# CURRENT SESSION CONTEXT (use these when calling functions)\n"
            + "\n".join(context_lines)
            + "\nUse these IDs automatically when the customer asks follow-up questions "
            "without specifying an ID. Do NOT ask the customer to repeat them."
        )
        return PHARMACY_SYSTEM_PROMPT + context_block

    async def process_with_llm(self, user_text):
        """Process user text with OpenAI LLM with function calling."""
        try:
            await self.send_status("thinking", "Processing your request...")

            self.conversation_history.append({"role": "user", "content": user_text})

            if len(self.conversation_history) > 20:
                self.conversation_history = self.conversation_history[-20:]

            system_prompt = self._build_system_prompt()
            messages = [
                {"role": "system", "content": system_prompt}
            ] + self.conversation_history

            response = await openai_client.chat.completions.create(
                model=LLM_CONFIG["model"],
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                temperature=LLM_CONFIG["temperature"],
                max_tokens=LLM_CONFIG["max_tokens"],
            )

            assistant_message = response.choices[0].message

            if assistant_message.tool_calls:
                tool_results = []
                for tool_call in assistant_message.tool_calls:
                    function_name = tool_call.function.name
                    function_args = json.loads(tool_call.function.arguments)
                    self._log(f"Calling function: {function_name} with args: {function_args}")

                    if function_name in FUNCTION_MAP:
                        result = FUNCTION_MAP[function_name](function_args)
                        self._log(f"Function result: {result}")

                        if function_name == "verify_member_id" and result.get("found"):
                            self.current_member_id = result["member_id"]
                        if function_name == "list_member_orders" and result.get("found"):
                            orders = result.get("orders", [])
                            if len(orders) == 1:
                                self.current_order_id = orders[0]["order_id"]
                        if "order_id" in function_args:
                            self.current_order_id = function_args["order_id"]
                    else:
                        result = {"error": f"Unknown function: {function_name}"}

                    tool_results.append({
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "content": json.dumps(result),
                    })

                self.conversation_history.append({
                    "role": "assistant",
                    "content": assistant_message.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in assistant_message.tool_calls
                    ],
                })

                for tr in tool_results:
                    self.conversation_history.append(tr)

                system_prompt = self._build_system_prompt()
                messages = [
                    {"role": "system", "content": system_prompt}
                ] + self.conversation_history

                final_response = await openai_client.chat.completions.create(
                    model=LLM_CONFIG["model"],
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    temperature=LLM_CONFIG["temperature"],
                    max_tokens=LLM_CONFIG["max_tokens"],
                )

                final_message = final_response.choices[0].message

                while final_message.tool_calls:
                    self._log("Chained function call detected")
                    chained_results = []
                    for tool_call in final_message.tool_calls:
                        function_name = tool_call.function.name
                        function_args = json.loads(tool_call.function.arguments)
                        self._log(f"Calling chained function: {function_name} with args: {function_args}")

                        if function_name in FUNCTION_MAP:
                            result = FUNCTION_MAP[function_name](function_args)
                            self._log(f"Chained function result: {result}")

                            if function_name == "verify_member_id" and result.get("found"):
                                self.current_member_id = result["member_id"]
                            if function_name == "list_member_orders" and result.get("found"):
                                orders = result.get("orders", [])
                                if len(orders) == 1:
                                    self.current_order_id = orders[0]["order_id"]
                            if "order_id" in function_args:
                                self.current_order_id = function_args["order_id"]
                        else:
                            result = {"error": f"Unknown function: {function_name}"}

                        chained_results.append({
                            "tool_call_id": tool_call.id,
                            "role": "tool",
                            "content": json.dumps(result),
                        })

                    self.conversation_history.append({
                        "role": "assistant",
                        "content": final_message.content,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments,
                                },
                            }
                            for tc in final_message.tool_calls
                        ],
                    })

                    for cr in chained_results:
                        self.conversation_history.append(cr)

                    system_prompt = self._build_system_prompt()
                    messages = [
                        {"role": "system", "content": system_prompt}
                    ] + self.conversation_history

                    final_response = await openai_client.chat.completions.create(
                        model=LLM_CONFIG["model"],
                        messages=messages,
                        tools=TOOLS,
                        tool_choice="auto",
                        temperature=LLM_CONFIG["temperature"],
                        max_tokens=LLM_CONFIG["max_tokens"],
                    )
                    final_message = final_response.choices[0].message

                assistant_text = final_message.content
            else:
                assistant_text = assistant_message.content

            self.conversation_history.append(
                {"role": "assistant", "content": assistant_text}
            )

            self._log(f"Assistant response: {assistant_text}")
            await self.send_transcript(assistant_text, "assistant")

            self._log("Generating TTS...")
            await self.generate_tts(assistant_text)
            self._log("TTS completed")

            if assistant_text and any(phrase in assistant_text.lower() for phrase in GOODBYE_PHRASES):
                self._log("Goodbye detected - scheduling disconnect")
                await asyncio.sleep(1.5)
                await self.websocket.send_json({"type": "disconnect", "reason": "conversation_ended"})
                await self.websocket.close()
        except Exception as e:
            await self.send_error(f"LLM error: {str(e)}")
            import traceback
            traceback.print_exc()

    async def generate_tts(self, text):
        """Generate speech from text using Deepgram TTS."""
        if not text or not text.strip():
            self._log("TTS skipped: empty text")
            return
        try:
            await self.send_status("speaking", "Generating response...")
            self._log(f"TTS request for: '{text[:50]}...' (len={len(text)})")

            audio_chunks = []
            async for chunk in tts_client.speak.v1.audio.generate(
                text=text,
                model=TTS_CONFIG["model"],
                encoding=TTS_CONFIG["encoding"],
                sample_rate=TTS_CONFIG["sample_rate"],
            ):
                if chunk:
                    audio_chunks.append(chunk)

            self._log(f"TTS received {len(audio_chunks)} chunks")
            if audio_chunks:
                audio_data = b"".join(audio_chunks)
                self._log(f"TTS audio size: {len(audio_data)} bytes ({len(audio_data) / 32000:.2f} seconds at 16kHz)")
                audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                await self.websocket.send_json({
                    "type": "audio",
                    "data": audio_b64,
                    "sampleRate": TTS_CONFIG["sample_rate"],
                    "encoding": TTS_CONFIG["encoding"],
                })

            await self.send_status("ready", "Ready")
        except Exception as e:
            await self.send_error(f"TTS error: {str(e)}")
            import traceback
            traceback.print_exc()

    async def send_transcript(self, text, speaker):
        await self.websocket.send_json({
            "type": "transcript",
            "text": text,
            "speaker": speaker,
        })

    async def send_status(self, status, message):
        await self.websocket.send_json({
            "type": "status",
            "status": status,
            "message": message,
        })

    async def send_error(self, error):
        await self.websocket.send_json({
            "type": "error",
            "message": error,
        })
        self._log(f"ERROR: {error}")

    async def send_initial_greeting(self):
        try:
            self.conversation_history.append({
                "role": "assistant",
                "content": GREETING,
            })
            await self.send_transcript(GREETING, "assistant")
            await self.generate_tts(GREETING)
        except Exception as e:
            self._log(f"Error sending initial greeting: {e}")

    async def stop_stt(self):
        """Close STT connection."""
        if self.stt_connection:
            try:
                await self.stt_connection._send({"type": "Finalize"})
                if USE_SAGEMAKER_STT:
                    if hasattr(self, "_sagemaker_transport"):
                        await self._sagemaker_transport.close()
                else:
                    await self._stt_ctx.__aexit__(None, None, None)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
async def root():
    return {"message": "RxConnect Voice Agent API", "status": "running"}


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
        print(f"[{session_id}] Rejected – at capacity ({len(active_sessions)} active)")
        return

    await websocket.accept()
    agent = VoiceAgent(websocket, session_id)
    active_sessions[session_id] = agent
    print(f"[{session_id}] Connected (active sessions: {len(active_sessions)})")

    try:
        await agent.start_stt()
        await agent.send_initial_greeting()

        while True:
            data = await websocket.receive()

            if "bytes" in data:
                await agent.process_audio_chunk(data["bytes"])
            elif "text" in data:
                message = json.loads(data["text"])
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                elif message.get("type") == "stop_recording":
                    await agent.send_status("processing", "Processing...")
                elif message.get("type") == "reset":
                    agent.conversation_history = []
                    agent.current_member_id = None
                    agent.current_order_id = None
                    await agent.send_status("ready", "Conversation reset")
    except WebSocketDisconnect:
        agent._log("Client disconnected")
    except Exception as e:
        agent._log(f"WebSocket error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await agent.stop_stt()
        active_sessions.pop(session_id, None)
        print(f"[{session_id}] Cleaned up (active sessions: {len(active_sessions)})")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
