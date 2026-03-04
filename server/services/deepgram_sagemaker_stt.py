"""
Deepgram STT service that routes through AWS SageMaker.

Subclasses Pipecat's DeepgramSTTService and replaces the standard Deepgram
WebSocket connection with a SageMaker HTTP/2 bidirectional stream via the
deepgram-sagemaker transport. Same Deepgram model, different inference backend.
"""

import asyncio
import json
from typing import AsyncGenerator, Dict, Optional

from loguru import logger

from pipecat.frames.frames import Frame
from pipecat.services.deepgram.stt import DeepgramSTTService, LiveOptions

from deepgram.clients.listen.v1.websocket.response import (
    LiveResultResponse,
    SpeechStartedResponse,
    UtteranceEndResponse,
)
from deepgram.clients.common.v1.enums import LiveTranscriptionEvents
from deepgram_sagemaker import SageMakerTransportFactory


class DeepgramSageMakerSTTService(DeepgramSTTService):
    """Deepgram STT routed through an AWS SageMaker endpoint.

    Drop-in replacement for DeepgramSTTService in a Pipecat pipeline.
    Audio is streamed to a SageMaker-hosted Deepgram model via HTTP/2
    instead of the standard Deepgram WebSocket.
    """

    def __init__(
        self,
        *,
        api_key: str = "",
        endpoint_name: str,
        region: str = "us-east-2",
        live_options: Optional[LiveOptions] = None,
        **kwargs,
    ):
        super().__init__(api_key=api_key or "sagemaker", live_options=live_options, **kwargs)
        self._sm_endpoint = endpoint_name
        self._sm_region = region
        self._sm_transport = None
        self._sm_listener_task = None

    async def _connect(self):
        """Connect via SageMaker transport instead of Deepgram WebSocket."""
        logger.debug(f"Connecting to Deepgram via SageMaker ({self._sm_endpoint})")

        factory = SageMakerTransportFactory(
            endpoint_name=self._sm_endpoint,
            region=self._sm_region,
        )

        options = {**self._settings.live_options.to_dict(), "sample_rate": str(self.sample_rate)}
        query = "&".join(f"{k}={v}" for k, v in options.items())
        url = f"wss://api.deepgram.com/v1/listen?{query}"

        self._sm_transport = factory(url, {})
        self._sm_listener_task = asyncio.create_task(self._sm_message_listener())

        logger.info(f"SageMaker STT connected: endpoint={self._sm_endpoint}, region={self._sm_region}")

    async def _disconnect(self):
        """Close the SageMaker transport."""
        if self._sm_listener_task:
            self._sm_listener_task.cancel()
            try:
                await self._sm_listener_task
            except asyncio.CancelledError:
                pass
            self._sm_listener_task = None

        if self._sm_transport:
            try:
                await self._sm_transport.close()
            except Exception:
                pass
            self._sm_transport = None

        logger.debug("SageMaker STT disconnected")

    async def _sm_message_listener(self):
        """Read messages from SageMaker transport and dispatch to Pipecat handlers."""
        try:
            async for raw_message in self._sm_transport:
                try:
                    if isinstance(raw_message, bytes):
                        continue

                    data = json.loads(raw_message) if isinstance(raw_message, str) else raw_message
                    response_type = data.get("type", "")

                    if response_type == LiveTranscriptionEvents.Transcript:
                        result = LiveResultResponse.from_json(
                            raw_message if isinstance(raw_message, str) else json.dumps(data)
                        )
                        await self._on_message(result=result)

                    elif response_type == LiveTranscriptionEvents.SpeechStarted:
                        result = SpeechStartedResponse.from_json(
                            raw_message if isinstance(raw_message, str) else json.dumps(data)
                        )
                        if self.vad_enabled:
                            await self._on_speech_started(result)

                    elif response_type == LiveTranscriptionEvents.UtteranceEnd:
                        result = UtteranceEndResponse.from_json(
                            raw_message if isinstance(raw_message, str) else json.dumps(data)
                        )
                        if self.vad_enabled:
                            await self._on_utterance_end(result)

                except Exception as e:
                    logger.error(f"SageMaker STT message parse error: {e}")

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"SageMaker STT listener error: {e}")

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        """Send audio to SageMaker-hosted Deepgram model."""
        if self._sm_transport:
            await self._sm_transport.send(audio)
        yield None
