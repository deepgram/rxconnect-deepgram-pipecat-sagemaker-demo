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
import random
import secrets
import time
import uuid
import aiohttp
import websockets
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
)
from config.stt import USE_FLUX_STT

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

# Persistent TTS WebSocket connection for streaming TTS
_tts_ws: Optional[websockets.WebSocketClientProtocol] = None
_tts_ws_lock = asyncio.Lock()

async def get_tts_ws() -> websockets.WebSocketClientProtocol:
    """Get or create a persistent TTS WebSocket connection."""
    global _tts_ws
    async with _tts_ws_lock:
        if _tts_ws is not None:
            try:
                # Check if still open
                await _tts_ws.ping()
                return _tts_ws
            except Exception:
                _tts_ws = None
        
        # Create new connection
        model = TTS_CONFIG["model"]
        encoding = TTS_CONFIG["encoding"]
        sample_rate = TTS_CONFIG["sample_rate"]
        uri = f"wss://api.deepgram.com/v1/speak?model={model}&encoding={encoding}&sample_rate={sample_rate}"
        headers = {"Authorization": f"Token {deepgram_api_key}"}
        _tts_ws = await websockets.connect(uri, additional_headers=headers)
        return _tts_ws

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
_pharmacy_data_cache: Optional[list] = None
_pharmacy_data_cache_time: float = 0
DEMO_WEEK_DATES = [
    "2025-03-23",
    "2025-03-24",
    "2025-03-25",
    "2025-03-26",
    "2025-03-27",
]


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


