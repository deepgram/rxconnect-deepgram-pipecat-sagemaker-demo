"""Custom Pipecat frame processors for the RxConnect voice-agent pipeline.

These sit inside the ``Pipeline([…])`` list and handle three jobs that the
standard Pipecat services don't cover:

1. **UserTranscriptForwarder** – pushes a JSON transcript to the browser
   every time the STT produces a ``TranscriptionFrame``.
2. **AssistantTranscriptAccumulator** – collects streamed ``TextFrame``
   chunks from the LLM and, once the full response is complete, pushes a
   single JSON transcript to the browser.
3. **BrowserAudioOut** – streams each TTS audio chunk to the browser as an
   ``audio`` message, and sends the bot-speaking frames from what the browser
   reports about playback (the transport's own audio path is bypassed).

Pipecat's base ``FrameProcessor.process_frame()`` handles system frames
(``StartFrame``, ``InterruptionFrame``, etc.) but does NOT forward frames.
Every override must call ``super().process_frame()`` for system-frame
bookkeeping AND ``self.push_frame()`` to actually forward data downstream.
"""

import asyncio
import base64
import time

from loguru import logger

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    EndFrame,
    Frame,
    InterruptionFrame,
    LLMMessagesAppendFrame,
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

from services.serializer import BrowserPlaybackEndedFrame

# How long past the estimated end of playback to wait for the browser's
# "playback-ended" before assuming it finished anyway
PLAYBACK_ENDED_GRACE_SECS = 1.5


class UserTranscriptForwarder(FrameProcessor):
    """Forward user transcripts (from STT) to the browser as JSON.

    A clicked prompt (an ``LLMMessagesAppendFrame`` from the serializer's
    ``user-text`` message) is echoed the same way, so it shows as the caller's turn.

    Place this processor immediately after the STT service in the pipeline.
    """

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            logger.info(f"User transcript: {frame.text}")
            await self._send_user_transcript(frame.text)
        elif isinstance(frame, LLMMessagesAppendFrame):
            for message in frame.messages:
                content = message.get("content")
                if message.get("role") == "user" and isinstance(content, str) and content.strip():
                    logger.info(f"User prompt (clicked): {content}")
                    await self._send_user_transcript(content)

    async def _send_user_transcript(self, text: str):
        await self.push_frame(
            OutputTransportMessageUrgentFrame(
                message={
                    "type": "transcript",
                    "text": text,
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


class BrowserAudioOut(FrameProcessor):
    """Stream TTS audio to the browser, and track when the browser has played it.

    Place this between the TTS service and ``transport.output()``.

    Each TTS chunk goes out as an ``audio`` message as soon as it arrives, so the
    caller hears the first words while the rest is still being synthesized. The
    browser plays the chunks back to back and replies ``playback-ended`` (a
    ``BrowserPlaybackEndedFrame``) when it has played everything it was sent.

    Because the audio goes out as messages, the output transport never plays it
    and never sends the bot-speaking frames it normally would, so this processor
    sends them upstream itself:

    - ``BotStartedSpeakingFrame`` with the first chunk of an utterance.
    - ``BotStoppedSpeakingFrame`` once the TTS has finished *and* the browser
      says playback ended, or right away on an interruption. The TTS service
      waits for this frame before it speaks the next response, so the replies
      never overlap, and the input transport uses it to know the bot is talking.

    If the browser never reports (a lost message, an older client), a fallback
    timer stops the bot ``PLAYBACK_ENDED_GRACE_SECS`` after the audio should have
    finished, estimated from the bytes sent, so the TTS can't stay paused.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._speaking = False
        self._tts_active = False
        # The browser said it had played everything, and nothing has been sent since
        self._browser_drained = False
        # When the browser should finish playing what it has been sent (monotonic)
        self._playback_end = 0.0
        self._fallback_task: asyncio.Task | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, OutputAudioRawFrame) and direction == FrameDirection.DOWNSTREAM:
            await self._send_audio(frame)
            return

        if isinstance(frame, BrowserPlaybackEndedFrame):
            logger.debug(f"{self}: browser finished playback (TTS active: {self._tts_active})")
            self._browser_drained = True
            if not self._tts_active:
                await self._stopped_speaking()
            return

        if isinstance(frame, TTSStartedFrame):
            self._tts_active = True
            await self._cancel_fallback()
        elif isinstance(frame, TTSStoppedFrame):
            self._tts_active = False
            if self._browser_drained:
                await self._stopped_speaking()
            elif self._speaking:
                await self._arm_fallback()
        elif isinstance(frame, InterruptionFrame):
            # The browser drops its queue on the "clear" the serializer sends for this frame
            self._tts_active = False
            self._playback_end = 0.0
            await self._stopped_speaking()
        elif isinstance(frame, (EndFrame, CancelFrame)):
            await self._cancel_fallback()

        await self.push_frame(frame, direction)

    async def _send_audio(self, frame: OutputAudioRawFrame):
        if not self._speaking:
            self._speaking = True
            await self.push_frame(BotStartedSpeakingFrame(), FrameDirection.UPSTREAM)
        self._browser_drained = False
        secs = len(frame.audio) / (2 * frame.num_channels * frame.sample_rate)
        self._playback_end = max(time.monotonic(), self._playback_end) + secs
        await self.push_frame(
            OutputTransportMessageFrame(
                message={
                    "type": "audio",
                    "data": base64.b64encode(frame.audio).decode("utf-8"),
                    "sampleRate": frame.sample_rate,
                    "encoding": "linear16",
                }
            )
        )

    async def _stopped_speaking(self):
        await self._cancel_fallback()
        if self._speaking:
            self._speaking = False
            logger.debug(f"{self}: bot stopped speaking")
            await self.push_frame(BotStoppedSpeakingFrame(), FrameDirection.UPSTREAM)

    async def _arm_fallback(self):
        await self._cancel_fallback()
        delay = max(0.0, self._playback_end - time.monotonic()) + PLAYBACK_ENDED_GRACE_SECS
        self._fallback_task = self.create_task(self._fallback(delay))

    async def _fallback(self, delay: float):
        await asyncio.sleep(delay)
        self._fallback_task = None
        if self._speaking:
            logger.warning("BrowserAudioOut: no playback-ended from the browser; assuming it finished")
            await self._stopped_speaking()

    async def _cancel_fallback(self):
        if self._fallback_task:
            task, self._fallback_task = self._fallback_task, None
            await self.cancel_task(task)
