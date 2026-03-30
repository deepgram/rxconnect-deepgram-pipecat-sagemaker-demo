"""Custom Pipecat frame processors for the RxConnect voice-agent pipeline.

These sit inside the ``Pipeline([…])`` list and handle three jobs that the
standard Pipecat services don't cover:

1. **UserTranscriptForwarder** – pushes a JSON transcript to the browser
   every time the STT produces a ``TranscriptionFrame``.
2. **AssistantTranscriptAccumulator** – collects streamed ``TextFrame``
   chunks from the LLM and, once the full response is complete, pushes a
   single JSON transcript to the browser.
3. **AudioAccumulator** – buffers small TTS audio chunks into one large
   blob and sends it as a single ``OutputTransportMessageFrame`` (the
   browser client replaces any in-progress playback on each ``audio``
   message, so we must send one blob — and we bypass the transport's own
   audio pipeline which would re-chunk it).

Pipecat's base ``FrameProcessor.process_frame()`` handles system frames
(``StartFrame``, ``InterruptionFrame``, etc.) but does NOT forward frames.
Every override must call ``super().process_frame()`` for system-frame
bookkeeping AND ``self.push_frame()`` to actually forward data downstream.
"""

import base64

from loguru import logger

from pipecat.frames.frames import (
    Frame,
    OutputAudioRawFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    TextFrame,
    TranscriptionFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class UserTranscriptForwarder(FrameProcessor):
    """Forward user transcripts (from STT) to the browser as JSON.

    Place this processor immediately after the STT service in the pipeline.
    """

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            logger.info(f"User transcript: {frame.text}")
            await self.push_frame(
                OutputTransportMessageUrgentFrame(
                    message={
                        "type": "transcript",
                        "text": frame.text,
                        "speaker": "user",
                    }
                )
            )


class AssistantTranscriptAccumulator(FrameProcessor):
    """Accumulate LLM text chunks and send one transcript to the browser.

    Place this between the LLM service and TTS in the pipeline.  It
    transparently forwards every frame (including ``TextFrame``) so that TTS
    still receives the text.  When ``LLMFullResponseEndFrame`` arrives it
    pushes a single ``OutputTransportMessageFrame`` with the full text.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._buffer: str = ""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)

        if isinstance(frame, LLMFullResponseStartFrame):
            self._buffer = ""
        elif isinstance(frame, TextFrame):
            self._buffer += frame.text
        elif isinstance(frame, LLMFullResponseEndFrame):
            if self._buffer.strip():
                logger.info(f"Assistant transcript: {self._buffer[:80]}…")
                await self.push_frame(
                    OutputTransportMessageUrgentFrame(
                        message={
                            "type": "transcript",
                            "text": self._buffer.strip(),
                            "speaker": "assistant",
                        }
                    )
                )
            self._buffer = ""


class AudioAccumulator(FrameProcessor):
    """Buffer TTS audio chunks into a single ``OutputAudioRawFrame``.

    The browser client's ``playAudio`` stops any in-progress source before
    starting a new one, so streaming many small chunks would cause audible
    cutting.  This processor holds audio between ``TTSStartedFrame`` and
    ``TTSStoppedFrame``, then emits one large frame.

    Place this between the TTS service and ``transport.output()``.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._chunks: list[bytes] = []
        self._sample_rate: int = 24000
        self._num_channels: int = 1
        self._accumulating: bool = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TTSStartedFrame):
            self._accumulating = True
            self._chunks = []
            return

        if isinstance(frame, OutputAudioRawFrame) and self._accumulating:
            self._chunks.append(frame.audio)
            self._sample_rate = frame.sample_rate
            self._num_channels = frame.num_channels
            return

        if isinstance(frame, TTSStoppedFrame) and self._accumulating:
            self._accumulating = False
            if self._chunks:
                combined = b"".join(self._chunks)
                logger.info(
                    f"AudioAccumulator: flushing {len(combined)} bytes "
                    f"({len(self._chunks)} chunks)"
                )
                audio_b64 = base64.b64encode(combined).decode("utf-8")
                await self.push_frame(
                    OutputTransportMessageFrame(
                        message={
                            "type": "audio",
                            "data": audio_b64,
                            "sampleRate": self._sample_rate,
                            "encoding": "linear16",
                        }
                    )
                )
                self._chunks = []
            await self.push_frame(frame, direction)
            return

        await self.push_frame(frame, direction)
