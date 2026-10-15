"""Store-and-forward: keep readings while the car has no internet, send them when it is back.

The in-car alarm (watch / buzzer) never needs the network. Without a connection, each 1 s reading
(and a camera snapshot when the in-car alarm sounds) goes into a small SQLite file instead of being
lost. A background flusher sends the backlog oldest-first, marked `queued: true` so the backend keeps
the original time and tells the parent the alert was delivered late; then live sending resumes.

SQLite is in Python's standard library and survives power cuts (the Pi is switched off with the car).
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

# About one day of readings at 1 Hz; the oldest are dropped first if the car stays offline longer.
MAX_ROWS = 86_400
# Older than this the backend no longer accepts them (MAX_BACKFILL_MS).
MAX_AGE_S = 23 * 60 * 60


def is_retryable(exc: BaseException) -> bool:
    """No connection, timeout, or the server is (re)starting: keep the reading and retry later.
    Other HTTP errors (e.g. a deleted driver) would fail again, so they are not kept."""
    if isinstance(exc, (requests.ConnectionError, requests.Timeout)):
        return True
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        return exc.response.status_code >= 500 or exc.response.status_code in (408, 429)
    return False


class Outbox:
    """Thread-safe FIFO of payloads on disk."""

    def __init__(self, path: Path | str, max_rows: int = MAX_ROWS) -> None:
        self.path = Path(path)
        if str(path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.max_rows = max_rows
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS outbox ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " created REAL NOT NULL,"
            " payload TEXT NOT NULL,"
            " snapshot BLOB)"
        )

    def put(self, payload: dict[str, Any], snapshot: bytes | None = None, now: float | None = None) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO outbox (created, payload, snapshot) VALUES (?, ?, ?)",
                (now if now is not None else time.time(), json.dumps(payload), snapshot),
            )
            excess = self._count() - self.max_rows
            if excess > 0:
                self._db.execute(
                    "DELETE FROM outbox WHERE id IN (SELECT id FROM outbox ORDER BY id LIMIT ?)", (excess,)
                )

    def peek(self, limit: int = 50) -> list[tuple[int, dict[str, Any], bytes | None]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, payload, snapshot FROM outbox ORDER BY id LIMIT ?", (limit,)
            ).fetchall()
        return [(row_id, json.loads(p), snap) for row_id, p, snap in rows]

    def delete(self, row_id: int) -> None:
        with self._lock:
            self._db.execute("DELETE FROM outbox WHERE id = ?", (row_id,))

    def prune(self, now: float | None = None, max_age_s: float = MAX_AGE_S) -> int:
        """Drop readings the backend would no longer accept."""
        cutoff = (now if now is not None else time.time()) - max_age_s
        with self._lock:
            return self._db.execute("DELETE FROM outbox WHERE created < ?", (cutoff,)).rowcount

    def count(self) -> int:
        with self._lock:
            return self._count()

    def _count(self) -> int:
        return int(self._db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0])

    def close(self) -> None:
        with self._lock:
            self._db.close()


@dataclass
class FlushResult:
    sent: int = 0
    alerts: int = 0
    dropped: int = 0
    online: bool = True


class StoreAndForward:
    """Sends a reading now if possible, otherwise keeps it; flushes the backlog in order.

    `send` runs in the 1 Hz POST worker, `flush` in a background thread; both are safe to call
    concurrently. While a backlog exists, new readings join the end of it so order is kept.
    """

    def __init__(self, client: Any, outbox: Outbox, log: Any = None) -> None:
        self.client = client
        self.outbox = outbox
        self.log = log
        self._flush_lock = threading.Lock()
        self.online = True

    @property
    def backlog(self) -> int:
        return self.outbox.count()

    def send(self, payload: dict[str, Any], snapshot: bytes | None = None) -> dict[str, Any] | None:
        """Backend response, or None when the reading was stored for later."""
        if self.outbox.count() == 0:
            try:
                res = self.client.post(payload)
                self.online = True
                return res
            except Exception as exc:  # noqa: BLE001 - classified below
                if not is_retryable(exc):
                    raise
                self.online = False
                if self.log:
                    self.log.warning(
                        f"offline ({type(exc).__name__}): storing readings until the connection is back"
                    )
        self.outbox.put(payload, snapshot)
        return None

    def flush(
        self, batch: int = 50, on_response: Callable[[dict[str, Any]], None] | None = None
    ) -> FlushResult:
        """Send the backlog oldest-first until it is empty or the connection fails again."""
        result = FlushResult()
        if not self._flush_lock.acquire(blocking=False):
            return result
        try:
            self.outbox.prune()
            while True:
                rows = self.outbox.peek(batch)
                if not rows:
                    break
                for row_id, payload, snapshot in rows:
                    try:
                        res = self.client.post({**payload, "queued": True})
                    except Exception as exc:  # noqa: BLE001
                        if is_retryable(exc):
                            self.online = result.online = False
                            return result
                        self.outbox.delete(row_id)  # rejected for good (e.g. driver deleted)
                        result.dropped += 1
                        continue
                    self.outbox.delete(row_id)
                    result.sent += 1
                    if res.get("alertTriggered") and res.get("alertId"):
                        result.alerts += 1
                        if snapshot:
                            try:
                                self.client.post_snapshot(payload["driverId"], res["alertId"], snapshot)
                            except Exception:  # noqa: BLE001 - the alert itself was delivered
                                pass
                    if on_response:
                        on_response(res)
            self.online = True
            return result
        finally:
            self._flush_lock.release()
