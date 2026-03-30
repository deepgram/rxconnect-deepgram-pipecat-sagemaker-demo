"""Speech-to-Text configuration."""

import os

# Flux: purpose-built for voice agents with ~260ms turn detection
USE_FLUX_STT = os.getenv("USE_FLUX_STT", "true").lower() == "true"

STT_CONFIG_FLUX = {
    "model": "flux-general-en",
    "encoding": "linear16",
    "sample_rate": "16000",
    "eot_threshold": "0.7",      # End-of-turn confidence threshold
    "eot_timeout_ms": "3000",    # Force end-of-turn after 3s silence (faster than default 5s)
}

STT_CONFIG_NOVA = {
    "model": "nova-3",
    "interim_results": "true",
    "endpointing": "300",
    "encoding": "linear16",
    "sample_rate": "16000",
    "channels": "1",
    "smart_format": "false",
}

STT_CONFIG = STT_CONFIG_FLUX if USE_FLUX_STT else STT_CONFIG_NOVA

SAGEMAKER_CONFIG = {
    "enabled": os.getenv("USE_SAGEMAKER_STT", "false").lower() == "true",
    "endpoint_name": os.getenv("SAGEMAKER_ENDPOINT_NAME", "test-luke-1"),
    "region": os.getenv("AWS_REGION", "us-east-2"),
}
