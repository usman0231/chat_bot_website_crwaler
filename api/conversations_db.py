"""SQLite-backed conversation + message store.

Persists every visitor chat / voice conversation so the bot owner can review
them on the dashboard. Lives in the same SQLite database as the user store
(``settings.auth_db_path``) but in its own module — the two concerns are
unrelated and keeping them apart avoids turning ``auth_db`` into a grab bag.

Two tables:
  conversations  — one row per (bot, visitor, session); rolls a visitor's
                   messages into a single conversation if they keep talking
                   within ``_SESSION_WINDOW_MINUTES``.
  messages       — one row per turn message, FK -> conversations.id.

AI summaries are generated lazily (see ``summarize_conversation``) and cached
on the conversation row. ``summary_message_count`` records how many messages
existed when the summary was written, so callers can detect a stale summary
and regenerate it after new turns arrive.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.config import settings

log = logging.getLogger(__name__)

# Reuse an existing conversation for the same (bot, visitor, channel) if the
# last message landed within this window — otherwise start a fresh one.
_SESSION_WINDOW_MINUTES = 30

# Hard ceilings so a runaway transcript can't blow the summariser's context
# window (the model is token-limited). We summarise the most recent turns.
_SUMMARY_MAX_MESSAGES = 40
_SUMMARY_MAX_CHARS = 6000


@dataclass
class Conversation:
    id: str
    bot_id: str
    channel: str
    visitor_id: str | None
    started_at: str
    last_at: str
    message_count: int
    summary: str | None
    created_at: str


@dataclass
class Message:
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: str


_lock = threading.Lock()
_initialised = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    path = Path(settings.auth_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _ensure_schema() -> None:
    global _initialised
    with _lock:
        if _initialised:
            return
        with _connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    bot_id TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    visitor_id TEXT,
                    started_at TEXT NOT NULL,
                    last_at TEXT NOT NULL,
                    message_count INTEGER NOT NULL DEFAULT 0,
                    summary TEXT,
                    summary_message_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (conversation_id)
                        REFERENCES conversations(id) ON DELETE CASCADE
                )
                """
            )
            # Listing is "newest first for a bot"; lookup-by-visitor drives the
            # session-reuse query. Index both hot paths.
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_conversations_bot_last"
                " ON conversations(bot_id, last_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_conversations_visitor"
                " ON conversations(bot_id, channel, visitor_id, last_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_messages_conversation"
                " ON messages(conversation_id, created_at)"
            )
            conn.commit()
        _initialised = True


def _row_to_conversation(row: sqlite3.Row) -> Conversation:
    return Conversation(
        id=row["id"],
        bot_id=row["bot_id"],
        channel=row["channel"],
        visitor_id=row["visitor_id"],
        started_at=row["started_at"],
        last_at=row["last_at"],
        message_count=int(row["message_count"] or 0),
        summary=row["summary"],
        created_at=row["created_at"],
    )


def create_or_get_conversation(
    bot_id: str, channel: str, visitor_id: str | None
) -> str:
    """Return the id of the conversation to append to.

    Reuses the most recent open conversation for the same (bot, channel,
    visitor) when its last message is younger than ``_SESSION_WINDOW_MINUTES``;
    otherwise starts a new one. A null ``visitor_id`` can't be correlated
    across requests, so those always start a fresh conversation.
    """
    _ensure_schema()
    now = datetime.now(timezone.utc)
    with _connect() as conn:
        if visitor_id:
            cutoff = (now - timedelta(minutes=_SESSION_WINDOW_MINUTES)).isoformat()
            row = conn.execute(
                "SELECT id FROM conversations"
                " WHERE bot_id = ? AND channel = ? AND visitor_id = ?"
                "   AND last_at >= ?"
                " ORDER BY last_at DESC LIMIT 1",
                (bot_id, channel, visitor_id, cutoff),
            ).fetchone()
            if row is not None:
                return row["id"]

        conv_id = "conv_" + uuid.uuid4().hex[:12]
        ts = now.isoformat()
        conn.execute(
            "INSERT INTO conversations"
            " (id, bot_id, channel, visitor_id, started_at, last_at,"
            "  message_count, summary, summary_message_count, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0, ?)",
            (conv_id, bot_id, channel, visitor_id, ts, ts, ts),
        )
        conn.commit()
        return conv_id


