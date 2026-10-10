"""Dataset loading (synthetic, imported recordings, and parent feedback share one tick format)."""

from __future__ import annotations

import csv
import gzip
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

FLOAT_COLS = ("t", "ear", "perclos", "heartRate", "faceConfidence", "level")


def load_dataset(
    path: str | Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """Returns (drivers by id, ticks grouped by session in time order)."""
    root = Path(path)
    drivers = {d["driver_id"]: d for d in json.loads((root / "drivers.json").read_text(encoding="utf8"))}
    sessions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with gzip.open(root / "ticks.csv.gz", "rt", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            for k in FLOAT_COLS:
                if k in r:
                    r[k] = float(r[k]) if r[k] not in ("", None) else None
            r["label"] = int(r["label"])
            sessions[r["session_id"]].append(r)
    for ticks in sessions.values():
        ticks.sort(key=lambda x: x["t"])
    return drivers, dict(sessions)
