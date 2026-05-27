"""Groq Whisper STT — cloud transcription via whisper-large-v3.

Replaces the previous local faster-whisper setup. Running large-v3 on
Oracle Cloud free-tier CPUs takes 10–30s per turn; the Groq API returns
in well under a second for typical call utterances, so we offload it.

Input audio is raw PCM float32 at 16 kHz mono (matches the VAD output);
we wrap it in a WAV container in memory before sending to Groq.
"""

from __future__ import annotations

import io

import numpy as np
import soundfile as sf
from groq import Groq

from core.config import settings

_groq_client: Groq | None = None


def get_client() -> Groq:
    global _groq_client
    if _groq_client is None:
        # Prefer the dedicated GROQ_API_KEY when present; otherwise reuse
        # LLM_API_KEY since the user typically points the LLM at Groq too.
        # Read via `settings` (pydantic-settings parses .env), not os.getenv —
        # pydantic-settings does NOT push values into the process env, so
        # os.getenv returns None when only .env has the key set.
        api_key = settings.groq_api_key or settings.llm_api_key
        _groq_client = Groq(api_key=api_key)
    return _groq_client


def transcribe(audio_bytes: bytes, initial_prompt: str | None = None) -> dict:
    """Transcribe audio using Groq Whisper API.

    Input: raw PCM float32 bytes at 16kHz mono.
    Returns: {text, language, confidence}.
    """
    client = get_client()

    audio_array = np.frombuffer(audio_bytes, dtype=np.float32)

    # Skip if too short (less than 0.3 seconds @ 16 kHz).
    if len(audio_array) < 4800:
        return {"text": "", "language": "en", "confidence": 0.0}

    wav_buffer = io.BytesIO()
    sf.write(wav_buffer, audio_array, 16000, format="WAV", subtype="PCM_16")
    wav_buffer.seek(0)
    wav_buffer.name = "audio.wav"

    try:
        params: dict = {
            "file": wav_buffer,
            # Turbo variant: ~3x faster than whisper-large-v3 on Groq with a
            # small accuracy hit — acceptable for short, conversational
            # customer-service utterances, and the speedup is what makes the
            # user transcript feel "instant" instead of "after a beat".
            "model": "whisper-large-v3-turbo",
            "response_format": "verbose_json",
        }
        if initial_prompt:
            params["prompt"] = initial_prompt

        response = client.audio.transcriptions.create(**params)

        return {
            "text": response.text.strip(),
            "language": getattr(response, "language", "en"),
            "confidence": 1.0,
        }
    except Exception as e:
        print(f"[STT] Groq transcription error: {e}")
        return {"text": "", "language": "en", "confidence": 0.0}
