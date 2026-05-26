"""
Ingestion pipeline.

Take crawled pages -> chunk text -> embed chunks -> store in ChromaDB.
One collection per bot_id.

CLI:
    python -m ingest.pipeline <bot_id> <root_url>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import random
import re
import sys
from typing import Any, Callable

import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer

from core.config import settings

log = logging.getLogger(__name__)


_MIN_PAGE_CHARS = 50
# GPU/CPU encode micro-batch handed to sentence-transformers. The outer
# batching (settings.embed_batch_size) only governs progress reporting and
# memory cadence; this is what the model actually forwards at once.
_ENCODE_BATCH = 32

# --------------------------------------------------------------------------
# Chunk quality filtering
# --------------------------------------------------------------------------

# Patterns that mark a chunk as "template / loading / placeholder" content.
# These are content artifacts you get when a page is crawled mid-render or
# uses unfilled template syntax — they pollute retrieval with conflicting
# answers ("Price: $X", "Price: $29") so we drop them at ingest time.
_PLACEHOLDER_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\$[A-Z]\b"),  # $X, $Y, $Z
    re.compile(r"\{\{[^}]+\}\}"),  # {{price}}
    re.compile(r"\{[a-z_]+\}"),  # {price}
    re.compile(r"lorem ipsum", re.IGNORECASE),
    re.compile(r"loading\.\.\.", re.IGNORECASE),
    re.compile(r"please wait", re.IGNORECASE),
    re.compile(r"coming soon", re.IGNORECASE),
    re.compile(r"\[object Object\]"),
    re.compile(r"\bundefined\b"),
    re.compile(r"\bNaN\b"),
)


def _is_low_quality_chunk(text: str) -> bool:
    """True if the chunk is junk that shouldn't be embedded.

    Catches:
      * very short fragments
      * placeholder / template / JS render artifacts
      * chunks dominated by repeated characters
      * mostly-numeric content (code dumps, raw tables)
      * navigation-only content (link soup with no narrative)
    """
    stripped = (text or "").strip()
    if len(stripped) < 80:
        return True

    for pattern in _PLACEHOLDER_PATTERNS:
        if pattern.search(stripped):
            return True

    # Almost no variety → broken / repeated content.
    if len(set(stripped)) < 10:
        return True

    # Mostly non-alphabetic = numeric dumps or code blobs.
    alpha_ratio = sum(1 for c in stripped if c.isalpha()) / len(stripped)
    if alpha_ratio < 0.35:
        return True

    # A handful of short sentences = probably a nav strip.
    sentences = [s.strip() for s in stripped.split(".") if s.strip()]
    if len(sentences) <= 2 and len(stripped) < 150:
        return True

    return False


# Price-shaped strings that we surface for conflict warnings.
_PRICE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\$[\d,]+(?:\.\d{2})?"),
    re.compile(r"[\d,]+(?:\.\d{2})?\s*(?:USD|usd)"),
    re.compile(r"Rs\.?\s*[\d,]+", re.IGNORECASE),
    re.compile(r"PKR\s*[\d,]+", re.IGNORECASE),
    re.compile(r"€[\d,]+(?:\.\d{2})?"),
    re.compile(r"£[\d,]+(?:\.\d{2})?"),
)


def _extract_prices(text: str) -> set[str]:
    out: set[str] = set()
    for pattern in _PRICE_PATTERNS:
        out.update(m.strip() for m in pattern.findall(text) if m.strip())
    return out


_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(settings.embed_model)
    return _model


def _splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)


def _embed(texts: list[str]) -> list[list[float]]:
    """Embed texts in safe outer batches, logging progress.

    sentence-transformers handles its own micro-batching via ``batch_size``;
    the outer loop keeps memory bounded and surfaces progress on large
    sites (thousands of chunks) where this step is the slow part.
    """
    model = _get_model()
    batch_size = settings.embed_batch_size
    total = len(texts)
    out: list[list[float]] = []
    for i in range(0, total, batch_size):
        batch = texts[i : i + batch_size]
        vecs = model.encode(
            batch,
            batch_size=_ENCODE_BATCH,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        out.extend(v.tolist() for v in vecs)
        done = min(i + batch_size, total)
        log.info("[Ingest] Embedded %d/%d chunks", done, total)
    return out


def _upsert_in_batches(
    client: chromadb.api.ClientAPI,
    collection,
    ids: list[str],
    embeddings: list[list[float]],
    documents: list[str],
    metadatas: list[dict[str, Any]],
) -> None:
    """Add to ChromaDB in safe batches.

    ChromaDB rejects a single ``add`` larger than its max batch size (a
    SQLite host-variable ceiling, e.g. 5461) — the cause of the
    "Batch size of N is greater than max batch size of M" failure on large
    sites. We clamp the configured batch size down to whatever this client
    actually reports so the write succeeds regardless of environment.
    """
    total = len(ids)
    batch_size = settings.chroma_batch_size
    try:
        client_max = int(client.get_max_batch_size())
        if client_max > 0:
            batch_size = min(batch_size, client_max)
    except Exception:
        # Older chromadb without get_max_batch_size — the conservative
        # configured default (500) is already well under the ceiling.
        pass

    for i in range(0, total, batch_size):
        end = min(i + batch_size, total)
        collection.add(
            ids=ids[i:end],
            embeddings=embeddings[i:end],
            documents=documents[i:end],
            metadatas=metadatas[i:end],
        )
        log.info("[Ingest] Stored %d/%d chunks in ChromaDB", end, total)


def _get_or_reset_collection(client: chromadb.api.ClientAPI, bot_id: str):
    try:
        client.delete_collection(bot_id)
    except Exception:
        pass
    return client.create_collection(name=bot_id, metadata={"hnsw:space": "cosine"})


PhaseCallback = Callable[[str], None]


def ingest_website(
    bot_id: str,
    pages: list[dict],
    phase_callback: PhaseCallback | None = None,
) -> dict:
    """Chunk pages, embed, and store in ChromaDB. Returns summary dict.

    `phase_callback` (optional) is called with phase names as work progresses.
    Currently emitted phases: "indexing" — just before writing the collection.
    """

    def _phase(name: str) -> None:
        if phase_callback is None:
            return
        try:
            phase_callback(name)
        except Exception:
            pass

    splitter = _splitter()

    ids: list[str] = []
    docs: list[str] = []
    metas: list[dict[str, Any]] = []

    kept_pages = 0
    bad_count = 0
    prices_by_url: dict[str, set[str]] = {}

    for page_index, page in enumerate(pages):
        text = (page.get("text") or "").strip()
        if len(text) < _MIN_PAGE_CHARS:
            continue
        kept_pages += 1
        url = page.get("url", "")
        title = page.get("title", "")
        chunks = splitter.split_text(text)
        for chunk_index, chunk in enumerate(chunks):
            if _is_low_quality_chunk(chunk):
                bad_count += 1
                continue
            ids.append(f"{page_index}-{chunk_index}")
            docs.append(chunk)
            metas.append(
                {
                    "url": url,
                    "title": title,
                    "chunk_index": chunk_index,
                    "page_index": page_index,
                }
            )
            prices = _extract_prices(chunk)
            if prices:
                prices_by_url.setdefault(url, set()).update(prices)

    good_count = len(docs)
    total = good_count + bad_count
    if total > 0:
        garbage_pct = (bad_count / total) * 100
        log.info(
            "Chunk quality: %d kept, %d filtered (%.0f%% garbage rate)",
            good_count,
            bad_count,
            garbage_pct,
        )

    # Heuristic conflict warning — a single product page shouldn't generally
    # carry more than 3 distinct price tokens. When it does, the page
    # probably rendered with placeholder data before crawl finished.
    for url, prices in prices_by_url.items():
        if len(prices) > 3:
            log.warning(
                "Possible price conflict on %s: found %s. Page may have"
                " loaded with placeholder data. Consider re-crawling when"
                " page fully loads.",
                url,
                sorted(prices),
            )

    embeddings: list[list[float]] = []
    if docs:
        embeddings = _embed(docs)

    _phase("indexing")
    client = chromadb.PersistentClient(path=str(settings.chroma_dir))
    collection = _get_or_reset_collection(client, bot_id)

    if docs:
        _upsert_in_batches(client, collection, ids, embeddings, docs, metas)

    return {"bot_id": bot_id, "pages": kept_pages, "chunks": len(docs)}


_FALLBACK_QUESTIONS = [
    "What services do you offer?",
    "How can I contact you?",
    "What are your hours?",
    "Tell me about your products",
]


def _sample_chunks(bot_id: str, n: int = 3) -> list[str]:
    try:
        client = chromadb.PersistentClient(path=str(settings.chroma_dir))
        collection = client.get_collection(bot_id)
        peek = collection.peek(limit=200)
    except Exception as e:
        log.warning("suggested-questions: failed to read collection %s: %s", bot_id, e)
        return []
    docs = peek.get("documents") or []
    if not docs:
        return []
    sample_size = min(n, len(docs))
    return random.sample(list(docs), sample_size)


def _parse_questions(raw: str, *, max_chars: int = 80, max_count: int = 4) -> list[str]:
    if not raw:
        return []
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(0)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    out: list[str] = []
    for item in parsed:
        if not isinstance(item, str):
            continue
        q = item.strip()
        if not q:
            continue
        if len(q) > max_chars:
            q = q[:max_chars].rstrip(" ,") + "?"
        if not q.endswith("?"):
            q = q.rstrip(".!") + "?"
        out.append(q)
        if len(out) == max_count:
            break
    return out


def generate_suggested_questions(bot_id: str) -> list[str]:
    """Produce 4 short visitor questions from the bot's indexed content.

    Safe to call after ``ingest_website`` has populated Chroma. Any failure
    (no docs, LLM unreachable, malformed output) falls back to a generic
    list so the training pipeline never breaks because of this step.
    """
    chunks = _sample_chunks(bot_id, n=3)
    if not chunks:
        return list(_FALLBACK_QUESTIONS)

    content_blob = "\n\n---\n\n".join(chunks)[:4000]
    system = (
        "You are helping users explore a website chatbot. Based on the "
        "website content below, generate exactly 4 short, natural questions "
        "a real visitor might ask this business or website. Each question "
        "should be under 60 characters. Output as a JSON array of strings "
        "ONLY — no preamble, no explanation.\n\nWEBSITE CONTENT:\n"
        + content_blob
    )

    try:
        from core import llm

        raw = llm.chat(system=system, user="Generate 4 questions.", temperature=0.4)
    except Exception as e:
        log.warning("suggested-questions: LLM call failed for %s: %s", bot_id, e)
        return list(_FALLBACK_QUESTIONS)

    parsed = _parse_questions(raw, max_chars=60, max_count=4)
    if len(parsed) < 4:
        for q in _FALLBACK_QUESTIONS:
            if q not in parsed:
                parsed.append(q)
            if len(parsed) == 4:
                break
    return parsed[:4]


def regenerate_questions_for_bot(bot_id: str) -> list[str]:
    """LLM-generated *customer-facing* questions for the management UI.

    Pulls 5 random chunks (vs 3 for the post-ingest call) and asks for 6
    questions up to 80 chars — more material for the user to curate from.
    Falls back to the generic list on any failure.
    """
    chunks = _sample_chunks(bot_id, n=5)
    if not chunks:
        return list(_FALLBACK_QUESTIONS)

    content_blob = "\n\n---\n\n".join(chunks)[:5000]
    system = (
        "Generate exactly 6 short, natural questions (under 80 chars each) "
        "that a real customer would ask about this business. "
        "Output ONLY a JSON array of strings. No explanation.\n\n"
        "WEBSITE CONTENT:\n" + content_blob
    )

    try:
        from core import llm

        raw = llm.chat(system=system, user="Generate 6 questions.", temperature=0.5)
    except Exception as e:
        log.warning("regenerate-questions: LLM call failed for %s: %s", bot_id, e)
        return list(_FALLBACK_QUESTIONS)

    parsed = _parse_questions(raw, max_chars=80, max_count=6)
    if not parsed:
        return list(_FALLBACK_QUESTIONS)
    return parsed


def _cli(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="ingest.pipeline")
    parser.add_argument("bot_id")
    parser.add_argument("root_url")
    parser.add_argument("--max", type=int, default=settings.max_pages)
    args = parser.parse_args(argv)

    from ingest.crawler import crawl

    pages = asyncio.run(crawl(args.root_url, args.max))
    result = ingest_website(args.bot_id, pages)
    print(
        f"bot_id={result['bot_id']}  pages_crawled={len(pages)}  "
        f"pages_ingested={result['pages']}  chunks={result['chunks']}"
    )
    return 0


def main() -> None:
    sys.exit(_cli(sys.argv[1:]))


if __name__ == "__main__":
    main()