def add_message(conversation_id: str, role: str, content: str) -> str:
    """Append a message and bump the parent conversation's counters."""
    _ensure_schema()
    msg_id = "msg_" + uuid.uuid4().hex[:12]
    ts = _now_iso()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (msg_id, conversation_id, role, content, ts),
        )
        conn.execute(
            "UPDATE conversations"
            " SET message_count = message_count + 1, last_at = ?"
            " WHERE id = ?",
            (ts, conversation_id),
        )
        conn.commit()
    return msg_id


def list_conversations(
    bot_id: str, limit: int = 50, offset: int = 0
) -> list[Conversation]:
    """Conversations for a bot, newest activity first."""
    _ensure_schema()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM conversations WHERE bot_id = ?"
            " ORDER BY last_at DESC LIMIT ? OFFSET ?",
            (bot_id, limit, offset),
        ).fetchall()
    return [_row_to_conversation(r) for r in rows]


def get_conversation(
    conversation_id: str,
) -> tuple[Conversation, list[Message]] | None:
    """Return (conversation, ordered messages), or None if it doesn't exist."""
    _ensure_schema()
    with _connect() as conn:
        conv_row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        if conv_row is None:
            return None
        msg_rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ?"
            " ORDER BY created_at ASC, rowid ASC",
            (conversation_id,),
        ).fetchall()
    messages = [
        Message(
            id=r["id"],
            conversation_id=r["conversation_id"],
            role=r["role"],
            content=r["content"],
            created_at=r["created_at"],
        )
        for r in msg_rows
    ]
    return _row_to_conversation(conv_row), messages


def update_summary(conversation_id: str, summary: str) -> None:
    """Cache a generated summary and snapshot the message count it covered."""
    _ensure_schema()
    with _connect() as conn:
        conn.execute(
            "UPDATE conversations"
            " SET summary = ?, summary_message_count ="
            "     (SELECT message_count FROM conversations WHERE id = ?)"
            " WHERE id = ?",
            (summary, conversation_id, conversation_id),
        )
        conn.commit()


def needs_summary(conversation_id: str) -> bool:
    """True if the conversation has no summary, or new messages have arrived
    since the cached summary was generated."""
    _ensure_schema()
    with _connect() as conn:
        row = conn.execute(
            "SELECT summary, message_count, summary_message_count"
            " FROM conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone()
    if row is None:
        return False
    if not row["summary"]:
        return True
    return int(row["summary_message_count"] or 0) < int(row["message_count"] or 0)


_SUMMARY_SYSTEM = (
    "You summarise a customer-support chat between a website visitor and an "
    "AI assistant, for the business owner. Be concise and factual. Respond in "
    "plain text with exactly these three labelled lines and nothing else:\n"
    "Summary: <1-2 sentences on what the visitor wanted>\n"
    "Intent: <the visitor's main question(s) / intent>\n"
    "Resolution: <did the assistant answer it, or fail / hit a gap? be honest>"
)


def _build_transcript(messages: list[Message]) -> str:
    """Render recent messages as a ``Visitor:/Assistant:`` transcript, capped
    so we never overflow the summariser's context window."""
    recent = messages[-_SUMMARY_MAX_MESSAGES:]
    lines: list[str] = []
    for m in recent:
        speaker = "Visitor" if m.role == "user" else "Assistant"
        lines.append(f"{speaker}: {m.content}")
    transcript = "\n".join(lines)
    if len(transcript) > _SUMMARY_MAX_CHARS:
        # Keep the tail — the most recent turns are the most informative.
        transcript = "…\n" + transcript[-_SUMMARY_MAX_CHARS:]
    return transcript


def summarize_conversation(conversation_id: str) -> str | None:
    """Generate, cache, and return an AI summary for a conversation.

    Uses the same LLM client the bot uses (Groq via the OpenAI-compatible
    API). Returns the summary string, or None if there are no messages or the
    LLM call fails — callers should treat failure as "not yet summarised"
    rather than an error.
    """
    loaded = get_conversation(conversation_id)
    if loaded is None:
        return None
    _conv, messages = loaded
    if not messages:
        return None

    # Lazy import: keeps this module importable (and the DB usable) even if the
    # LLM stack isn't configured, and avoids constructing the client at import.
    from core import llm

    transcript = _build_transcript(messages)
    try:
        summary = llm.chat(
            system=_SUMMARY_SYSTEM,
            user=f"Conversation transcript:\n\n{transcript}",
            temperature=0.2,
        ).strip()
    except Exception:
        log.warning("Summary generation failed for %s", conversation_id, exc_info=True)
        return None

    if not summary:
        return None
    update_summary(conversation_id, summary)
    return summary
