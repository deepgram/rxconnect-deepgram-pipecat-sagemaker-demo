"""
=============================================================================
RxConnect Voice Agent Demo
=============================================================================

This demo shows how to build a real-time voice AI agent using:
- Deepgram STT (Speech-to-Text) via SageMaker Bidirectional Streaming
- LLM (OpenAI GPT-4 or Amazon Bedrock) with Function Calling
- Deepgram TTS (Text-to-Speech) via SageMaker
- Pipecat for orchestration

Architecture:
    User Audio -> Deepgram STT -> LLM + Functions -> Deepgram TTS -> Audio Response

All components can run within an AWS VPC for enterprise security/compliance.
"""

import asyncio
import json
import os
import base64
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from openai import AsyncOpenAI

# =============================================================================
# CONFIGURATION
# =============================================================================

load_dotenv()

# Deepgram SDK - supports both Cloud and SageMaker deployments
from deepgram import AsyncDeepgramClient

# For SageMaker deployment, import the transport layer
# This enables bidirectional streaming within your AWS VPC
try:
    from deepgram.sagemaker import sagemaker_transport
    SAGEMAKER_AVAILABLE = True
except ImportError:
    SAGEMAKER_AVAILABLE = False
    print("SageMaker transport not available - using Deepgram Cloud")

from deepgram.core.events import EventType

# =============================================================================
# INITIALIZE CLIENTS
# =============================================================================

app = FastAPI(title="RxConnect Voice Agent Demo")

# CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenAI client (or use Bedrock via boto3)
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Deepgram API key for cloud fallback
deepgram_api_key = os.getenv("DEEPGRAM_API_KEY")
if not deepgram_api_key:
    print("WARNING: DEEPGRAM_API_KEY not set")
else:
    print(f"Deepgram API key loaded: {deepgram_api_key[:8]}...")

# -----------------------------------------------------------------------------
# STT Client Configuration
# -----------------------------------------------------------------------------
# You can switch between Deepgram Cloud and SageMaker deployment
USE_SAGEMAKER_STT = os.getenv("USE_SAGEMAKER_STT", "false").lower() == "true"

if USE_SAGEMAKER_STT and SAGEMAKER_AVAILABLE:
    # SageMaker deployment - audio stays within your VPC
    print("Using SageMaker STT endpoint (VPC-isolated)")
    stt_client = AsyncDeepgramClient(
        api_key="dummy",  # Not used for SageMaker auth
        socket_transport=sagemaker_transport(
            endpoint_name=os.getenv("SAGEMAKER_ENDPOINT_NAME", "deepgram-stt"),
            region=os.getenv("AWS_REGION", "us-east-2")
        ),
    )
else:
    # Deepgram Cloud - easiest to get started
    print("Using Deepgram Cloud STT")
    stt_client = AsyncDeepgramClient(api_key=deepgram_api_key)

# -----------------------------------------------------------------------------
# TTS Client Configuration
# -----------------------------------------------------------------------------
# TTS currently uses Deepgram Cloud (SageMaker TTS coming soon)
tts_client = AsyncDeepgramClient(api_key=deepgram_api_key)

# Path to pharmacy data (simulates database)
DATA_FILE = Path(__file__).parent.parent / "client" / "public" / "pharmacy-data.json"

# =============================================================================
# SYSTEM PROMPT
# =============================================================================
# This prompt defines the agent's personality and behavior.
# Key principles for voice agents:
# - Keep responses SHORT (1-2 sentences)
# - Spell out IDs letter by letter for clarity
# - Never use asterisks or stage directions
# - Always call functions for data - never guess

