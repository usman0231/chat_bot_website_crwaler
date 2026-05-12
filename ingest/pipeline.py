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
import sys
from typing import Any

import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer

from core.config import settings


_MIN_PAGE_CHARS = 50
_EMBED_BATCH = 32

_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(settings.embed_model)
    return _model


def _splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)


def _embed(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    out: list[list[float]] = []
    for i in range(0, len(texts), _EMBED_BATCH):
        batch = texts[i : i + _EMBED_BATCH]
        vecs = model.encode(batch, show_progress_bar=False, convert_to_numpy=True)
        out.extend(v.tolist() for v in vecs)
    return out


def _get_or_reset_collection(client: chromadb.api.ClientAPI, bot_id: str):
    try:
        client.delete_collection(bot_id)
    except Exception:
        pass
    return client.create_collection(name=bot_id, metadata={"hnsw:space": "cosine"})


def ingest_website(bot_id: str, pages: list[dict]) -> dict:
    """Chunk pages, embed, and store in ChromaDB. Returns summary dict."""
    splitter = _splitter()

    ids: list[str] = []
    docs: list[str] = []
    metas: list[dict[str, Any]] = []

    kept_pages = 0
    for page_index, page in enumerate(pages):
        text = (page.get("text") or "").strip()
        if len(text) < _MIN_PAGE_CHARS:
            continue
        kept_pages += 1
        url = page.get("url", "")
        title = page.get("title", "")
        chunks = splitter.split_text(text)
        for chunk_index, chunk in enumerate(chunks):
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

    client = chromadb.PersistentClient(path=str(settings.chroma_dir))
    collection = _get_or_reset_collection(client, bot_id)

    if docs:
        embeddings = _embed(docs)
        collection.add(ids=ids, documents=docs, embeddings=embeddings, metadatas=metas)

    return {"bot_id": bot_id, "pages": kept_pages, "chunks": len(docs)}


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
