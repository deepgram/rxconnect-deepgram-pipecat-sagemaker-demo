"""Keep API keys out of the logs.

Pipecat's Deepgram STT service logs the full request headers, including
``Authorization: Token <key>``, every time its websocket fails to connect, and
it retries several times a second. On Fly those lines are readable by anyone
with access to the app's logs. This patcher rewrites every loguru message
(ours and Pipecat's share the same logger) before it reaches a sink.
"""

import re

from loguru import logger

_PATTERNS = [
    # Deepgram ("Token ...") and OpenAI-style bearer headers
    (re.compile(r"\b(Token|Bearer)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 <redacted>"),
    # OpenAI keys that appear outside a header (sk-..., sk-proj-...)
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"), "sk-<redacted>"),
]


def redact(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _patch(record) -> None:
    record["message"] = redact(record["message"])


def install() -> None:
    """Apply redaction to every log record. Call once, before any service starts."""
    logger.configure(patcher=_patch)