SYSTEM_PROMPT = """# Role
You are a virtual pharmacy assistant speaking to customers over the phone. 
Your task is to help them check the status of their prescription orders.

# CRITICAL RULES

1. **ID Types** (never confuse these):
   - Member ID: M1001 (identifies a customer)
   - Order ID: ORD001 (identifies an order)
   - RX ID: RX1001 (identifies a specific prescription)

2. **Always Call Functions First**:
   - If asked "what orders do I have?" -> MUST call list_member_orders
   - If asked "what's in the order?" -> MUST call get_order_details
   - NEVER guess or make up data

3. **Spell Out IDs**: Always spell IDs letter by letter with spaces
   - "O R D 0 0 1" not "ORD001"
   - "R X 1 0 0 1" not "RX1001"

# Response Style
- MAXIMUM 1-2 sentences per response
- Be warm, friendly, and professional
- NEVER use *asterisks* or stage directions
- Don't narrate your actions - just do them and give results

# Conversation Flow

1. **Greeting**: "Hi! You're speaking with our virtual pharmacy assistant. 
   How may I assist you?"

2. **Get Member ID**: Ask for member ID to verify identity

3. **Verify & Help**: Use verify_member_id, then help with their request

4. **Closing**: When they say goodbye, respond: "Thank you for calling. Goodbye."

# Store Hours
Monday-Friday: 8AM-8PM
Saturday-Sunday: 8AM-5PM
"""

# =============================================================================
# FUNCTION DEFINITIONS FOR LLM
# =============================================================================
# These tools let the LLM interact with the pharmacy database.
# The LLM decides WHEN to call these based on user intent.

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "verify_member_id",
            "description": "Verify if a member ID exists in the system",
            "parameters": {
                "type": "object",
                "properties": {
                    "member_id": {
                        "type": "string",
                        "description": "The member ID to verify (e.g., M1001)"
                    }
                },
                "required": ["member_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_member_orders",
            "description": "List all orders for a member. Use when asked 'what orders do I have?'",
            "parameters": {
                "type": "object",
                "properties": {
                    "member_id": {"type": "string", "description": "The member ID"}
                },
                "required": ["member_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_order_details",
            "description": "Get medication details for an order. Use when asked 'what medication?'",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "The order ID"},
                    "member_id": {"type": "string", "description": "The member ID"}
                },
                "required": ["order_id", "member_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_order_timing",
            "description": "Get timing info for an order. Use when asked 'when will it be ready?'",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "The order ID"},
                    "member_id": {"type": "string", "description": "The member ID"}
                },
                "required": ["order_id", "member_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_order_refills",
            "description": "Get refill info for an order. Use when asked 'do I have refills?'",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "The order ID"},
                    "member_id": {"type": "string", "description": "The member ID"}
                },
                "required": ["order_id", "member_id"]
            }
        }
    },
]

# =============================================================================
# DATABASE FUNCTIONS
# =============================================================================
# These functions query the pharmacy database.
# In production, these would connect to your actual data systems.

def normalize_id(id_raw: str) -> str:
    """
    Normalize IDs to handle speech transcription variations.
    
    Speech-to-text might transcribe "M1001" as:
    - "M 1 0 0 1" (spelled out)
    - "M one zero zero one" (spoken numbers)
    - "m1001" (lowercase)
    
    This function normalizes all variations to "M1001".
    """
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


def verify_member_id(member_id: str) -> dict:
    """Verify if a member ID exists in the system."""
    member_id = normalize_id(member_id)
    orders = load_pharmacy_data()
    member_exists = any(normalize_id(o["member_id"]) == member_id for o in orders)
    return {"found": member_exists, "member_id": member_id}


def list_member_orders(member_id: str) -> dict:
    """List all orders for a member."""
    member_id = normalize_id(member_id)
    orders = load_pharmacy_data()
    member_orders = [o for o in orders if normalize_id(o["member_id"]) == member_id]
    
    if member_orders:
        return {
            "found": True,
            "member_id": member_id,
            "order_count": len(member_orders),
            "orders": [
                {"order_id": o["order_id"], "status": o["status"]}
                for o in member_orders
            ]
        }
    return {"found": False, "member_id": member_id}


