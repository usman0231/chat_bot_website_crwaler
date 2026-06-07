"""
FastAPI application entry point.

Endpoints:
  GET  /                       liveness + model info
  GET  /health                 health probe
  POST /bot/create             create a bot, train in background
  GET  /bot/{bot_id}/status    poll training status
  POST /bot/{bot_id}/chat      ask the bot a question
  POST /bot/{bot_id}/chat/stream  stream tokens via Server-Sent Events
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from api import auth_db, conversations_db, registry
from api.auth import require_auth_either
from api.auth_endpoints import router as auth_router
from api.schemas import (
    BotSummary,
    ChatRequest,
    ChatResponse,
    ConversationDetailResponse,
    ConversationListResponse,
    ConversationMessage,
    ConversationSummary,
    CreateBotRequest,
    CreateBotResponse,
    DeleteBotResponse,
    ListBotsResponse,
    RecrawlResponse,
    RegenerateQuestionsResponse,
    SourcePage,
    SourcesResponse,
    StatusResponse,
    UpdateQuestionsRequest,
    UpdateQuestionsResponse,
    UpdateVoiceRequest,
    UpdateVoiceResponse,
)
from api.stripe_endpoints import router as stripe_router
from api.voice.router import router as voice_router
from api.tiers import limits_for
from core import llm
from core.config import settings

log = logging.getLogger(__name__)

app = FastAPI(
    title="site-bot API",
    description=(
        "Train a chatbot on any website. Drop a URL — the system crawls, "
        "embeds, and serves a strictly-scoped Q&A API. Off-topic questions "
        "are refused by design."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(stripe_router)
app.include_router(voice_router)


# Embeddable chat widget — served as static files. The dist directory is
# produced by `cd frontend-widget && node build.js`; if it isn't built yet
# we still want the API to start, so the mount is conditional.
_WIDGET_DIST = Path(__file__).resolve().parent.parent / "frontend-widget" / "dist"
if _WIDGET_DIST.is_dir():
    app.mount("/widget", StaticFiles(directory=str(_WIDGET_DIST)), name="widget")


@app.get("/widget.js", tags=["meta"], include_in_schema=False)
async def widget_js():
    path = _WIDGET_DIST / "widget.js"
    if not path.is_file():
        raise HTTPException(
            503,
            "Widget bundle not built. Run `cd frontend-widget && node build.js`.",
        )
    return FileResponse(str(path), media_type="application/javascript")


_bot_cache: dict = {}

_HISTORY_TURNS = 6


def _openai_history(history) -> list[dict]:
    """Convert ChatHistoryMessage[] (with 'bot' role) to OpenAI format.
    Keeps only the last _HISTORY_TURNS entries — the rest is just LLM
    context noise and would risk blowing the model's context window."""
    return [
        {"role": "assistant" if h.role == "bot" else "user", "content": h.content}
        for h in history[-_HISTORY_TURNS:]
    ]


def _enforce_message_quota(requester: auth_db.User | None) -> None:
    """Raise 429 if the requester is over their tier's monthly message cap.

    Counter is incremented here so quota is enforced at the boundary of the
    chat call rather than waiting for the LLM round trip.
    """
    if requester is None:
        return
    auth_db.reset_monthly_counter_if_needed(requester.id)
    fresh = auth_db.get_user_by_id(requester.id)
    if fresh is None:
        return
    limit = limits_for(fresh.tier)["monthly_messages"]
    if fresh.messages_this_month >= limit:
        raise HTTPException(
            429,
            f"Monthly message limit reached ({limit}) on the {fresh.tier} plan."
            " Upgrade to keep chatting.",
        )
    auth_db.increment_message_counter(requester.id)


def _ensure_visible(entry: dict, requester: auth_db.User | None, bot_id: str) -> None:
    """Raise 403 if a JWT user tries to touch a bot owned by someone else.

    Bots without a user_id are treated as shared (visible to everyone, the
    widget included). API-key callers (requester=None) get full access.
    """
    if requester is None:
        return
    owner = entry.get("user_id")
    if owner is None:
        return
    if owner != requester.id:
        raise HTTPException(403, f"Bot '{bot_id}' is not accessible")


