"""Speech-to-Text configuration."""

import os

STT_CONFIG = {
    "model": "nova-3",
    "interim_results": "false",
    "encoding": "linear16",
    "sample_rate": "16000",
    "channels": "1",
}

SAGEMAKER_CONFIG = {
    "enabled": os.getenv("USE_SAGEMAKER_STT", "false").lower() == "true",
    "endpoint_name": os.getenv("SAGEMAKER_ENDPOINT_NAME", "test-luke-1"),
    "region": os.getenv("AWS_REGION", "us-east-2"),
}
