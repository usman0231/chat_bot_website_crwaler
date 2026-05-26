"""Bot registry — JSON file at settings.registry_file. Thread-safe writes."""

from __future__ import annotations

import json
import os
import threading
from typing import Any

from core.config import settings

_lock = threading.Lock()


def load_registry() -> dict[str, dict]:
    path = settings.registry_file
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_registry(reg: dict) -> None:
    path = settings.registry_file
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(reg, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def update_bot(bot_id: str, **fields: Any) -> None:
    with _lock:
        reg = load_registry()
        entry = reg.get(bot_id, {})
        entry.update(fields)
        reg[bot_id] = entry
        save_registry(reg)


def delete_bot(bot_id: str) -> bool:
    """Remove `bot_id` from the registry. Returns True if it existed."""
    with _lock:
        reg = load_registry()
        if bot_id not in reg:
            return False
        del reg[bot_id]
        save_registry(reg)
        return True
