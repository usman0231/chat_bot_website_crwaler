"""SQLite-backed user store: signup/login + API key + tier/billing/usage.

One ``users`` table at ``settings.auth_db_path``. Passwords hashed with bcrypt
(via the bcrypt package directly — passlib's bcrypt backend breaks against
bcrypt>=4.1). The schema is created on first use and patched forward via
idempotent ``ALTER TABLE`` calls so existing test databases keep working.

Per-user API keys (column ``api_key``) replace the shared X-API-Key; new
users get one on signup and existing rows are backfilled at migration time.
"""

from __future__ import annotations

import secrets
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import bcrypt as _bcrypt

from core.config import settings


_BCRYPT_MAX_BYTES = 72


def _hash_password(password: str) -> str:
    pw_bytes = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return _bcrypt.hashpw(pw_bytes, _bcrypt.gensalt()).decode("ascii")


def _verify_password_hash(password: str, hashed: str) -> bool:
    try:
        pw_bytes = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
        return _bcrypt.checkpw(pw_bytes, hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


def generate_api_key() -> str:
    """Per-user widget/API key. Format: ``sb_<urlsafe-24>``."""
    return "sb_" + secrets.token_urlsafe(24)


@dataclass
class User:
    id: str
    email: str
    name: str
    created_at: str
    api_key: str = ""
    tier: str = "free"
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    subscription_status: str = "active"
    messages_this_month: int = 0
    messages_month_reset: str | None = None


_lock = threading.Lock()
_initialised = False


def _connect() -> sqlite3.Connection:
    path = Path(settings.auth_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _existing_columns(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("PRAGMA table_info(users)").fetchall()
    return {r["name"] for r in rows}


def _add_column_if_missing(
    conn: sqlite3.Connection, columns: set[str], name: str, ddl: str
) -> bool:
    if name in columns:
        return False
    conn.execute(f"ALTER TABLE users ADD COLUMN {ddl}")
    columns.add(name)
    return True


def _ensure_schema() -> None:
    global _initialised
    with _lock:
        if _initialised:
            return
        with _connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            cols = _existing_columns(conn)
            _add_column_if_missing(conn, cols, "api_key", "api_key TEXT")
            _add_column_if_missing(
                conn, cols, "tier", "tier TEXT NOT NULL DEFAULT 'free'"
            )
            _add_column_if_missing(
                conn, cols, "stripe_customer_id", "stripe_customer_id TEXT"
            )
            _add_column_if_missing(
                conn, cols, "stripe_subscription_id", "stripe_subscription_id TEXT"
            )
            _add_column_if_missing(
                conn,
                cols,
                "subscription_status",
                "subscription_status TEXT NOT NULL DEFAULT 'active'",
            )
            _add_column_if_missing(
                conn,
                cols,
                "messages_this_month",
                "messages_this_month INTEGER NOT NULL DEFAULT 0",
            )
            _add_column_if_missing(
                conn, cols, "messages_month_reset", "messages_month_reset TEXT"
            )

            # Backfill api_key for any pre-existing rows that lack one.
            missing = conn.execute(
                "SELECT id FROM users WHERE api_key IS NULL OR api_key = ''"
            ).fetchall()
            for row in missing:
                conn.execute(
                    "UPDATE users SET api_key = ? WHERE id = ?",
                    (generate_api_key(), row["id"]),
                )

            # Unique index after backfill so older rows can be patched safely.
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key"
                " ON users(api_key)"
            )
            conn.commit()
        _initialised = True


def _row_to_user(row: sqlite3.Row) -> User:
    return User(
        id=row["id"],
        email=row["email"],
        name=row["name"],
        created_at=row["created_at"],
        api_key=row["api_key"] or "",
        tier=row["tier"] or "free",
        stripe_customer_id=row["stripe_customer_id"],
        stripe_subscription_id=row["stripe_subscription_id"],
        subscription_status=row["subscription_status"] or "active",
        messages_this_month=int(row["messages_this_month"] or 0),
        messages_month_reset=row["messages_month_reset"],
    )


def _normalise_email(email: str) -> str:
    return email.strip().lower()


class EmailAlreadyRegisteredError(Exception):
    """Raised when trying to create a user with an email that already exists."""


def create_user(email: str, password: str, name: str) -> User:
    _ensure_schema()
    user_id = "usr_" + uuid.uuid4().hex[:10]
    norm_email = _normalise_email(email)
    password_hash = _hash_password(password)
    created_at = datetime.now(timezone.utc).isoformat()
    api_key = generate_api_key()
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO users (id, email, password_hash, name, created_at,"
                " api_key, tier, subscription_status, messages_this_month,"
                " messages_month_reset)"
                " VALUES (?, ?, ?, ?, ?, ?, 'free', 'active', 0, ?)",
                (
                    user_id,
                    norm_email,
                    password_hash,
                    name.strip(),
                    created_at,
                    api_key,
                    _current_month_key(),
                ),
            )
            conn.commit()
    except sqlite3.IntegrityError as e:
        raise EmailAlreadyRegisteredError(str(e)) from e

    return User(
        id=user_id,
        email=norm_email,
        name=name.strip(),
        created_at=created_at,
        api_key=api_key,
        tier="free",
        subscription_status="active",
        messages_this_month=0,
        messages_month_reset=_current_month_key(),
    )


def get_user_by_email(email: str) -> User | None:
    _ensure_schema()
    norm = _normalise_email(email)
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (norm,)
        ).fetchone()
    return _row_to_user(row) if row else None


def get_user_by_id(user_id: str) -> User | None:
    _ensure_schema()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return _row_to_user(row) if row else None


def get_user_by_api_key(api_key: str) -> User | None:
    _ensure_schema()
    if not api_key:
        return None
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE api_key = ?", (api_key,)
        ).fetchone()
    return _row_to_user(row) if row else None