def _new_visitor_id() -> str:
    return "vis_" + uuid.uuid4().hex[:16]


def _persist_chat_turn(
    bot_id: str, visitor_id: str | None, user_text: str, assistant_text: str
) -> None:
    """Synchronously store one chat turn. Runs off the event loop (in a
    threadpool) so the user-facing reply is never blocked by SQLite I/O.
    All failures are swallowed — persistence must never break a chat."""
    try:
        conv_id = conversations_db.create_or_get_conversation(
            bot_id, "chat", visitor_id
        )
        conversations_db.add_message(conv_id, "user", user_text)
        conversations_db.add_message(conv_id, "assistant", assistant_text)
    except Exception:
        log.warning("Failed to persist chat turn for bot %s", bot_id, exc_info=True)


def _save_chat_turn_bg(
    bot_id: str, visitor_id: str | None, user_text: str, assistant_text: str
) -> None:
    """Fire-and-forget the chat-turn save onto a worker thread."""
    if not (user_text and assistant_text):
        return
    asyncio.create_task(
        asyncio.to_thread(
            _persist_chat_turn, bot_id, visitor_id, user_text, assistant_text
        )
    )


@app.get("/", tags=["meta"])
async def root():
    return {
        "name": "site-bot",
        "version": "0.1.0",
        "status": "ok",
        "llm_backend": "ollama",
        "model": settings.llm_model,
    }


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "healthy"}


def _train_bot(bot_id: str, website_url: str, max_pages: int) -> None:
    """Sync wrapper so FastAPI runs this in a threadpool with a fresh event loop.

    Playwright needs subprocess support, which requires a ProactorEventLoop on
    Windows. Uvicorn's main loop is a SelectorEventLoop, so we spin up our own
    loop in this worker thread.
    """
    from ingest import crawler, pipeline

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    log.info("Crawling up to %d pages from %s", max_pages, website_url)
    registry.update_bot(
        bot_id,
        stage="crawling",
        started_at=datetime.now(timezone.utc).isoformat(),
        max_pages=max_pages,
    )

    def on_progress(crawled: int, total: int) -> None:
        registry.update_bot(bot_id, pages_crawled=crawled, pages_total=total)

    try:
        pages = asyncio.run(
            crawler.crawl(website_url, max_pages, progress_callback=on_progress)
        )
        registry.update_bot(
            bot_id,
            stage="embedding",
            pages_crawled=len(pages),
            pages_total=len(pages),
        )

        def on_ingest_phase(phase: str) -> None:
            if phase == "indexing":
                registry.update_bot(bot_id, stage="indexing")

        result = pipeline.ingest_website(
            bot_id, pages, phase_callback=on_ingest_phase
        )

        # Try to generate suggested questions from the indexed content. Best
        # effort — failures here must not break the training.
        suggested = pipeline.generate_suggested_questions(bot_id)

        registry.update_bot(
            bot_id,
            status="ready",
            stage="done",
            pages=len(pages),
            chunks=result["chunks"],
            suggested_questions=suggested,
        )
    except Exception as e:
        registry.update_bot(
            bot_id,
            status="failed",
            stage=None,
            error=str(e)[:500],
        )


