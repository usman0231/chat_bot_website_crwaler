"""WebSocket call endpoint at ``/ws/call/{bot_id}``.

Protocol summary
----------------

Client → Server (text frames containing JSON):

    {"type": "audio_chunk", "data": "<base64 PCM float32>", "sample_rate": 16000}
    {"type": "interrupt"}
    {"type": "end_call"}
    {"type": "ping"}

Server → Client:

    {"type": "ready"}
    {"type": "listening"}
    {"type": "speech_detected"}
    {"type": "processing"}
    {"type": "transcript", "text": "...", "lang": "en"}
    {"type": "bot_start", "text": "..."}
    {"type": "audio_chunk", "data": "<base64 MP3>"}
    {"type": "bot_end"}
    {"type": "error", "message": "..."}
    {"type": "pong"}

Auth: pass ``?token=<jwt>`` or ``?api_key=<sb_…>`` in the URL. Browsers
can't set custom headers on ``new WebSocket()`` so query-string auth is
the standard pattern.

For MP3 playback we send the full per-utterance MP3 in a single
``audio_chunk`` message. Per-chunk decoding via Web Audio's
``decodeAudioData`` is unreliable because edge-tts emits chunks that
aren't framed on MP3 boundaries; buffering server-side keeps the client
trivial (one ``<audio>`` element via Blob URL).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

import numpy as np
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from api import auth_db, registry
from api.jwt_utils import decode_token
from api.voice.budget import extract_budget
from api.voice.call_session import CallSession, CallState
from api.voice.stt import transcribe
from api.voice.tts import synthesize_streaming
from api.voice.vad import VADProcessor
from core.config import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["voice"])


def _resolve_user(
    token: str | None, api_key: str | None
) -> tuple[auth_db.User | None, bool]:
    """Resolve the caller. Returns (user, is_authorized).

    Mirrors ``require_auth_either``: JWT or per-user API key, with the
    legacy DEMO_API_KEY shared-admin fallback. Raising HTTPException from a
    WebSocket handler doesn't reach the client cleanly, so we return a
    tuple and the caller closes with a policy-violation code.
    """
    if token:
        payload: dict[str, Any] | None = decode_token(token)
        if not payload:
            return None, False
        user_id = payload.get("sub")
        if not isinstance(user_id, str):
            return None, False
        user = auth_db.get_user_by_id(user_id)
        if user is None:
            return None, False
        return user, True

    if api_key:
        user = auth_db.get_user_by_api_key(api_key)
        if user is not None:
            return user, True
        if settings.demo_api_key and api_key == settings.demo_api_key:
            return None, True  # legacy admin/widget — anonymous but allowed
    return None, False


@router.websocket("/call/{bot_id}")
async def call_endpoint(
    websocket: WebSocket,
    bot_id: str,
    token: str | None = Query(default=None),
    api_key: str | None = Query(default=None),
):
    user, authorized = _resolve_user(token, api_key)
    if not authorized:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Authentication required"
        )
        return

    reg = registry.load_registry()
    bot_info = reg.get(bot_id)
    if bot_info is None:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "Bot not found"})
        await websocket.close()
        return

    owner = bot_info.get("user_id")
    if user is not None and owner is not None and owner != user.id:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Forbidden"
        )
        return

    if bot_info.get("status") != "ready":
        await websocket.accept()
        await websocket.send_json(
            {"type": "error", "message": "Bot is not ready yet"}
        )
        await websocket.close()
        return

    website_name = bot_info.get("website_name", "") or "this site"
    await websocket.accept()

    # Lazy imports — defer heavy ML deps until a call actually starts so the
    # rest of the API stays importable even before voice deps are installed.
    try:
        from api.main import _bot_cache
        from core.rag import WebsiteBot
    except Exception as e:
        log.exception("Failed to import RAG dependencies for call")
        await websocket.send_json(
            {"type": "error", "message": f"Server initialization failed: {e}"}
        )
        await websocket.close()
        return

    bot = _bot_cache.get(bot_id)
    if bot is None:
        try:
            bot = WebsiteBot(bot_id, website_name)
            _bot_cache[bot_id] = bot
        except Exception as e:
            log.exception("Failed to load WebsiteBot for %s", bot_id)
            await websocket.send_json(
                {"type": "error", "message": f"Bot init failed: {e}"}
            )
            await websocket.close()
            return

    try:
        vad = VADProcessor(
            sample_rate=settings.voice_sample_rate,
            silence_threshold_ms=settings.vad_silence_ms,
        )
    except Exception as e:
        log.exception("VAD init failed")
        await websocket.send_json(
            {"type": "error", "message": f"VAD unavailable: {e}"}
        )
        await websocket.close()
        return

    session = CallSession(bot_id, website_name)
    voice_id: str | None = bot_info.get("voice_id") or None
    log.info("[Call] bot=%s using voice_id: %s", bot_id, voice_id)

    # Pre-warm the ElevenLabs HTTP client so the first synth doesn't pay the
    # connection-setup tax. Non-fatal — the call still works if this fails.
    try:
        from api.voice.tts import get_client

        await asyncio.to_thread(get_client)
    except Exception as e:
        log.warning("ElevenLabs pre-warm failed: %s", e)

    await websocket.send_json({"type": "ready"})
    session.state = CallState.LISTENING

    greeting = (
        f"Hello! Thank you for calling {website_name}. How can I help you today?"
    )
    await _speak(websocket, greeting, "en", session, voice_id=voice_id)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = msg.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "end_call":
                farewell = "Thank you for calling. Have a great day!"
                await _speak(
                    websocket,
                    farewell,
                    session.detected_language,
                    session,
                    voice_id=voice_id,
                )
                break

            if msg_type == "interrupt":
                if session.state == CallState.SPEAKING:
                    session.state = CallState.INTERRUPTED
                    await websocket.send_json({"type": "listening"})
                continue

            if msg_type == "audio_chunk":
                if session.state == CallState.PROCESSING:
                    # Ignore mid-flight chunks while STT/RAG is running.
                    continue
                try:
                    raw_bytes = base64.b64decode(msg.get("data") or "")
                except (ValueError, TypeError):
                    continue
                if not raw_bytes:
                    continue
                audio_array = np.frombuffer(raw_bytes, dtype=np.float32)
                if audio_array.size == 0:
                    continue

                vad_result = vad.process_chunk(audio_array)
                event = vad_result["event"]

                if event == "speech_start":
                    if session.state == CallState.SPEAKING:
                        # Barge-in: stop the bot, let it listen.
                        session.state = CallState.INTERRUPTED
                    await websocket.send_json({"type": "speech_detected"})

                elif event == "speech_end":
                    utterance = vad_result["audio"] or b""
                    if not utterance:
                        session.state = CallState.LISTENING
                        await websocket.send_json({"type": "listening"})
                        continue

                    # Drop sub-0.3s utterances — almost always a cough,
                    # mouth click, or background noise that the VAD
                    # briefly fired on. 4800 samples = 0.3s @ 16k.
                    utterance_array = np.frombuffer(utterance, dtype=np.float32)
                    if utterance_array.size < 4800:
                        session.state = CallState.LISTENING
                        await websocket.send_json({"type": "listening"})
                        continue

                    session.state = CallState.PROCESSING
                    await websocket.send_json({"type": "processing"})

                    initial_prompt = (
                        f"Customer calling {website_name} support."
                    )
                    try:
                        stt_result = await asyncio.to_thread(
                            transcribe, utterance, initial_prompt=initial_prompt
                        )
                    except Exception as e:
                        log.exception("STT failed")
                        await websocket.send_json(
                            {"type": "error", "message": f"Speech recognition failed: {e}"}
                        )
                        session.state = CallState.LISTENING
                        await websocket.send_json({"type": "listening"})
                        continue

                    user_text = (stt_result.get("text") or "").strip()
                    detected_lang = stt_result.get("language") or "en"
                    session.detected_language = detected_lang

                    if not user_text:
                        session.state = CallState.LISTENING
                        await websocket.send_json({"type": "listening"})
                        continue

                    # Fire-and-await: show the transcript on the client at
                    # the same time we kick off RAG. RAG dominates the wall
                    # clock, so this lets the UI update before the LLM
                    # finishes.
                    budget = extract_budget(user_text)
                    system_suffix: str | None = None
                    if budget is not None:
                        system_suffix = (
                            "BUDGET CONSTRAINT: The user's budget is "
                            f"Rs. {budget:,.0f} (strict upper bound). ONLY "
                            "suggest products priced BELOW this amount. If "
                            "no products in CONTEXT match, say clearly "
                            "that no options are available in that range."
                        )
                        log.info(
                            "Budget detected: Rs. %.0f from utterance: %s",
                            budget,
                            user_text[:120],
                        )

                    send_task = asyncio.create_task(
                        websocket.send_json(
                            {"type": "transcript", "text": user_text, "lang": detected_lang}
                        )
                    )
                    rag_task = asyncio.create_task(
                        asyncio.to_thread(
                            bot.answer,
                            user_text,
                            history=session.get_history(),
                            system_suffix=system_suffix,
                        )
                    )

                    try:
                        await send_task
                        rag_result = await rag_task
                    except Exception as e:
                        log.exception("RAG answer failed")
                        # Make sure the dangling task doesn't keep running.
                        if not rag_task.done():
                            rag_task.cancel()
                        await websocket.send_json(
                            {"type": "error", "message": f"Answer failed: {e}"}
                        )
                        session.state = CallState.LISTENING
                        await websocket.send_json({"type": "listening"})
                        continue

                    bot_text = (rag_result.get("answer") or "").strip()
                    if not bot_text:
                        session.state = CallState.LISTENING
                        await websocket.send_json({"type": "listening"})
                        continue

                    session.add_turn(user_text, bot_text)
                    session.state = CallState.SPEAKING
                    await _speak(
                        websocket, bot_text, detected_lang, session, voice_id=voice_id
                    )

    except WebSocketDisconnect:
        log.info("Call WS disconnected for bot=%s", bot_id)
    except Exception:
        log.exception("Call WS handler crashed")
        try:
            await websocket.send_json(
                {"type": "error", "message": "Internal server error"}
            )
        except Exception:
            pass
    finally:
        vad.reset()
        try:
            await websocket.close()
        except Exception:
            pass


async def _speak(
    websocket: WebSocket,
    text: str,
    language: str,
    session: CallSession,
    voice_id: str | None = None,
) -> None:
    """Synthesize ``text`` and ship the audio + bookend events to the client.

    Sends ``bot_start`` immediately so the UI can render the transcript
    line, then streams MP3 chunks from ElevenLabs as soon as they arrive.
    The client accumulates chunks across one utterance and plays them on
    ``bot_end`` — individual chunks are not standalone-decodable MP3 frames.

    Honours ``session.state == INTERRUPTED`` mid-stream.
    """
    session.state = CallState.SPEAKING
    await websocket.send_json({"type": "bot_start", "text": text})

    chunk_count = 0
    try:
        async for audio_chunk in synthesize_streaming(text, language, voice_id):
            if session.state == CallState.INTERRUPTED:
                break
            if not audio_chunk:
                continue
            await websocket.send_json(
                {
                    "type": "audio_chunk",
                    "data": base64.b64encode(audio_chunk).decode(),
                }
            )
            chunk_count += 1
    except Exception as e:
        log.exception("TTS failed")
        await websocket.send_json(
            {"type": "error", "message": f"Text-to-speech failed: {e}"}
        )
        session.state = CallState.LISTENING
        await websocket.send_json({"type": "listening"})
        return

    await websocket.send_json({"type": "bot_end"})

    if session.state != CallState.INTERRUPTED:
        session.state = CallState.LISTENING
        await websocket.send_json({"type": "listening"})
    else:
        session.state = CallState.LISTENING

    log.debug("_speak sent %d MP3 chunks", chunk_count)
