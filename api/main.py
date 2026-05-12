"""
FastAPI application entry point.

Endpoints:
  GET  /                       liveness + model info
  GET  /health                 health probe
  POST /bot/create             create a bot, train in background
  GET  /bot/{bot_id}/status    poll training status
  POST /bot/{bot_id}/chat      ask the bot a question
"""

from __future__ import annotations

import asyncio
import sys
import uuid

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from api import registry
from api.auth import require_api_key
from api.schemas import (
    ChatRequest,
    ChatResponse,
    CreateBotRequest,
    CreateBotResponse,
    StatusResponse,
)
from core import llm
from core.config import settings

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


_bot_cache: dict = {}


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

    try:
        pages = asyncio.run(crawler.crawl(website_url, max_pages))
        result = pipeline.ingest_website(bot_id, pages)
        registry.update_bot(
            bot_id,
            status="ready",
            pages=len(pages),
            chunks=result["chunks"],
        )
    except Exception as e:
        registry.update_bot(bot_id, status="failed", error=str(e)[:500])


@app.post(
    "/bot/create",
    response_model=CreateBotResponse,
    tags=["bot"],
    dependencies=[Depends(require_api_key)],
)
async def create_bot(req: CreateBotRequest, background: BackgroundTasks):
    bot_id = "bot_" + uuid.uuid4().hex[:10]
    registry.update_bot(
        bot_id,
        website_url=str(req.website_url),
        website_name=req.website_name,
        status="training",
        pages=None,
        chunks=None,
        error=None,
    )
    max_pages = req.max_pages or settings.max_pages
    background.add_task(_train_bot, bot_id, str(req.website_url), max_pages)
    return CreateBotResponse(bot_id=bot_id, status="training", website_name=req.website_name)


@app.get(
    "/bot/{bot_id}/status",
    response_model=StatusResponse,
    tags=["bot"],
    dependencies=[Depends(require_api_key)],
)
async def bot_status(bot_id: str):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if not entry:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    return StatusResponse(
        bot_id=bot_id,
        website_name=entry.get("website_name", ""),
        status=entry.get("status", "training"),
        pages=entry.get("pages"),
        chunks=entry.get("chunks"),
        error=entry.get("error"),
    )


@app.post(
    "/bot/{bot_id}/chat",
    response_model=ChatResponse,
    tags=["bot"],
    dependencies=[Depends(require_api_key)],
)
async def bot_chat(bot_id: str, req: ChatRequest):
    reg = registry.load_registry()
    entry = reg.get(bot_id)
    if not entry:
        raise HTTPException(404, f"Bot '{bot_id}' not found")
    status = entry.get("status")
    if status != "ready":
        raise HTTPException(409, f"Bot is {status}, not ready yet")
    if not llm.ping():
        raise HTTPException(503, "LLM backend (Ollama) is not reachable")

    bot = _bot_cache.get(bot_id)
    if bot is None:
        from core.rag import WebsiteBot

        bot = WebsiteBot(bot_id, entry.get("website_name", ""))
        _bot_cache[bot_id] = bot

    result = bot.answer(req.message)
    return ChatResponse(
        answer=result["answer"],
        sources=result["sources"],
        in_scope=result["in_scope"],
        match_quality=result["match_quality"],
    )


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