def _levenshtein_distance(a: str, b: str) -> int:
    """Compute edit distance between two short strings."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i]
        for j, cb in enumerate(b, start=1):
            ins = curr[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            curr.append(min(ins, delete, sub))
        prev = curr
    return prev[-1]


def resolve_member_id(member_id_raw):
    """
    Resolve spoken/noisy member IDs to the closest known ID.
    Helps with STT/LLM artifacts like M100006 instead of M1006.
    """
    candidate = normalize_id(member_id_raw)
    orders = load_pharmacy_data()
    known_ids = sorted({normalize_id(o["member_id"]) for o in orders})

    if candidate in known_ids:
        return candidate

    # Common omission: user/model provides only digits.
    if candidate.isdigit():
        m_prefixed = f"M{candidate}"
        if m_prefixed in known_ids:
            return m_prefixed

    # Fuzzy correction: accept a unique close match only.
    best_id = None
    best_dist = 999
    tied = False
    for known in known_ids:
        dist = _levenshtein_distance(candidate, known)
        if dist < best_dist:
            best_dist = dist
            best_id = known
            tied = False
        elif dist == best_dist:
            tied = True

    if best_id and best_dist <= 2 and not tied:
        return best_id

    return candidate


def load_pharmacy_data():
    """Load pharmacy order data with in-memory caching."""
    global _pharmacy_data_cache, _pharmacy_data_cache_time
    now = time.time()
    if _pharmacy_data_cache is not None and (now - _pharmacy_data_cache_time) < 60:
        return _pharmacy_data_cache
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
            _pharmacy_data_cache = _normalize_dates_to_demo_week(data)
            _pharmacy_data_cache_time = now
            return _pharmacy_data_cache
    except Exception as e:
        print(f"Error loading pharmacy data: {e}")
        return []


def _looks_like_iso_date(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) >= 10
        and value[4] == "-"
        and value[7] == "-"
        and value[:4].isdigit()
        and value[5:7].isdigit()
        and value[8:10].isdigit()
    )


def _normalize_dates_to_demo_week(orders):
    """
    Remap all timing dates into the demo week (Mar 23-27) while preserving time.
    This keeps the data deterministic for demos without changing business logic.
    """
    for idx, order in enumerate(orders):
        timing = order.get("timing")
        if not isinstance(timing, dict):
            continue

        for offset, key in enumerate(sorted(timing.keys())):
            value = timing.get(key)
            if not value or not _looks_like_iso_date(value):
                continue

            # Preserve time portion if present (e.g. "T10:00:00").
            time_part = ""
            if "T" in value:
                _, time_part = value.split("T", 1)
                time_part = f"T{time_part}"

            mapped_date = DEMO_WEEK_DATES[(idx + offset) % len(DEMO_WEEK_DATES)]
            timing[key] = f"{mapped_date}{time_part}"

    return orders


def verify_member_id(member_id):
    member_id = resolve_member_id(member_id)
    orders = load_pharmacy_data()
    member_exists = any(normalize_id(o["member_id"]) == member_id for o in orders)
    if member_exists:
        return {"found": True, "member_id": member_id}
    return {"found": False, "member_id": member_id}


def list_member_orders(member_id):
    member_id = resolve_member_id(member_id)
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


def _resolve_member_order(order_id: str, member_id: str):
    """
    Resolve an order for a member. If the provided order_id is wrong but the member
    has exactly one order, use that order as a conversational fallback.
    """
    orders = load_pharmacy_data()
    member_orders = [o for o in orders if normalize_id(o["member_id"]) == member_id]
    matched = next((o for o in member_orders if normalize_id(o["order_id"]) == order_id), None)
    if matched:
        return matched, False
    if len(member_orders) == 1:
        return member_orders[0], True
    return None, False


def get_order_details(**kwargs):
    order_id = normalize_id(kwargs["order_id"])
    member_id = resolve_member_id(kwargs["member_id"])
    order, inferred = _resolve_member_order(order_id, member_id)
    if order:
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "status": order["status"],
            "prescriptions": order["prescriptions"],
            "resolved_order_from_member_context": inferred,
        }
    orders = load_pharmacy_data()
    if next((o for o in orders if normalize_id(o["order_id"]) == order_id), None):
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def get_order_timing(**kwargs):
    order_id = normalize_id(kwargs["order_id"])
    member_id = resolve_member_id(kwargs["member_id"])
    order, inferred = _resolve_member_order(order_id, member_id)
    if order:
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "status": order["status"],
            "timing": order["timing"],
            "resolved_order_from_member_context": inferred,
        }
    orders = load_pharmacy_data()
    if next((o for o in orders if normalize_id(o["order_id"]) == order_id), None):
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def get_order_refills(**kwargs):
    order_id = normalize_id(kwargs["order_id"])
    member_id = resolve_member_id(kwargs["member_id"])
    order, inferred = _resolve_member_order(order_id, member_id)
    if order:
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
            "resolved_order_from_member_context": inferred,
        }
    orders = load_pharmacy_data()
    if next((o for o in orders if normalize_id(o["order_id"]) == order_id), None):
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def lookup_order_status(**kwargs):
    order_id = normalize_id(kwargs["order_id"])
    member_id = resolve_member_id(kwargs["member_id"])
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


def end_session(**kwargs):
    """End session cleanly like Pipecat implementation"""
    return {"status": "ending", "message": "Session ended"}


FUNCTION_MAP = {
    "verify_member_id": lambda args: verify_member_id(**args),
    "list_member_orders": lambda args: list_member_orders(**args),
    "get_order_details": lambda args: get_order_details(**args),
    "get_order_timing": lambda args: get_order_timing(**args),
    "get_order_refills": lambda args: get_order_refills(**args),
    "lookup_order_status": lambda args: lookup_order_status(**args),
    "end_session": lambda args: end_session(**args),
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
        self._pending_transcript: str = ""
        self._pending_transcript_task: Optional[asyncio.Task] = None
        self._flux_current_turn: str = ""
        self._flux_turn_timer: Optional[asyncio.Task] = None

    def _log(self, msg: str):
        ts = time.strftime("%H:%M:%S", time.localtime())
        print(f"[{ts}] [{self.session_id}] {msg}")
    
    async def _close_after_delay(self, delay: float):
        """Clean session ending like Pipecat implementation"""
        try:
            await asyncio.sleep(delay)
            await self.websocket.close()
        except Exception as e:
            self._log(f"Close error: {e}")

    def _clear_pending_transcript_task(self):
        task = self._pending_transcript_task
        if task and not task.done():
            task.cancel()
        self._pending_transcript_task = None

    @staticmethod
    def _should_buffer_transcript(transcript: str) -> bool:
        """
        Heuristic to merge pause-split utterances before invoking the LLM.
        Example: "for another" + "member" should be one turn.
        """
        text = transcript.strip()
        if not text:
            return False
        words = text.split()
        has_digit = any(ch.isdigit() for ch in text)
        return len(words) <= 3 and not has_digit

    @staticmethod
    def _is_noise_transcript(transcript: str) -> bool:
        """
        Ignore common single-word STT artifacts from echo/bleed-through.
        """
        text = transcript.strip().lower()
        noise_tokens = {"your", "yours", "uh", "um", "hmm", "huh"}
        return text in noise_tokens

    @staticmethod
    def _buffer_delay_for_transcript(transcript: str) -> float:
        """
        Use a longer hold for fragments that likely continue after a pause.
        """
        words = transcript.strip().lower().split()
        if not words:
            return 0.9
        trailing_connectors = {
            "for", "another", "and", "or", "to", "of", "with", "about", "my", 
            "wife", "wifes", "husband", "husbands", "son", "sons", "daughter", 
            "daughters", "mom", "moms", "dad", "dads", "family", "patient", "patients"
        }
        if words[-1] in trailing_connectors:
            return 1.2  # Reduced from 1.8s
        if len(words) == 1:
            return 1.0  # Reduced from 1.5s
        return 0.6  # Reduced from 0.9s

    async def _process_user_transcript(self, transcript: str):
        if not transcript.strip():
            return
        if self.is_processing:
            return
        async with self._processing_lock:
            if self.is_processing:
                return
            self.is_processing = True
            try:
                await self.send_transcript(transcript, "user")
                await self.process_with_llm(transcript)
            finally:
                self.is_processing = False

    async def _flux_flush_turn(self, delay: float):
        """Debounce timer for Flux: process turn if no new partial arrives."""
        try:
            await asyncio.sleep(delay)
            transcript = self._flux_current_turn.strip()
            self._flux_current_turn = ""
            if transcript and not self._is_noise_transcript(transcript):
                self._log(f"STT [debounce]: '{transcript}'")
                await self._process_user_transcript(transcript)
        except asyncio.CancelledError:
            return

    async def _flush_pending_transcript_after_delay(self, delay_seconds: float = 0.9):
        try:
            await asyncio.sleep(delay_seconds)
            transcript = self._pending_transcript.strip()
            self._pending_transcript = ""
            self._pending_transcript_task = None
            if transcript:
                self._log(f"Flushing buffered transcript: '{transcript}'")
                await self._process_user_transcript(transcript)
        except asyncio.CancelledError:
            return

    async def start_stt(self):
        """Initialize a per-session Deepgram STT connection."""
        try:
            if USE_SAGEMAKER_STT:
                query = "&".join(f"{k}={v}" for k, v in STT_CONFIG.items())
                url = f"wss://api.deepgram.com/v1/listen?{query}"
                transport = _sm_factory(url, {})
                self._sagemaker_transport = transport
                self.stt_connection = AsyncV1SocketClient(websocket=transport)
            elif USE_FLUX_STT:
                # Flux: uses v2 endpoint for voice-agent-optimized STT
                self._stt_client = AsyncDeepgramClient(api_key=deepgram_api_key)
                self._stt_ctx = self._stt_client.listen.v2.connect(**STT_CONFIG)
                self.stt_connection = await self._stt_ctx.__aenter__()
            else:
                self._stt_client = AsyncDeepgramClient(api_key=deepgram_api_key)
                self._stt_ctx = self._stt_client.listen.v1.connect(**STT_CONFIG)
                self.stt_connection = await self._stt_ctx.__aenter__()

            self.stt_connection.on(EventType.OPEN, self._on_stt_open)
            self.stt_connection.on(EventType.MESSAGE, self._on_stt_message)
            self.stt_connection.on(EventType.ERROR, self._on_stt_error)

            asyncio.create_task(self.stt_connection.start_listening())

            mode = "Flux" if USE_FLUX_STT else ("SageMaker" if USE_SAGEMAKER_STT else "Nova-3")
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
            if USE_FLUX_STT:
                # Flux v2: accumulate turn transcript, process only on EndOfTurn
                msg_type = getattr(message, 'type', '')
                
                # Check for EndOfTurn signal — process the accumulated transcript
                if msg_type in ('EndOfTurn', 'end_of_turn'):
                    transcript = self._flux_current_turn.strip()
                    self._flux_current_turn = ""
                    # Cancel any pending flush timer
                    if self._flux_turn_timer and not self._flux_turn_timer.done():
                        self._flux_turn_timer.cancel()
                        self._flux_turn_timer = None
                    
                    if transcript and not self._is_noise_transcript(transcript):
                        self._log(f"STT [EndOfTurn]: '{transcript}'")
                        await self._process_user_transcript(transcript)
                    return
                
                # Accumulate transcript (Flux sends full turn text each time, so replace)
                transcript = getattr(message, 'transcript', '')
                if transcript and transcript.strip():
                    self._flux_current_turn = transcript.strip()
                    self._log(f"STT [partial]: '{self._flux_current_turn}'")
                    
                    # Reset debounce timer — if no EndOfTurn arrives within 800ms, flush
                    if self._flux_turn_timer and not self._flux_turn_timer.done():
                        self._flux_turn_timer.cancel()
                    self._flux_turn_timer = asyncio.create_task(
                        self._flux_flush_turn(0.8)
                    )
                return

            # Nova v1: final-based transcription
            from deepgram.listen.v1.types import ListenV1Results

            if isinstance(message, ListenV1Results) and message.is_final:
                alternatives = message.channel.alternatives if message.channel else []
                transcript = alternatives[0].transcript if alternatives else ""
                transcript = transcript.strip()
                if not transcript:
                    return
                if self._is_noise_transcript(transcript):
                    self._log(f"Ignoring noise transcript: '{transcript}'")
                    return
                self._log(f"STT transcript: '{transcript}' (is_processing={self.is_processing})")

                if self._pending_transcript:
                    combined = f"{self._pending_transcript} {transcript}".strip()
                    self._pending_transcript = ""
                    self._clear_pending_transcript_task()
                    self._log(f"Merged buffered transcript -> '{combined}'")
                    await self._process_user_transcript(combined)
                    return

                if self._should_buffer_transcript(transcript):
                    self._pending_transcript = transcript
                    self._clear_pending_transcript_task()
                    delay = self._buffer_delay_for_transcript(transcript)
                    self._pending_transcript_task = asyncio.create_task(
                        self._flush_pending_transcript_after_delay(delay)
                    )
                    self._log(f"Buffered short transcript ({delay:.1f}s): '{transcript}'")
                    return

                await self._process_user_transcript(transcript)
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
        if self.current_member_id:
            ctx = f"\nCurrent member: {self.current_member_id}"
            if self.current_order_id:
                ctx += f", order: {self.current_order_id}"
            return PHARMACY_SYSTEM_PROMPT + ctx
        return PHARMACY_SYSTEM_PROMPT

    def _get_safe_recent_history(self, max_messages: int) -> list:
        """Get recent history without orphaning tool results from their tool_calls."""
        history = self.conversation_history
        if len(history) <= max_messages:
            return list(history)
        
        # Start from the end and find a safe cut point
        start = len(history) - max_messages
        
        # Walk back until we find a 'user' message — safest cut point
        while start > 0:
            role = history[start].get("role", "")
            if role == "user":
                break
            start -= 1
        
        return list(history[start:])

    async def process_with_llm(self, user_text):
        """Process user text with OpenAI LLM with function calling."""
        try:
            # Skip status update for speed - go straight to processing
            # await self.send_status("thinking", "Processing your request...")

            self.conversation_history.append({"role": "user", "content": user_text})

            # Smart conversation trimming: keep recent context but never orphan tool results
            if len(self.conversation_history) > 10:
                self.conversation_history = self.conversation_history[-8:]

            system_prompt = self._build_system_prompt()
            # Build safe message window that never splits tool_calls from tool results
            recent = self._get_safe_recent_history(6)
            messages = [
                {"role": "system", "content": system_prompt}
            ] + recent

            response = await openai_client.chat.completions.create(
                model=LLM_CONFIG["model"],
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                temperature=LLM_CONFIG["temperature"],
                max_tokens=LLM_CONFIG["max_tokens"],
                stream=False,  # Explicit non-streaming for faster response
                top_p=0.8,     # Focus on high-probability tokens for speed
            )

            assistant_message = response.choices[0].message

            if assistant_message.tool_calls:
                # COMMENTED OUT: Send single acknowledgment before all function calls
                # acknowledgments = [
                #     "Please hold on a moment while I check that.",
                #     "Let me look that up for you.", 
                #     "Give me just a moment to check that.",
                #     "One moment while I find that information.",
                #     "Let me check that in the system.",
                # ]
                # ack_msg = random.choice(acknowledgments)
                # await self.send_transcript(ack_msg, "assistant")
                # await self.generate_tts(ack_msg)

                tool_results = []
                for tool_call in assistant_message.tool_calls:
                    function_name = tool_call.function.name
                    function_args = json.loads(tool_call.function.arguments)
                    self._log(f"Calling function: {function_name} with args: {function_args}")

                    if function_name in FUNCTION_MAP:
                        result = FUNCTION_MAP[function_name](function_args)
                        self._log(f"Function result: {result}")

                        if function_name == "verify_member_id" and result.get("found"):
                            if self.current_member_id and self.current_member_id != result["member_id"]:
                                self.current_order_id = None
                            self.current_member_id = result["member_id"]
                        elif function_name == "list_member_orders" and result.get("found"):
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
                # Use full history here — tool results must follow their tool_calls
                messages = [
                    {"role": "system", "content": system_prompt}
                ] + self.conversation_history

                # Stream the post-function LLM response for faster first sentence
                streamed_text = ""
                streamed_tool_calls = []
                stream = await openai_client.chat.completions.create(
                    model=LLM_CONFIG["model"],
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    temperature=LLM_CONFIG["temperature"],
                    max_tokens=LLM_CONFIG["max_tokens"],
                    stream=True,
                    top_p=0.8,
                )
                
                tts_ws = await get_tts_ws()
                first_sentence_sent = False
                self._streamed_tts = False
                sentence_buffer = ""
                llm_start = time.time()
                
                async for chunk in stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if not delta:
                        continue
                    
                    # Accumulate tool calls if any
                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            while len(streamed_tool_calls) <= tc.index:
                                streamed_tool_calls.append({"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                            if tc.id:
                                streamed_tool_calls[tc.index]["id"] = tc.id
                            if tc.function:
                                if tc.function.name:
                                    streamed_tool_calls[tc.index]["function"]["name"] = tc.function.name
                                if tc.function.arguments:
                                    streamed_tool_calls[tc.index]["function"]["arguments"] += tc.function.arguments
                    
                    # Accumulate text content
                    if delta.content:
                        streamed_text += delta.content
                        sentence_buffer += delta.content
                        
                        # Check for sentence boundary — send to TTS immediately
                        import re
                        if re.search(r'[.!?]\s*$', sentence_buffer) and not first_sentence_sent:
                            first_sentence_ms = (time.time() - llm_start) * 1000
                            self._log(f"LLM first sentence in {first_sentence_ms:.0f}ms: '{sentence_buffer.strip()[:50]}...'")
                            await tts_ws.send(json.dumps({"type": "Speak", "text": sentence_buffer.strip()}))
                            sentence_buffer = ""
                            first_sentence_sent = True
                            self._streamed_tts = True
                
                # Send any remaining text to TTS
                if sentence_buffer.strip():
                    await tts_ws.send(json.dumps({"type": "Speak", "text": sentence_buffer.strip()}))
                    self._streamed_tts = True
                
                # Build a message-like object for compatibility
                class _StreamedMessage:
                    def __init__(self, content, tool_calls):
                        self.content = content
                        self.tool_calls = tool_calls
                
                # Convert accumulated tool calls into proper objects if any
                final_tool_calls = None
                if streamed_tool_calls and streamed_tool_calls[0]["id"]:
                    class _TC:
                        def __init__(self, d):
                            self.id = d["id"]
                            self.function = type('F', (), {"name": d["function"]["name"], "arguments": d["function"]["arguments"]})()
                    final_tool_calls = [_TC(tc) for tc in streamed_tool_calls]
                
                final_message = _StreamedMessage(streamed_text or None, final_tool_calls)

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
                                if self.current_member_id and self.current_member_id != result["member_id"]:
                                    self.current_order_id = None
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
                    # Use full history here — tool results must follow their tool_calls
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
                        stream=False,
                        top_p=0.8,
                    )
                    final_message = final_response.choices[0].message

                assistant_text = final_message.content
            else:
                assistant_text = assistant_message.content
                self._streamed_tts = False  # No streaming for direct responses

            self.conversation_history.append(
                {"role": "assistant", "content": assistant_text}
            )

            self._log(f"Assistant response: {assistant_text}")
            await self.send_transcript(assistant_text, "assistant")

            # If sentences were already streamed to TTS during LLM streaming,
            # just flush and collect audio. Otherwise use pipelined TTS.
            if hasattr(self, '_streamed_tts') and self._streamed_tts:
                self._log("TTS: flushing streamed sentences...")
                tts_ws = await get_tts_ws()
                await tts_ws.send(json.dumps({"type": "Flush"}))
                
                audio_chunks = []
                tts_start = time.time()
                first_chunk_time = None
                while True:
                    msg = await asyncio.wait_for(tts_ws.recv(), timeout=15.0)
                    if isinstance(msg, bytes):
                        if first_chunk_time is None:
                            first_chunk_time = (time.time() - tts_start) * 1000
                            self._log(f"TTS first audio chunk: {first_chunk_time:.1f}ms")
                        audio_chunks.append(msg)
                    else:
                        data = json.loads(msg)
                        if data.get("type") == "Flushed":
                            break
                
                if audio_chunks:
                    audio_data = b"".join(audio_chunks)
                    self._log(f"TTS completed: {(time.time() - tts_start)*1000:.1f}ms, {len(audio_data)} bytes")
                    audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                    await self.websocket.send_json({
                        "type": "audio",
                        "data": audio_b64,
                        "sampleRate": TTS_CONFIG["sample_rate"],
                        "encoding": TTS_CONFIG["encoding"],
                    })
            else:
                self._log("Generating TTS (pipelined)...")
                await self.generate_tts_pipelined(assistant_text)
            self._log("TTS completed")

        except Exception as e:
            await self.send_error(f"LLM error: {str(e)}")
            import traceback
            traceback.print_exc()

    @staticmethod
    def _split_sentences(text: str) -> list[str]:
        """Split text into sentences for pipelined TTS."""
        import re
        # Split on sentence-ending punctuation followed by space or end
        parts = re.split(r'(?<=[.!?])\s+', text.strip())
        return [p.strip() for p in parts if p.strip()]

    async def generate_tts_pipelined(self, text):
        """Pipeline TTS: send each sentence to TTS WebSocket immediately.
        
        Deepgram's streaming TTS WebSocket queues Speak messages internally,
        so we send all sentences rapidly, then Flush once. Audio for the first
        sentence starts generating immediately while later sentences queue.
        """
        if not text or not text.strip():
            self._log("TTS skipped: empty text")
            return
        try:
            start_time = time.time()
            sentences = self._split_sentences(text)
            self._log(f"TTS pipelined: {len(sentences)} sentence(s)")
            
            tts_ws = await get_tts_ws()
            
            # Send all sentences to the TTS WebSocket buffer immediately
            for sentence in sentences:
                await tts_ws.send(json.dumps({"type": "Speak", "text": sentence}))
            
            # Single Flush triggers generation of all queued text
            await tts_ws.send(json.dumps({"type": "Flush"}))
            
            # Collect all audio chunks until Flushed
            audio_chunks = []
            first_chunk_time = None
            while True:
                msg = await asyncio.wait_for(tts_ws.recv(), timeout=15.0)
                if isinstance(msg, bytes):
                    if first_chunk_time is None:
                        first_chunk_time = (time.time() - start_time) * 1000
                        self._log(f"TTS first audio chunk: {first_chunk_time:.1f}ms")
                    audio_chunks.append(msg)
                else:
                    data = json.loads(msg)
                    if data.get("type") == "Flushed":
                        break

            if audio_chunks:
                audio_data = b"".join(audio_chunks)
                tts_time = (time.time() - start_time) * 1000
                self._log(f"TTS completed: {tts_time:.1f}ms, {len(audio_data)} bytes")
                
                audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                await self.websocket.send_json({
                    "type": "audio",
                    "data": audio_b64,
                    "sampleRate": TTS_CONFIG["sample_rate"],
                    "encoding": TTS_CONFIG["encoding"],
                })

        except Exception as e:
            global _tts_ws
            _tts_ws = None
            await self.send_error(f"TTS pipeline error: {str(e)}")
            import traceback
            traceback.print_exc()

    async def generate_tts(self, text):
        """Generate speech using Deepgram streaming TTS WebSocket for lowest latency."""
        if not text or not text.strip():
            self._log("TTS skipped: empty text")
            return
        try:
            start_time = time.time()
            self._log(f"TTS request for: '{text[:50]}...' (len={len(text)})")

            tts_ws = await get_tts_ws()
            
            # Send text and flush to trigger immediate generation
            await tts_ws.send(json.dumps({"type": "Speak", "text": text}))
            await tts_ws.send(json.dumps({"type": "Flush"}))
            
            # Collect audio chunks until Flushed message
            audio_chunks = []
            first_chunk_time = None
            while True:
                msg = await asyncio.wait_for(tts_ws.recv(), timeout=10.0)
                if isinstance(msg, bytes):
                    if first_chunk_time is None:
                        first_chunk_time = (time.time() - start_time) * 1000
                        self._log(f"TTS first audio chunk: {first_chunk_time:.1f}ms")
                    audio_chunks.append(msg)
                else:
                    data = json.loads(msg)
                    if data.get("type") == "Flushed":
                        break

            if audio_chunks:
                audio_data = b"".join(audio_chunks)
                tts_time = (time.time() - start_time) * 1000
                self._log(f"TTS completed: {tts_time:.1f}ms, {len(audio_data)} bytes")
                
                audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                await self.websocket.send_json({
                    "type": "audio",
                    "data": audio_b64,
                    "sampleRate": TTS_CONFIG["sample_rate"],
                    "encoding": TTS_CONFIG["encoding"],
                })

        except Exception as e:
            # Reset TTS connection on error
            global _tts_ws
            _tts_ws = None
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
        self._clear_pending_transcript_task()
        self._pending_transcript = ""
        if self.stt_connection:
            try:
                if not USE_FLUX_STT:
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
    except RuntimeError as e:
        if 'Cannot call "receive" once a disconnect message has been received.' in str(e):
            agent._log("WebSocket closed after disconnect message")
        else:
            agent._log(f"WebSocket runtime error: {e}")
            import traceback
            traceback.print_exc()
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