def get_order_details(order_id: str, member_id: str) -> dict:
    """Get medication details for a specific order."""
    order_id = normalize_id(order_id)
    member_id = normalize_id(member_id)
    orders = load_pharmacy_data()
    
    order = next((o for o in orders if normalize_id(o["order_id"]) == order_id), None)
    
    if order and normalize_id(order["member_id"]) == member_id:
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "prescriptions": order["prescriptions"]
        }
    elif order:
        return {"found": True, "verified": False}  # Order exists but wrong member
    return {"found": False, "verified": False}


def get_order_timing(order_id: str, member_id: str) -> dict:
    """Get timing information for a specific order."""
    order_id = normalize_id(order_id)
    member_id = normalize_id(member_id)
    orders = load_pharmacy_data()
    
    order = next((o for o in orders if normalize_id(o["order_id"]) == order_id), None)
    
    if order and normalize_id(order["member_id"]) == member_id:
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "status": order["status"],
            "timing": order["timing"]
        }
    elif order:
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def get_order_refills(order_id: str, member_id: str) -> dict:
    """Get refill information for a specific order."""
    order_id = normalize_id(order_id)
    member_id = normalize_id(member_id)
    orders = load_pharmacy_data()
    
    order = next((o for o in orders if normalize_id(o["order_id"]) == order_id), None)
    
    if order and normalize_id(order["member_id"]) == member_id:
        refills = [
            {
                "medication": rx["name"],
                "rx_id": rx["rx_id"],
                "refills_remaining": rx["refills_remaining"]
            }
            for rx in order["prescriptions"]
        ]
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "refills": refills
        }
    elif order:
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


# Function dispatcher - maps function names to implementations
FUNCTION_MAP = {
    "verify_member_id": lambda args: verify_member_id(args["member_id"]),
    "list_member_orders": lambda args: list_member_orders(args["member_id"]),
    "get_order_details": lambda args: get_order_details(args["order_id"], args["member_id"]),
    "get_order_timing": lambda args: get_order_timing(args["order_id"], args["member_id"]),
    "get_order_refills": lambda args: get_order_refills(args["order_id"], args["member_id"]),
}

# =============================================================================
# VOICE AGENT CLASS
# =============================================================================
# This class orchestrates the STT -> LLM -> TTS pipeline.
# In a production system, you might use Pipecat framework for this.

