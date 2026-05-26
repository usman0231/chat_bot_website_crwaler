"""TTS — ElevenLabs primary, edge-tts fallback.

ElevenLabs is the default backend (high-quality Neural voices). When the
account can't reach a voice — most commonly a free-tier 402
``paid_plan_required`` for library voices like Rachel — we silently fall
back to edge-tts (free Microsoft Neural voices) so calls keep working. A
process-wide latch ``_eleven_blocked`` flips on the first 402 so we don't
hammer ElevenLabs for the rest of the run.

To force edge-tts globally (e.g. while you decide whether to upgrade), set
``VOICE_FORCE_EDGE_TTS=1`` in ``.env``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import AsyncIterator

from core.config import settings

log = logging.getLogger(__name__)

# Curated ElevenLabs library voice IDs (Rachel, etc.). Keep in sync with
# the frontend voice picker in settings-tab.tsx.
VOICES: dict[str, str] = {
    "rachel": "21m00Tcm4TlvDq8ikWAM",  # natural female English
    "domi": "AZnzlk1XvdvUeBnXmlld",  # energetic female
    "bella": "EXAVITQu4vr4xnSDxMaL",  # soft female
    "antoni": "ErXwobaYiN019PkySvjV",  # clear male
    "arnold": "VR6AewLTigWG4xSOukaG",  # strong male
    "serafina": "4tRn1lSkEn13EVTuqb0g"
}

_LANG_TO_VOICE = {
    "en": settings.elevenlabs_default_voice,
    "ur": settings.elevenlabs_default_voice,
    "default": settings.elevenlabs_default_voice,
}

# edge-tts fallback voices — used when ElevenLabs returns 402 or the key
# is missing. These are free, no signup, but lower quality than ElevenLabs.
_EDGE_VOICES = {
    "en": "en-US-JennyNeural",
    "ur": "ur-PK-UzmaNeural",
    "default": "en-US-JennyNeural",
}

# Distinct edge-tts voices so a fallback still differentiates selections.
# Keyed by ElevenLabs voice_id → a unique Microsoft Neural voice. When a
# voice_id isn't mapped we fall back by gender (see _edge_voice_for).
_EDGE_BY_ELEVEN_ID = {
    "4tRn1lSkEn13EVTuqb0g": "en-US-AriaNeural",       # Serafina  (f)
    "cgSgspJ2msm6clMCkdW9": "en-US-JennyNeural",      # Jessica   (f)
    "EXAVITQu4vr4xnSDxMaL": "en-GB-SoniaNeural",      # Sarah     (f)
    "21m00Tcm4TlvDq8ikWAM": "en-US-MichelleNeural",   # Rachel    (f)
    "ErXwobaYiN019PkySvjV": "en-US-GuyNeural",        # Antoni    (m)
    "VR6AewLTigWG4xSOukaG": "en-GB-RyanNeural",       # Arnold    (m)
    "pNInz6obpgDQGcFmaJgB": "en-US-ChristopherNeural",  # Adam    (m)
}
_EDGE_FEMALE_POOL = (
    "en-US-AriaNeural",
    "en-US-JennyNeural",
    "en-GB-SoniaNeural",
    "en-US-MichelleNeural",
)
_EDGE_MALE_POOL = (
    "en-US-GuyNeural",
    "en-US-ChristopherNeural",
    "en-GB-RyanNeural",
    "en-US-EricNeural",
)


_client = None
_eleven_blocked = False  # latched only on account-wide failure
_eleven_block_reason: str | None = None
# Per-voice 402 cache. A professional/cloned voice (e.g. Serafina) 402s on
# free/starter plans while *premade* voices on the same key still work. We
# must NOT globally latch on that — doing so collapses every voice to one
# edge-tts voice. Instead we remember which voice_ids are paywalled and
# fall back per-utterance for just those, mapped to a gender-matched edge
# voice so distinct selections still sound distinct.
_blocked_voices: set[str] = set()


def _force_edge() -> bool:
    return os.getenv("VOICE_FORCE_EDGE_TTS", "").lower() in ("1", "true", "yes")


def is_using_fallback() -> bool:
    return _eleven_blocked or _force_edge() or not settings.elevenlabs_api_key


def fallback_reason() -> str | None:
    if _force_edge():
        return "VOICE_FORCE_EDGE_TTS is set; using edge-tts"
    if not settings.elevenlabs_api_key:
        return "ELEVENLABS_API_KEY not set; using edge-tts"
    return _eleven_block_reason


def get_client():
    """Return a memoised ElevenLabs client. Raises if the key is missing."""
    global _client
    if _client is None:
        from elevenlabs.client import ElevenLabs

        api_key = settings.elevenlabs_api_key or None
        if not api_key:
            raise RuntimeError(
                "ELEVENLABS_API_KEY is not set; configure it in .env before"
                " starting a voice call."
            )
        _client = ElevenLabs(api_key=api_key)
    return _client


def _pick_voice(language: str | None, voice_id: str | None) -> str:
    if voice_id:
        return voice_id
    if language and language.lower() in _LANG_TO_VOICE:
        return _LANG_TO_VOICE[language.lower()]
    return _LANG_TO_VOICE["default"]


def _voice_settings():
    """Tuned for a more natural conversational delivery.

    stability ↓ → more expressive variation between sentences;
    similarity_boost ↑ → tighter timbre match to the voice's training set;
    style ↑ → a touch more prosody / inflection.
    """
    from elevenlabs import VoiceSettings

    return VoiceSettings(
        stability=0.4,
        similarity_boost=0.8,
        style=0.3,
        use_speaker_boost=True,
    )


def _add_natural_pauses(text: str) -> str:
    """Normalise punctuation so ElevenLabs' prosody engine paces naturally.

    Keeps the change minimal: ensure terminal punctuation, ensure a space
    after each comma, and collapse "..." to a real ellipsis so the model
    treats it as a pause rather than three discrete dots.
    """
    if not text:
        return text
    out = text.strip()
    if out and out[-1] not in ".!?":
        out += "."
    out = re.sub(r",(?!\s)", ", ", out)
    out = out.replace("...", "… ")
    return out


# Voice catalogue exposed to the frontend voice picker via /voice/voices.
# IDs come from ElevenLabs' public library; free accounts can't use library
# voices via the API and will fall back to edge-tts (see _latch_block).
AVAILABLE_VOICES: list[dict] = [
    {
        "id": "4tRn1lSkEn13EVTuqb0g",
        "name": "Serafina",
        "description": "Sweet, expressive female (premium — paid plan)",
        "gender": "female",
    },
    {
        "id": "cgSgspJ2msm6clMCkdW9",
        "name": "Jessica",
        "description": "Warm, conversational female",
        "gender": "female",
    },
    {
        "id": "EXAVITQu4vr4xnSDxMaL",
        "name": "Sarah",
        "description": "Soft, professional female",
        "gender": "female",
    },
    {
        "id": "ErXwobaYiN019PkySvjV",
        "name": "Antoni",
        "description": "Natural, friendly male",
        "gender": "male",
    },
    {
        "id": "pNInz6obpgDQGcFmaJgB",
        "name": "Adam",
        "description": "Professional, clear male",
        "gender": "male",
    },
]

# voice_id → gender, used to pick a gender-matched edge-tts fallback.
_VOICE_GENDER = {v["id"]: v.get("gender", "female") for v in AVAILABLE_VOICES}


def _edge_voice_for(voice_id: str | None, language: str) -> str:
    """Map an ElevenLabs voice_id to a *distinct* edge-tts voice.

    Non-English calls always use the language default (edge has no
    equivalent persona set). For English, an explicit per-id mapping wins;
    otherwise we deterministically pick from the gender pool so two
    different paid voices don't collapse to the same fallback.
    """
    lang = (language or "en").lower()
    if lang != "en":
        return _EDGE_VOICES.get(lang, _EDGE_VOICES["default"])
    if not voice_id:
        return _EDGE_VOICES["default"]
    mapped = _EDGE_BY_ELEVEN_ID.get(voice_id)
    if mapped:
        return mapped
    pool = (
        _EDGE_MALE_POOL
        if _VOICE_GENDER.get(voice_id) == "male"
        else _EDGE_FEMALE_POOL
    )
    return pool[hash(voice_id) % len(pool)]


# Cached result of get_available_voices() — the ElevenLabs voices.get_all()
# round trip is ~300ms and the catalogue doesn't change within a process.
_available_voices_cache: list[dict] | None = None


def get_available_voices() -> list[dict]:
    """Real, account-verified voice catalogue for the frontend picker.

    Fetches the key's actual voices from ElevenLabs and intersects with our
    curated preferred names, so voices that don't exist on this account
    (or were renamed) never reach the picker. Serafina is pinned first to
    match the product default. Falls back to the static AVAILABLE_VOICES if
    the API is unreachable.
    """
    global _available_voices_cache
    if _available_voices_cache is not None:
        return _available_voices_cache

    preferred = {
        "serafina": ("female", "Sweet, expressive female (premium — paid plan)"),
        "jessica": ("female", "Warm, conversational female"),
        "sarah": ("female", "Soft, professional female"),
        "rachel": ("female", "Natural female English"),
        "antoni": ("male", "Natural, friendly male"),
        "arnold": ("male", "Deep, confident male"),
        "adam": ("male", "Professional, clear male"),
    }
    try:
        client = get_client()
        response = client.voices.get_all()
        available: list[dict] = []
        for voice in response.voices:
            # ElevenLabs names look like "Serafina - Sensual Temptress";
            # match on the leading token against our preferred set.
            short = (voice.name or "").split(" - ")[0].strip()
            key = short.lower()
            if key not in preferred:
                continue
            gender, desc = preferred[key]
            available.append(
                {
                    "id": voice.voice_id,
                    "name": short,
                    "description": desc,
                    "gender": gender,
                }
            )
        # Pin Serafina first (product default), preserve a stable order.
        available.sort(key=lambda v: 0 if v["name"].lower() == "serafina" else 1)
        _available_voices_cache = available or AVAILABLE_VOICES
    except Exception as e:  # noqa: BLE001 — any failure → static fallback
        log.warning("Could not fetch voices from ElevenLabs: %s", e)
        _available_voices_cache = AVAILABLE_VOICES
    return _available_voices_cache


# SDK method drift: elevenlabs<=1.x → ``convert_as_stream``;
# later versions → ``stream`` (preferred) + ``convert``.
_TTS_STREAM_METHOD_NAMES = ("stream", "convert_as_stream", "convert")


def _resolve_stream_method(tts_namespace):
    for name in _TTS_STREAM_METHOD_NAMES:
        method = getattr(tts_namespace, name, None)
        if callable(method):
            return name, method
    return None, None


def _open_eleven_stream(text: str, language: str, voice_id: str | None):
    client = get_client()
    voice = _pick_voice(language, voice_id)
    method_name, method = _resolve_stream_method(client.text_to_speech)
    if method is None:
        raise RuntimeError(
            "ElevenLabs SDK has no compatible TTS streaming method "
            "(looked for: " + ", ".join(_TTS_STREAM_METHOD_NAMES) + ")."
        )
    log.debug("ElevenLabs stream via text_to_speech.%s", method_name)
    return method(
        voice_id=voice,
        text=_add_natural_pauses(text),
        model_id=settings.elevenlabs_model,
        voice_settings=_voice_settings(),
        output_format=settings.elevenlabs_output_format,
    )


def _is_paid_plan_required(err: BaseException) -> bool:
    """True if the exception is an ElevenLabs 402 / paid_plan_required."""
    status = getattr(err, "status_code", None)
    if status == 402:
        return True
    msg = str(err).lower()
    return "paid_plan_required" in msg or "free users cannot use library voices" in msg


def _block_voice(voice_id: str | None, err: BaseException) -> None:
    """Remember a single paywalled voice without killing the others.

    A 402 on one professional/cloned voice (e.g. Serafina on a free plan)
    used to latch a process-wide block, collapsing *every* voice to one
    edge-tts voice. We now scope the block to the offending voice_id so
    premade voices that work keep using ElevenLabs.
    """
    if voice_id:
        if voice_id not in _blocked_voices:
            log.warning(
                "ElevenLabs voice %s requires a paid plan (%s) — using a"
                " gender-matched edge-tts voice for this voice only.",
                voice_id,
                err,
            )
        _blocked_voices.add(voice_id)
    else:
        _latch_block(err)


def _latch_block(err: BaseException) -> None:
    global _eleven_blocked, _eleven_block_reason
    _eleven_blocked = True
    _eleven_block_reason = str(err)
    log.warning(
        "ElevenLabs blocked account-wide (%s) — falling back to edge-tts for"
        " the rest of the process. Upgrade your plan or set"
        " VOICE_FORCE_EDGE_TTS=1 to silence this.",
        err,
    )


# ---------------------------------------------------------------------------
# edge-tts fallback
# ---------------------------------------------------------------------------


async def _edge_stream(
    text: str, language: str, voice_id: str | None = None
) -> AsyncIterator[bytes]:
    import edge_tts

    edge_voice = _edge_voice_for(voice_id, language)
    log.info("[TTS] edge-tts fallback voice: %s (eleven=%s)", edge_voice, voice_id)
    communicate = edge_tts.Communicate(text, voice=edge_voice)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            yield chunk["data"]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def synthesize_streaming(
    text: str,
    language: str = "en",
    voice_id: str | None = None,
) -> AsyncIterator[bytes]:
    """Async-iterate MP3 chunks. Tries ElevenLabs first, falls back to edge-tts.

    Fallback is scoped per voice: a 402 on one paywalled voice routes only
    that voice to a gender-matched edge-tts voice; premade voices that work
    keep using ElevenLabs. An account-wide failure (no key / forced) still
    latches process-wide.
    """
    effective = _pick_voice(language, voice_id)
    log.info(
        "[TTS] Using voice: %s for language: %s (requested voice_id=%s)",
        effective,
        language,
        voice_id,
    )

    # Skip ElevenLabs entirely if the account is blocked, the key is
    # missing, the user forced the fallback, or this specific voice is
    # known-paywalled from an earlier 402.
    if is_using_fallback() or effective in _blocked_voices:
        async for chunk in _edge_stream(text, language, effective):
            yield chunk
        return

    def _open():
        return iter(_open_eleven_stream(text, language, voice_id))

    try:
        stream = await asyncio.to_thread(_open)
    except Exception as e:
        if _is_paid_plan_required(e):
            _block_voice(effective, e)
            async for chunk in _edge_stream(text, language, effective):
                yield chunk
            return
        log.exception("ElevenLabs stream open failed")
        raise

    _sentinel = object()

    def _next(it):
        try:
            return next(it)
        except StopIteration:
            return _sentinel

    # ElevenLabs streams open as a context manager; the 402 may surface on
    # the first ``next()`` rather than at open time, so we wrap the pump too.
    while True:
        try:
            chunk = await asyncio.to_thread(_next, stream)
        except Exception as e:
            if _is_paid_plan_required(e):
                _block_voice(effective, e)
                async for fb_chunk in _edge_stream(text, language, effective):
                    yield fb_chunk
                return
            raise
        if chunk is _sentinel:
            return
        if chunk:
            yield chunk


async def synthesize(
    text: str,
    language: str = "en",
    voice_id: str | None = None,
) -> bytes:
    """Buffer the full MP3 byte string."""
    chunks: list[bytes] = []
    async for chunk in synthesize_streaming(text, language, voice_id):
        chunks.append(chunk)
    return b"".join(chunks)


def test_connection() -> bool:
    """Verify the API key works by listing voices. Cheap call (no synth)."""
    try:
        client = get_client()
        client.voices.get_all()
        return True
    except Exception as e:
        log.warning("ElevenLabs test_connection failed: %s", e)
        return False


def preview_bytes(voice_id: str, text: str) -> bytes:
    """Sync preview synth used by the /voice/preview HTTP endpoint.

    On ElevenLabs 402, falls back to a one-shot edge-tts render so the
    preview button still produces audio.
    """

    def _edge_oneshot() -> bytes:
        # edge-tts is async; collect from its iterator on a private loop.
        # Pass voice_id so previews of different voices still sound
        # different even when ElevenLabs is paywalled.
        async def _collect() -> bytes:
            chunks: list[bytes] = []
            async for c in _edge_stream(text, "en", voice_id):
                chunks.append(c)
            return b"".join(chunks)

        return asyncio.run(_collect())

    if is_using_fallback() or voice_id in _blocked_voices:
        return _edge_oneshot()

    try:
        client = get_client()
    except Exception:
        return _edge_oneshot()

    _, method = _resolve_stream_method(client.text_to_speech)
    if method is None:
        raise RuntimeError("ElevenLabs SDK has no compatible TTS streaming method")

    try:
        stream = method(
            voice_id=voice_id,
            text=_add_natural_pauses(text),
            model_id=settings.elevenlabs_model,
            voice_settings=_voice_settings(),
            output_format=settings.elevenlabs_output_format,
        )
        return b"".join(c for c in stream if c)
    except Exception as e:
        if _is_paid_plan_required(e):
            _block_voice(voice_id, e)
            return _edge_oneshot()
        raise