def get_user_by_stripe_customer(customer_id: str) -> User | None:
    _ensure_schema()
    if not customer_id:
        return None
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE stripe_customer_id = ?", (customer_id,)
        ).fetchone()
    return _row_to_user(row) if row else None


def verify_password(email: str, password: str) -> User | None:
    """Return the user iff the password matches; otherwise None."""
    _ensure_schema()
    norm = _normalise_email(email)
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (norm,)
        ).fetchone()
    if not row:
        return None
    if not _verify_password_hash(password, row["password_hash"]):
        return None
    return _row_to_user(row)


def rotate_api_key(user_id: str) -> User | None:
    """Generate and persist a new API key for ``user_id``. Returns the
    updated user, or None if no such user exists.
    """
    _ensure_schema()
    new_key = generate_api_key()
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE users SET api_key = ? WHERE id = ?", (new_key, user_id)
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row) if row else None


def set_stripe_customer(user_id: str, customer_id: str) -> None:
    _ensure_schema()
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET stripe_customer_id = ? WHERE id = ?",
            (customer_id, user_id),
        )
        conn.commit()


def apply_subscription_update(
    user_id: str,
    *,
    tier: str | None = None,
    subscription_id: str | None = None,
    subscription_status: str | None = None,
) -> None:
    _ensure_schema()
    sets: list[str] = []
    args: list[object] = []
    if tier is not None:
        sets.append("tier = ?")
        args.append(tier)
    if subscription_id is not None:
        sets.append("stripe_subscription_id = ?")
        args.append(subscription_id)
    if subscription_status is not None:
        sets.append("subscription_status = ?")
        args.append(subscription_status)
    if not sets:
        return
    args.append(user_id)
    with _connect() as conn:
        conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", args)
        conn.commit()


def reset_to_free(user_id: str) -> None:
    """Webhook hook for ``customer.subscription.deleted``."""
    _ensure_schema()
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET tier = 'free', stripe_subscription_id = NULL,"
            " subscription_status = 'canceled' WHERE id = ?",
            (user_id,),
        )
        conn.commit()


def _current_month_key() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


def reset_monthly_counter_if_needed(user_id: str) -> None:
    """Reset ``messages_this_month`` if the stored month differs from now."""
    _ensure_schema()
    month = _current_month_key()
    with _connect() as conn:
        row = conn.execute(
            "SELECT messages_month_reset FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            return
        stored = row["messages_month_reset"]
        if stored == month:
            return
        conn.execute(
            "UPDATE users SET messages_this_month = 0, messages_month_reset = ?"
            " WHERE id = ?",
            (month, user_id),
        )
        conn.commit()


def increment_message_counter(user_id: str) -> int:
    """Bump and return the new monthly count (post-reset if month rolled over)."""
    reset_monthly_counter_if_needed(user_id)
    _ensure_schema()
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET messages_this_month = messages_this_month + 1"
            " WHERE id = ?",
            (user_id,),
        )
        conn.commit()
        row = conn.execute(
            "SELECT messages_this_month FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return int(row["messages_this_month"]) if row else 0