class VoiceAgent:
    """
    Manages the voice conversation state and processing pipeline.
    
    Flow:
    1. Receive audio from WebSocket
    2. Stream to Deepgram STT for transcription
    3. Process transcript with LLM (with function calling)
    4. Generate response audio with Deepgram TTS
    5. Send audio back to client
    """
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.stt_connection = None
        self.conversation_history = []
        self.is_processing = False
        
        # Track conversation context
        self.current_member_id = None
        self.current_order_id = None
        
    async def start_stt(self):
        """
        Initialize Deepgram STT connection.
        
        This sets up a persistent WebSocket connection to Deepgram
        that will transcribe audio in real-time.
        """
        try:
            # Connect to Deepgram STT with Nova-3 model
            self.stt_connection = await stt_client.listen.v1.connect(
                model="nova-3",           # Latest, most accurate model
                interim_results="false",  # Only final transcripts
                encoding="linear16",      # 16-bit PCM audio format
                sample_rate=16000,        # 16kHz sample rate
                channels=1,               # Mono audio
            ).__aenter__()
            
            # Set up event handlers
            self.stt_connection.on(EventType.OPEN, self._on_stt_open)
            self.stt_connection.on(EventType.MESSAGE, self._on_stt_message)
            self.stt_connection.on(EventType.ERROR, self._on_stt_error)
            
            # Start listening for transcription results
            asyncio.create_task(self.stt_connection.start_listening())
            
            mode = "SageMaker" if USE_SAGEMAKER_STT else "Cloud"
            await self.send_status("connected", f"STT connected ({mode})")
            print(f"[OK] STT connection established via {mode}")
            
        except Exception as e:
            await self.send_error(f"STT connection failed: {str(e)}")
            import traceback
            traceback.print_exc()
            
    async def _on_stt_open(self, _):
        """Called when STT connection is established."""
        print("[STT] Connection opened")
        
    async def _on_stt_message(self, message):
        """
        Handle STT transcription results.
        
        When Deepgram returns a final transcript, this triggers
        the LLM processing and TTS generation pipeline.
        """
        try:
            if isinstance(message, dict):
                if message.get("is_final"):
                    # Extract transcript from Deepgram response
                    transcript = (
                        message.get("channel", {})
                        .get("alternatives", [{}])[0]
                        .get("transcript", "")
                    )
                    
                    print(f"[Transcript] '{transcript}'")
                    
                    # Process if we got text and aren't already processing
                    if transcript.strip() and not self.is_processing:
                        self.is_processing = True
                        
                        # Send transcript to frontend for display
                        await self.send_transcript(transcript, "user")
                        
                        # Process with LLM and generate TTS response
                        await self.process_with_llm(transcript)
                        
                        self.is_processing = False
                        
        except Exception as e:
            await self.send_error(f"STT message error: {str(e)}")
            self.is_processing = False
            
    async def _on_stt_error(self, error):
        """Handle STT errors."""
        await self.send_error(f"STT error: {str(error)}")
        
    async def process_audio_chunk(self, audio_data: bytes):
        """
        Send audio chunk to STT.
        
        Audio should be 16-bit PCM at 16kHz mono.
        """
        if self.stt_connection:
            try:
                await self.stt_connection.send_media(audio_data)
            except Exception as e:
                print(f"Audio send error: {str(e)}")
                
    async def process_with_llm(self, user_text: str):
        """
        Process user text with LLM and function calling.
        
        This is where the "intelligence" happens:
        1. Add user message to conversation history
        2. Call LLM with tools available
        3. If LLM wants to call a function, execute it
        4. Get final response and generate TTS
        """
        try:
            await self.send_status("thinking", "Processing...")
            
            # Add user message to history
            self.conversation_history.append({
                "role": "user",
                "content": user_text
            })
            
            # Keep history manageable (last 20 messages)
            if len(self.conversation_history) > 20:
                self.conversation_history = self.conversation_history[-20:]
            
            # Build messages with system prompt
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT}
            ] + self.conversation_history
            
            # -----------------------------------------------------------------
            # Call LLM with function calling enabled
            # -----------------------------------------------------------------
            response = await openai_client.chat.completions.create(
                model="gpt-4o-mini",  # Fast and capable
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",  # Let LLM decide when to use tools
                temperature=0.7,
                max_tokens=300,
            )
            
            assistant_message = response.choices[0].message
            
            # -----------------------------------------------------------------
            # Handle function calls if LLM wants to use tools
            # -----------------------------------------------------------------
            if assistant_message.tool_calls:
                tool_results = []
                
                for tool_call in assistant_message.tool_calls:
                    function_name = tool_call.function.name
                    function_args = json.loads(tool_call.function.arguments)
                    
                    print(f"[Function] Calling: {function_name}({function_args})")
                    
                    # Execute the function
                    if function_name in FUNCTION_MAP:
                        result = FUNCTION_MAP[function_name](function_args)
                        print(f"[Function] Result: {result}")
                        
                        # Track context for follow-up questions
                        if function_name == "verify_member_id" and result.get("found"):
                            self.current_member_id = result["member_id"]
                        if function_name == "list_member_orders" and result.get("found"):
                            orders = result.get("orders", [])
                            if len(orders) == 1:
                                self.current_order_id = orders[0]["order_id"]
                    else:
                        result = {"error": f"Unknown function: {function_name}"}
                    
                    tool_results.append({
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "content": json.dumps(result)
                    })
                
                # Add assistant message with tool calls to history
                self.conversation_history.append({
                    "role": "assistant",
                    "content": assistant_message.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments
                            }
                        }
                        for tc in assistant_message.tool_calls
                    ]
                })
                
                # Add tool results to history
                for tr in tool_results:
                    self.conversation_history.append(tr)
                
                # ---------------------------------------------------------
                # Get final response after function execution
                # ---------------------------------------------------------
                messages = [
                    {"role": "system", "content": SYSTEM_PROMPT}
                ] + self.conversation_history
                
                final_response = await openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    temperature=0.7,
                    max_tokens=300,
                )
                
                final_message = final_response.choices[0].message
                
                # Handle chained function calls (e.g., verify -> list_orders)
                while final_message.tool_calls:
                    print("[Function] Chained call detected")
                    chained_results = []
                    
                    for tool_call in final_message.tool_calls:
                        function_name = tool_call.function.name
                        function_args = json.loads(tool_call.function.arguments)
                        print(f"[Function] Calling: {function_name}({function_args})")
                        
                        if function_name in FUNCTION_MAP:
                            result = FUNCTION_MAP[function_name](function_args)
                            if function_name == "list_member_orders" and result.get("found"):
                                orders = result.get("orders", [])
                                if len(orders) == 1:
                                    self.current_order_id = orders[0]["order_id"]
                        else:
                            result = {"error": f"Unknown function: {function_name}"}
                        
                        chained_results.append({
                            "tool_call_id": tool_call.id,
                            "role": "tool",
                            "content": json.dumps(result)
                        })
                    
                    # Add to history
                    self.conversation_history.append({
                        "role": "assistant",
                        "content": final_message.content,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments
                                }
                            }
                            for tc in final_message.tool_calls
                        ]
                    })
                    for cr in chained_results:
                        self.conversation_history.append(cr)
                    
                    # Get next response
                    messages = [
                        {"role": "system", "content": SYSTEM_PROMPT}
                    ] + self.conversation_history
                    
                    final_response = await openai_client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=messages,
                        tools=TOOLS,
                        tool_choice="auto",
                        temperature=0.7,
                        max_tokens=300,
                    )
                    final_message = final_response.choices[0].message
                
                assistant_text = final_message.content
            else:
                # No function calls - use direct response
                assistant_text = assistant_message.content
            
            # Add assistant response to history
            self.conversation_history.append({
                "role": "assistant",
                "content": assistant_text
            })
            
            # Send response text to frontend
            print(f"[Response] {assistant_text}")
            await self.send_transcript(assistant_text, "assistant")
            
            # -----------------------------------------------------------------
            # Generate TTS audio
            # -----------------------------------------------------------------
            await self.generate_tts(assistant_text)
            
            # Check for goodbye - auto disconnect
            goodbye_phrases = ["goodbye", "bye", "take care", "thank you for calling"]
            if assistant_text and any(phrase in assistant_text.lower() for phrase in goodbye_phrases):
                print("[Call] Goodbye detected - ending call")
                await asyncio.sleep(1.5)  # Wait for TTS to finish
                await self.websocket.send_json({"type": "disconnect", "reason": "conversation_ended"})
                await self.websocket.close()
            
        except Exception as e:
            await self.send_error(f"LLM error: {str(e)}")
            import traceback
            traceback.print_exc()
            
    async def generate_tts(self, text: str):
        """
        Generate speech from text using Deepgram TTS.
        
        Uses Aura voices for natural-sounding speech.
        """
        if not text or not text.strip():
            return
            
        try:
            await self.send_status("speaking", "Generating response...")
            print(f"[TTS] Generating audio for: '{text[:50]}...'")
            
            # Stream TTS audio chunks
            audio_chunks = []
            async for chunk in tts_client.speak.v1.audio.generate(
                text=text,
                model="aura-2-thalia-en",  # Warm, professional female voice
                encoding="linear16",        # 16-bit PCM
                sample_rate=16000,          # 16kHz
            ):
                if chunk:
                    audio_chunks.append(chunk)
            
            # Combine chunks and send to client
            if audio_chunks:
                audio_data = b''.join(audio_chunks)
                duration = len(audio_data) / 32000  # 16-bit @ 16kHz = 32k bytes/sec
                print(f"[TTS] Audio: {len(audio_data)} bytes ({duration:.1f}s)")
                
                # Base64 encode for JSON transport
                audio_b64 = base64.b64encode(audio_data).decode('utf-8')
                await self.websocket.send_json({
                    "type": "audio",
                    "data": audio_b64,
                    "sampleRate": 16000,
                    "encoding": "linear16"
                })
                
            await self.send_status("ready", "Ready")
            
        except Exception as e:
            await self.send_error(f"TTS error: {str(e)}")
            import traceback
            traceback.print_exc()
            
    async def send_initial_greeting(self):
        """Send initial greeting when client connects."""
        greeting = "Hi! You're speaking with our virtual pharmacy assistant. How may I assist you today?"
        
        self.conversation_history.append({
            "role": "assistant",
            "content": greeting
        })
        
        await self.send_transcript(greeting, "assistant")
        await self.generate_tts(greeting)
            
    # -------------------------------------------------------------------------
    # WebSocket message helpers
    # -------------------------------------------------------------------------
    
    async def send_transcript(self, text: str, speaker: str):
        """Send transcript to frontend."""
        await self.websocket.send_json({
            "type": "transcript",
            "text": text,
            "speaker": speaker
        })
        
    async def send_status(self, status: str, message: str):
        """Send status update to frontend."""
        await self.websocket.send_json({
            "type": "status",
            "status": status,
            "message": message
        })
        
    async def send_error(self, error: str):
        """Send error to frontend."""
        await self.websocket.send_json({
            "type": "error",
            "message": error
        })
        print(f"[ERROR] {error}")
        
    async def stop_stt(self):
        """Close STT connection."""
        if self.stt_connection:
            try:
                await self.stt_connection.send_control({"type": "Finalize"})
                await self.stt_connection.__aexit__(None, None, None)
            except:
                pass

