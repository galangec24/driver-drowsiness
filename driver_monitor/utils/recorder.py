"""Labelled session recorder → JSON Lines, one row per POST interval (same values the backend sees).

Row: {"t", "ear", "perclos", "heartRate", "faceConfidence", "label", "state"}
  label: 1 drowsy · 0 not drowsy · -1 ignore (e.g. unsure / early onset) · null unlabelled
Convert recordings into a training dataset with ml/scripts/import_recordings.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import IO, Any

# Live hotkeys while recording (preview window must have focus).
LABEL_KEYS = {
    ord("0"): (0, "alert"),
    ord("1"): (1, "drowsy"),
    ord("9"): (-1, "ignore"),
    ord("t"): (0, "talking"),
    ord("m"): (0, "mirror_check"),
    ord("p"): (0, "phone_glance"),
    ord("s"): (0, "sun_squint"),
}


class SessionRecorder:
    def __init__(self, path: Path, label: int | None = None, state: str = "unlabelled") -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.label = label
        self.state = state
        self.rows = 0
        self._fh: IO[str] = path.open("a", encoding="utf8")

    def handle_key(self, key: int) -> bool:
        """Apply a label hotkey; returns True if the key was a label key."""
        if key in LABEL_KEYS:
            self.label, self.state = LABEL_KEYS[key]
            return True
        return False

    def write(self, t: float, payload: dict[str, Any]) -> None:
        s = payload["signals"]
        row = {
            "t": round(t, 3),
            "ear": s.get("ear"),
            "perclos": s.get("perclos"),
            "heartRate": s.get("heartRate", 0),
            "faceConfidence": s.get("faceConfidence"),
            "label": self.label,
            "state": self.state,
        }
        self._fh.write(json.dumps(row) + "\n")
        self._fh.flush()
        self.rows += 1

    def close(self) -> None:
        self._fh.close()
