# Voice AI Concepts Deep Dive

This document explains the key concepts behind building real-time voice AI applications.

## Table of Contents

1. [Real-Time Audio Streaming](#real-time-audio-streaming)
2. [Speech-to-Text (STT)](#speech-to-text-stt)
3. [Large Language Models (LLM)](#large-language-models-llm)
4. [Text-to-Speech (TTS)](#text-to-speech-tts)
5. [Orchestration with Pipecat](#orchestration-with-pipecat)
6. [AWS SageMaker Deployment](#aws-sagemaker-deployment)

---

## Real-Time Audio Streaming

### Audio Format

For voice applications, we typically use:

| Parameter | Value | Reason |
|-----------|-------|--------|
| Sample Rate | 16,000 Hz | Standard for speech recognition |
| Bit Depth | 16-bit | Good quality-to-bandwidth ratio |
| Channels | Mono | Speech doesn't need stereo |
| Encoding | Linear PCM | Uncompressed for accuracy |

### Browser Audio Capture

```javascript
// Request microphone access
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    sampleRate: 16000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  }
});

// Process audio with ScriptProcessorNode (or AudioWorklet)
const processor = audioContext.createScriptProcessor(4096, 1, 1);
processor.onaudioprocess = (e) => {
  const audioData = e.inputBuffer.getChannelData(0);
  // Convert Float32 to Int16 and send to server
};
```

### WebSocket Transport

WebSockets are ideal for voice because:
- **Bidirectional**: Send audio AND receive audio simultaneously
- **Low Latency**: No HTTP request overhead
- **Binary Support**: Efficient audio transmission

---

## Speech-to-Text (STT)

### How It Works

1. **Audio Input**: Microphone captures sound waves
2. **Acoustic Model**: Converts audio to phonemes
3. **Language Model**: Predicts words from phonemes
4. **Output**: Text transcript

### Deepgram Nova-3

Deepgram's Nova-3 model provides:
- **<300ms latency** for real-time streaming
- **Best-in-class accuracy** for conversational speech
- **Endpointing**: Automatically detects when speaker finishes
- **Interim Results**: Optional partial transcripts

```python
# Deepgram STT configuration
connection = await client.listen.v1.connect(
    model="nova-3",           # Latest model
    interim_results=False,    # Final only (lower latency)
    encoding="linear16",      # 16-bit PCM
    sample_rate=16000,        # 16kHz
    channels=1,               # Mono
)
```

### Handling Speech Variations

Real speech includes:
- **Disfluencies**: "um", "uh", pauses
- **Corrections**: "M 1 0 0... sorry, M 1 0 0 1"
- **Spelled IDs**: "M as in Mike, 1 0 0 1"

Our `normalize_id()` function handles these variations:

```python
def normalize_id(id_raw: str) -> str:
    # Handle spelled numbers: "one" → "1"
    # Remove spaces: "M 1 0 0 1" → "M1001"
    # Uppercase: "m1001" → "M1001"
```

---

## Large Language Models (LLM)

### Function Calling

Modern LLMs can decide when to call external functions:

```python
tools = [{
    "type": "function",
    "function": {
        "name": "lookup_order",
        "description": "Look up a prescription order",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string"},
                "member_id": {"type": "string"}
            }
        }
    }
}]

response = await openai.chat.completions.create(
    model="gpt-4o-mini",
    messages=conversation,
    tools=tools,
    tool_choice="auto"  # LLM decides when to use tools
)
```

### Conversation Management

For voice agents, manage context carefully:

```python
# Keep history manageable
if len(conversation_history) > 20:
    conversation_history = conversation_history[-20:]

# Track state between turns
self.current_member_id = result["member_id"]
self.current_order_id = orders[0]["order_id"]
```

### System Prompt Design

Key principles for voice agents:

1. **Brevity**: "Maximum 1-2 sentences per response"
2. **Clarity**: "Spell IDs letter by letter"
3. **No Narration**: "Never use *asterisks* or stage directions"
4. **Data-Driven**: "Always call functions - never guess"

---

## Text-to-Speech (TTS)

### Deepgram Aura

Aura provides natural-sounding voices:

```python
async for chunk in tts_client.speak.v1.audio.generate(
    text="Your order is ready!",
    model="aura-2-thalia-en",  # Voice selection
    encoding="linear16",
    sample_rate=16000,
):
    audio_chunks.append(chunk)
```

### Voice Selection

| Voice | Character |
|-------|-----------|
| `aura-2-thalia-en` | Warm, professional |
| `aura-2-asteria-en` | Clear, articulate |
| `aura-2-luna-en` | Friendly, casual |
| `aura-2-orion-en` | Confident, authoritative |

### Optimizing for Speech

When generating text for TTS:
- Spell out IDs: "O R D 0 0 1" instead of "ORD001"
- Avoid abbreviations: "December 20th" not "12/20"
- Use natural phrasing: Punctuation creates pauses

---

## Orchestration with Pipecat

### The Pipeline Pattern

Pipecat manages the flow:

```
Audio In → STT → LLM → TTS → Audio Out
              ↓
           Functions
              ↓
           Database
```

### Key Benefits

1. **Async Coordination**: Handle streaming audio while processing
2. **State Management**: Track conversation across turns
3. **Error Handling**: Graceful degradation
4. **Interruption**: Let users interrupt agent

### Example Pipeline

```python
pipeline = Pipeline([
    AudioInput(),           # Microphone capture
    DeepgramSTT(),         # Speech-to-Text
    ConversationManager(), # State tracking
    LLMProcessor(),        # Intent + Response
    FunctionExecutor(),    # Database queries
    DeepgramTTS(),         # Text-to-Speech
    AudioOutput(),         # Speaker playback
])
```

---

## AWS SageMaker Deployment

### Why SageMaker?

For enterprise deployments:

| Concern | SageMaker Solution |
|---------|-------------------|
| Data Privacy | Audio stays in your VPC |
| Compliance | HIPAA, SOC2, etc. |
| Latency | Deploy in your region |
| Scale | Auto-scaling built-in |

### Bidirectional Streaming

The new SageMaker Bidirectional Streaming API enables:
- **Real-time input**: Stream audio as captured
- **Real-time output**: Receive results as processed
- **Low latency**: No batch processing delay

```python
from deepgram.sagemaker import sagemaker_transport

client = AsyncDeepgramClient(
    api_key="dummy",  # Not used for SageMaker
    socket_transport=sagemaker_transport(
        endpoint_name="deepgram-stt-endpoint",
        region="us-east-2"
    ),
)
```

### Security Model

```
┌─────────────────────────────────────────┐
│              Your AWS VPC               │
│  ┌─────────────┐    ┌─────────────┐    │
│  │ Application │───►│  SageMaker  │    │
│  │   Server    │◄───│  Endpoint   │    │
│  └─────────────┘    └─────────────┘    │
│         │                              │
│         ▼                              │
│  ┌─────────────┐                       │
│  │   Database  │                       │
│  └─────────────┘                       │
└─────────────────────────────────────────┘
         ▲
         │ HTTPS only (no audio)
         ▼
    ┌─────────┐
    │  Users  │
    └─────────┘
```

---

## Further Reading

- [Deepgram Docs](https://developers.deepgram.com)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Pipecat Framework](https://github.com/pipecat-ai/pipecat)
- [AWS SageMaker](https://docs.aws.amazon.com/sagemaker)

