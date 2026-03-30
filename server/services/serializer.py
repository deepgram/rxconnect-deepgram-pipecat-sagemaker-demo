"""Custom Pipecat frame serializer for the RxConnect browser client.

The browser sends raw PCM int16 audio as binary WebSocket frames and JSON
text for control messages (ping, reset).  The server replies with JSON text
frames containing either base64-encoded audio or metadata (transcripts,
status, errors).

This serializer translates between those wire formats and Pipecat frames so
``FastAPIWebsocketTransport`` can drive the pipeline while keeping the
existing React frontend unchanged.
"""

import base64
import json
from typing import Optional

from loguru import logger

from pipecat.frames.frames import (
    AudioRawFrame,
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    StartFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer


class RxConnectFrameSerializer(FrameSerializer):
    """Serialize/deserialize frames for the RxConnect browser WebSocket protocol.

    Wire format (client → server):
        binary  – raw PCM int16 mono audio at ``input_sample_rate``
        text    – JSON control messages: ``{"type":"ping"}``, ``{"type":"reset"}``

    Wire format (server → client):
        text    – ``{"type":"audio","data":"<b64>","sampleRate":…,"encoding":"linear16"}``
        text    – ``{"type":"transcript","text":"…","speaker":"user"|"assistant"}``
        text    – ``{"type":"status","status":"…","message":"…"}``
        text    – ``{"type":"pong"}``
    """

    class InputParams(FrameSerializer.InputParams):
        input_sample_rate: int = 16000

    def __init__(self, params: Optional[InputParams] = None, **kwargs):
        super().__init__(params or self.InputParams(), **kwargs)
        self._sample_rate: int = self._params.input_sample_rate

    async def setup(self, frame: StartFrame):
        self._sample_rate = self._params.input_sample_rate

    # ------------------------------------------------------------------
    # Outgoing: Pipecat frames → browser JSON
    # ------------------------------------------------------------------

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, AudioRawFrame):
            audio_b64 = base64.b64encode(frame.audio).decode("utf-8")
            return json.dumps({
                "type": "audio",
                "data": audio_b64,
                "sampleRate": frame.sample_rate,
                "encoding": "linear16",
            })

        if isinstance(frame, InterruptionFrame):
            return json.dumps({"type": "clear"})

        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            if self.should_ignore_frame(frame):
                return None
            return json.dumps(frame.message)

        return None

    # ------------------------------------------------------------------
    # Incoming: browser messages → Pipecat frames
    # ------------------------------------------------------------------

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, str):
            try:
                msg = json.loads(data)
                msg_type = msg.get("type", "")
                if msg_type == "ping":
                    return OutputTransportMessageFrame(message={"type": "pong"})
                logger.debug(f"Unhandled client text message: {msg_type}")
            except json.JSONDecodeError:
                logger.warning("Non-JSON text message received from client")
            return None

        return InputAudioRawFrame(
            audio=data,
            sample_rate=self._sample_rate,
            num_channels=1,
        )