@app.post(
    "/bot/create",
    response_model=CreateBotResponse,
    tags=["bot"],
)
async def create_bot(
    req: CreateBotRequest,
    background: BackgroundTasks,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    # Tier checks only apply when a user owns the request. Legacy
    # (DEMO_API_KEY-style) admin callers bypass the cap.
    if requester is not None:
        limits = limits_for(requester.tier)
        owned = sum(
            1
            for entry in registry.load_registry().values()
            if entry.get("user_id") == requester.id
        )
        if owned >= limits["max_bots"]:
            raise HTTPException(
                403,
                f"You're on the {requester.tier} plan ({limits['max_bots']} bot"
                f"{'s' if limits['max_bots'] != 1 else ''}). Upgrade for more.",
            )
        requested = req.max_pages or settings.max_pages
        cap = limits["max_pages_per_bot"]
        max_pages = min(requested, cap)
    else:
        max_pages = req.max_pages or settings.max_pages

    bot_id = "bot_" + uuid.uuid4().hex[:10]
    registry.update_bot(
        bot_id,
        website_url=str(req.website_url),
        website_name=req.website_name,
        status="training",
        stage="queued",
        pages_crawled=0,
        pages_total=None,
        pages=None,
        chunks=None,
        error=None,
        created_at=datetime.now(timezone.utc).isoformat(),
        started_at=None,
        user_id=requester.id if requester else None,
        max_pages=max_pages,
    )
    background.add_task(_train_bot, bot_id, str(req.website_url), max_pages)
    return CreateBotResponse(bot_id=bot_id, status="training", website_name=req.website_name)


@app.get(
    "/bots",
    response_model=ListBotsResponse,
    tags=["bot"],
)
async def list_bots(
    requester: auth_db.User | None = Depends(require_auth_either),
):
    reg = registry.load_registry()
    bots: list[BotSummary] = []
    for bot_id, entry in reg.items():
        owner = entry.get("user_id")
        if requester is not None:
            # JWT caller: only own bots + shared (unowned) bots.
            if owner is not None and owner != requester.id:
                continue
        # API-key callers get the full list (admin/widget).
        bots.append(
            BotSummary(
                bot_id=bot_id,
                website_url=entry.get("website_url", "") or "",
                website_name=entry.get("website_name", "") or "",
                status=entry.get("status", "training"),
                pages=entry.get("pages"),
                chunks=entry.get("chunks"),
                created_at=entry.get("created_at"),
                error=entry.get("error"),
                user_id=owner,
                shared=owner is None,
            )
        )
    # Newest first when created_at is present; unknowns sort to the bottom.
    bots.sort(key=lambda b: b.created_at or "", reverse=True)
    return ListBotsResponse(bots=bots)


@app.get(
    "/bot/{bot_id}/status",
    response_model=StatusResponse,
    tags=["bot"],
)
async def bot_status(
    bot_id: str,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if not entry:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    started_at = entry.get("started_at")
    elapsed_seconds: float | None = None
    if started_at:
        try:
            start = datetime.fromisoformat(started_at)
            elapsed_seconds = round(
                (datetime.now(timezone.utc) - start).total_seconds(), 2
            )
        except (ValueError, TypeError):
            elapsed_seconds = None

    return StatusResponse(
        bot_id=bot_id,
        website_name=entry.get("website_name", ""),
        status=entry.get("status", "training"),
        stage=entry.get("stage"),
        pages_crawled=entry.get("pages_crawled"),
        pages_total=entry.get("pages_total"),
        pages=entry.get("pages"),
        chunks=entry.get("chunks"),
        elapsed_seconds=elapsed_seconds,
        error=entry.get("error"),
        created_at=entry.get("created_at"),
        suggested_questions=entry.get("suggested_questions") or [],
        voice_id=entry.get("voice_id"),
    )


@app.post(
    "/bot/{bot_id}/chat",
    response_model=ChatResponse,
    tags=["bot"],
)
async def bot_chat(
    bot_id: str,
    req: ChatRequest,
    requester: auth_db.User | None = Depends(require_auth_either),
    visitor_id: str | None = Query(default=None),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if not entry:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)
    status = entry.get("status")
    if status != "ready":
        raise HTTPException(409, f"Bot is {status}, not ready yet")
    if not llm.ping():
        raise HTTPException(503, "LLM backend (Ollama) is not reachable")
    _enforce_message_quota(requester)

    bot = _bot_cache.get(bot_id)
    if bot is None:
        from core.rag import WebsiteBot

        bot = WebsiteBot(bot_id, entry.get("website_name", ""))
        _bot_cache[bot_id] = bot

    # Body wins over query string; fall back to a freshly minted id.
    vid = req.visitor_id or visitor_id or _new_visitor_id()

    result = bot.answer(req.message, history=_openai_history(req.history))
    _save_chat_turn_bg(bot_id, vid, req.message, result["answer"])
    return ChatResponse(
        answer=result["answer"],
        sources=result["sources"],
        in_scope=result["in_scope"],
        match_quality=result["match_quality"],
        visitor_id=vid,
    )


@app.post(
    "/bot/{bot_id}/chat/stream",
    tags=["bot"],
)
async def bot_chat_stream(
    bot_id: str,
    req: ChatRequest,
    requester: auth_db.User | None = Depends(require_auth_either),
    visitor_id: str | None = Query(default=None),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if not entry:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)
    status = entry.get("status")
    if status != "ready":
        raise HTTPException(409, f"Bot is {status}, not ready yet")
    if not llm.ping():
        raise HTTPException(503, "LLM backend (Ollama) is not reachable")
    _enforce_message_quota(requester)

    bot = _bot_cache.get(bot_id)
    if bot is None:
        from core.rag import WebsiteBot

        bot = WebsiteBot(bot_id, entry.get("website_name", ""))
        _bot_cache[bot_id] = bot

    openai_history = _openai_history(req.history)
    vid = req.visitor_id or visitor_id or _new_visitor_id()

    def event_stream():
        def sse(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        assistant_parts: list[str] = []
        try:
            canned = bot.quick_reply(req.message)
            if canned is not None:
                assistant_parts.append(canned["answer"])
                yield sse({"type": "token", "content": canned["answer"]})
                yield sse(
                    {
                        "type": "meta",
                        "sources": [],
                        "in_scope": True,
                        "match_quality": canned["match_quality"],
                        "visitor_id": vid,
                    }
                )
                yield sse({"type": "done"})
                return

            ctx = bot.retrieve(req.message)
            if not ctx["in_scope"]:
                assistant_parts.append(ctx["answer"])
                yield sse({"type": "token", "content": ctx["answer"]})
                yield sse(
                    {
                        "type": "meta",
                        "sources": [],
                        "in_scope": False,
                        "match_quality": "none",
                        "visitor_id": vid,
                    }
                )
                yield sse({"type": "done"})
                return

            for token in llm.chat_stream(
                system=ctx["system_prompt"],
                user=req.message,
                history=openai_history,
                temperature=0.1,
            ):
                assistant_parts.append(token)
                yield sse({"type": "token", "content": token})

            yield sse(
                {
                    "type": "meta",
                    "sources": ctx["sources"],
                    "in_scope": True,
                    "match_quality": ctx["match_quality"],
                    "visitor_id": vid,
                }
            )
            yield sse({"type": "done"})
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})
        finally:
            # Persist after the response has been streamed to the client, so
            # saving adds no latency to the visible reply. Runs in the stream's
            # own worker thread; best-effort.
            assistant_text = "".join(assistant_parts).strip()
            if assistant_text:
                _persist_chat_turn(bot_id, vid, req.message, assistant_text)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.delete(
    "/bot/{bot_id}",
    response_model=DeleteBotResponse,
    tags=["bot"],
)
async def delete_bot(
    bot_id: str,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if entry is None:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    registry.delete_bot(bot_id)
    _bot_cache.pop(bot_id, None)

    try:
        import chromadb

        client = chromadb.PersistentClient(path=str(settings.chroma_dir))
        client.delete_collection(bot_id)
    except Exception:
        pass

    return DeleteBotResponse(bot_id=bot_id, deleted=True)


@app.get(
    "/bot/{bot_id}/sources",
    response_model=SourcesResponse,
    tags=["bot"],
)
async def bot_sources(
    bot_id: str,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if entry is None:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    import chromadb

    grouped: dict[str, dict[str, object]] = {}
    try:
        client = chromadb.PersistentClient(path=str(settings.chroma_dir))
        collection = client.get_collection(bot_id)
        peek = collection.peek(limit=1000)
        metadatas = peek.get("metadatas") or []
        for meta in metadatas:
            if not meta:
                continue
            url = str(meta.get("url") or "")
            if not url:
                continue
            title = str(meta.get("title") or "")
            entry = grouped.get(url)
            if entry is None:
                grouped[url] = {"url": url, "title": title, "chunk_count": 1}
            else:
                entry["chunk_count"] = int(entry["chunk_count"]) + 1  # type: ignore[arg-type]
                if not entry["title"] and title:
                    entry["title"] = title
    except Exception:
        grouped = {}

    sources = [
        SourcePage(
            url=str(entry["url"]),
            title=str(entry["title"]),
            chunk_count=int(entry["chunk_count"]),  # type: ignore[arg-type]
        )
        for entry in grouped.values()
    ]
    sources.sort(key=lambda s: s.url)
    return SourcesResponse(bot_id=bot_id, sources=sources)


@app.get(
    "/bot/{bot_id}/conversations",
    response_model=ConversationListResponse,
    tags=["conversations"],
)
async def list_bot_conversations(
    bot_id: str,
    requester: auth_db.User | None = Depends(require_auth_either),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Owner-only list of a bot's stored conversations, newest first.

    Summaries are NOT generated here (that would fan out an LLM call per row);
    they appear once the owner opens an individual conversation.
    """
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if entry is None:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    convs = await asyncio.to_thread(
        conversations_db.list_conversations, bot_id, limit, offset
    )
    return ConversationListResponse(
        bot_id=bot_id,
        conversations=[
            ConversationSummary(
                id=c.id,
                channel=c.channel,  # type: ignore[arg-type]
                visitor_id=c.visitor_id,
                started_at=c.started_at,
                last_at=c.last_at,
                message_count=c.message_count,
                summary=c.summary,
            )
            for c in convs
        ],
    )


@app.get(
    "/bot/{bot_id}/conversations/{conversation_id}",
    response_model=ConversationDetailResponse,
    tags=["conversations"],
)
async def get_bot_conversation(
    bot_id: str,
    conversation_id: str,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    """Owner-only full transcript. Generates (and caches) the AI summary
    on demand when it's missing or stale."""
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if entry is None:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    loaded = await asyncio.to_thread(
        conversations_db.get_conversation, conversation_id
    )
    if loaded is None:
        raise HTTPException(404, f"Conversation '{conversation_id}' not found")
    conv, messages = loaded
    # A conversation id is global; make sure it actually belongs to this bot so
    # one owner can't read another bot's transcript by guessing the id.
    if conv.bot_id != bot_id:
        raise HTTPException(404, f"Conversation '{conversation_id}' not found")

    summary = conv.summary
    if await asyncio.to_thread(conversations_db.needs_summary, conversation_id):
        generated = await asyncio.to_thread(
            conversations_db.summarize_conversation, conversation_id
        )
        if generated:
            summary = generated

    return ConversationDetailResponse(
        id=conv.id,
        bot_id=conv.bot_id,
        channel=conv.channel,  # type: ignore[arg-type]
        visitor_id=conv.visitor_id,
        started_at=conv.started_at,
        last_at=conv.last_at,
        message_count=conv.message_count,
        summary=summary,
        messages=[
            ConversationMessage(
                id=m.id,
                role=m.role,  # type: ignore[arg-type]
                content=m.content,
                created_at=m.created_at,
            )
            for m in messages
        ],
    )


@app.post(
    "/bot/{bot_id}/recrawl",
    response_model=RecrawlResponse,
    tags=["bot"],
)
async def bot_recrawl(
    bot_id: str,
    background: BackgroundTasks,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if not entry:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    website_url = entry.get("website_url")
    if not website_url:
        raise HTTPException(400, "Bot has no website_url stored")

    _bot_cache.pop(bot_id, None)
    registry.update_bot(
        bot_id,
        status="training",
        stage="queued",
        pages_crawled=0,
        pages_total=None,
        pages=None,
        chunks=None,
        error=None,
        started_at=None,
    )
    # Honour the bot's original max_pages, capped by the requester's current
    # tier. Falls back to the env default if neither is set.
    stored = entry.get("max_pages")
    base_pages = int(stored) if isinstance(stored, int) else settings.max_pages
    if requester is not None:
        base_pages = min(base_pages, limits_for(requester.tier)["max_pages_per_bot"])
    background.add_task(_train_bot, bot_id, str(website_url), base_pages)
    return RecrawlResponse(bot_id=bot_id, status="training")


_MAX_QUESTION_CHARS = 120


@app.put(
    "/bot/{bot_id}/questions",
    response_model=UpdateQuestionsResponse,
    tags=["bot"],
)
async def update_bot_questions(
    bot_id: str,
    req: UpdateQuestionsRequest,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if entry is None:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    cleaned: list[str] = []
    for q in req.questions:
        text = (q or "").strip()
        if not text:
            raise HTTPException(422, "Questions must be non-empty strings")
        if len(text) > _MAX_QUESTION_CHARS:
            raise HTTPException(
                422,
                f"Each question must be {_MAX_QUESTION_CHARS} characters or fewer",
            )
        cleaned.append(text)

    registry.update_bot(bot_id, suggested_questions=cleaned)
    _bot_cache.pop(bot_id, None)
    return UpdateQuestionsResponse(bot_id=bot_id, questions=cleaned)


@app.post(
    "/bot/{bot_id}/questions/regenerate",
    response_model=RegenerateQuestionsResponse,
    tags=["bot"],
)
async def regenerate_bot_questions(
    bot_id: str,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if entry is None:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    from ingest import pipeline

    questions = pipeline.regenerate_questions_for_bot(bot_id)
    return RegenerateQuestionsResponse(bot_id=bot_id, questions=questions)


_PREVIEW_TEXT_MAX = 200


@app.get("/voice/tts-test", tags=["voice"])
async def tts_test():
    """Cheap connectivity check — lists voices, no synthesis cost."""
    from api.voice.tts import test_connection

    ok = await asyncio.to_thread(test_connection)
    return {"elevenlabs_ok": ok}


@app.get("/voice/voices", tags=["voice"])
async def list_voices():
    """Catalogue of voice options the frontend picker shows.

    Resolved against the ElevenLabs account so voices that don't exist on
    this key never reach the picker (run off-thread — it does a network
    round trip on first call, then caches).
    """
    from api.voice.tts import get_available_voices

    voices = await asyncio.to_thread(get_available_voices)
    return {"voices": voices}


@app.get("/voice/preview", tags=["voice"])
async def voice_preview(
    voice_id: str,
    text: str = "Hello! We're happy to help you today.",
    requester: auth_db.User | None = Depends(require_auth_either),
):
    """Synthesize a short sample so the dashboard can preview voices."""
    del requester  # auth-gated; resolved user isn't needed beyond that
    sample = (text or "").strip()
    if not sample:
        raise HTTPException(422, "text must be non-empty")
    if len(sample) > _PREVIEW_TEXT_MAX:
        sample = sample[:_PREVIEW_TEXT_MAX]
    if not voice_id or len(voice_id) > 64:
        raise HTTPException(422, "Invalid voice_id")

    from api.voice.tts import preview_bytes

    try:
        audio = await asyncio.to_thread(preview_bytes, voice_id, sample)
    except RuntimeError as e:
        # Missing API key surfaces as RuntimeError from get_client.
        raise HTTPException(503, str(e)) from e
    except Exception as e:
        log.exception("voice preview failed")
        raise HTTPException(502, f"TTS provider error: {e}") from e

    return Response(content=audio, media_type="audio/mpeg")


@app.put(
    "/bot/{bot_id}/voice",
    response_model=UpdateVoiceResponse,
    tags=["bot"],
)
async def update_bot_voice(
    bot_id: str,
    req: UpdateVoiceRequest,
    requester: auth_db.User | None = Depends(require_auth_either),
):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if entry is None:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    _ensure_visible(entry, requester, bot_id)

    registry.update_bot(bot_id, voice_id=req.voice_id)
    # The RAG WebsiteBot is voice-agnostic (voice_id is read fresh from the
    # registry on each call), but evict it anyway so nothing stale lingers.
    _bot_cache.pop(bot_id, None)
    log.info("[Voice] Bot %s voice updated to: %s", bot_id, req.voice_id)
    return UpdateVoiceResponse(bot_id=bot_id, voice_id=req.voice_id)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "api.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=True,
    )


if __name__ == "__main__":
    run()