# =============================================================================
# API ENDPOINTS
# =============================================================================

@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "message": "RxConnect Voice Agent Demo",
        "status": "running",
        "stt_mode": "SageMaker" if USE_SAGEMAKER_STT else "Cloud"
    }


@app.get("/health")
async def health():
    """Health status endpoint."""
    return {"status": "healthy"}


@app.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for voice communication.
    
    Protocol:
    - Client sends binary audio chunks (16-bit PCM, 16kHz, mono)
    - Client sends JSON control messages: {"type": "ping"|"reset"}
    - Server sends JSON: {"type": "transcript"|"status"|"audio"|"error"}
    """
    await websocket.accept()
    print("[WebSocket] Client connected")
    
    agent = VoiceAgent(websocket)
    
    try:
        # Initialize STT connection
        await agent.start_stt()
        
        # Send initial greeting
        await agent.send_initial_greeting()
        
        # Handle messages from frontend
        while True:
            data = await websocket.receive()
            
            if "bytes" in data:
                # Binary audio data from microphone
                await agent.process_audio_chunk(data["bytes"])
                
            elif "text" in data:
                # JSON control messages
                message = json.loads(data["text"])
                
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                    
                elif message.get("type") == "reset":
                    agent.conversation_history = []
                    agent.current_member_id = None
                    agent.current_order_id = None
                    await agent.send_status("ready", "Conversation reset")
                    print("[WebSocket] Conversation reset")
                    
    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected")
    except Exception as e:
        print(f"[ERROR] WebSocket error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await agent.stop_stt()


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    print("""
    ================================================================
           RxConnect Voice Agent Demo                     
                                                                   
       STT: Deepgram Nova-3 (SageMaker or Cloud)
       LLM: OpenAI GPT-4o-mini                                     
       TTS: Deepgram Aura                                          
                                                                   
       Server: http://localhost:8000                               
       WebSocket: ws://localhost:8000/ws/voice                     
    ================================================================
    """)
    uvicorn.run(app, host="0.0.0.0", port=8000)
