"""Convert driver_monitor recordings (.jsonl) into a dataset directory usable by train.py --extra.

Record:   cd driver_monitor && python main.py --offline --record ../ml/data/raw/alex_day1.jsonl
          (hotkeys 1 drowsy / 0 alert / 9 ignore / t m p s confounders)
Video:    python main.py --offline --video clip.mp4 --label drowsy --record ../ml/data/raw/rldd_07_10.jsonl
Import:   python scripts/import_recordings.py data/raw/*.jsonl --out data/recordings_v1
          (folders are accepted too: every *.jsonl inside them, recursively)

Each file is one session. The driver id is the part of the file name before the first "_"
(override with --driver). Thresholds default to the backend defaults; pass --thresholds FILE.json
(driver_id → personalThresholds) to use each driver's real thresholds. Unlabelled rows become -1
(ignored for training and false-alarm counting).
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
from pathlib import Path

DEFAULT_THRESHOLDS = {
    "earThreshold": 0.21,
    "perclosThreshold": 0.4,
    "drowsyDurationMs": 2000,
    "fusionWeightVision": 0.6,
    "fusionWeightPhysio": 0.4,
}
COLUMNS = [
    "driver_id",
    "session_id",
    "t",
    "ear",
    "perclos",
    "heartRate",
    "faceConfidence",
    "label",
    "state",
    "level",
]


def expand_inputs(paths: list[Path]) -> list[Path]:
    """Files as given; directories → their *.jsonl files (sorted, recursive)."""
    out: list[Path] = []
    for p in paths:
        out += sorted(p.rglob("*.jsonl")) if p.is_dir() else [p]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--driver", default=None)
    ap.add_argument("--thresholds", type=Path, default=None)
    args = ap.parse_args()

    per_driver = json.loads(args.thresholds.read_text(encoding="utf8")) if args.thresholds else {}
    args.files = expand_inputs(args.files)
    if not args.files:
        raise SystemExit("no .jsonl recordings found")
    args.out.mkdir(parents=True, exist_ok=True)
    drivers: dict[str, dict] = {}
    n_rows = 0
    with gzip.open(args.out / "ticks.csv.gz", "wt", newline="", encoding="utf8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        for path in args.files:
            driver = args.driver or path.stem.split("_")[0]
            drivers.setdefault(
                driver,
                {
                    "driver_id": driver,
                    "thresholds": {**DEFAULT_THRESHOLDS, **per_driver.get(driver, {})},
                },
            )
            rows = [json.loads(line) for line in path.read_text(encoding="utf8").splitlines() if line.strip()]
            t0 = rows[0]["t"] if rows else 0.0
            for r in rows:
                label = r.get("label")
                w.writerow(
                    {
                        "driver_id": driver,
                        "session_id": f"{driver}_{path.stem}",
                        "t": round(r["t"] - t0, 3),
                        "ear": "" if r.get("ear") is None else r["ear"],
                        "perclos": "" if r.get("perclos") is None else r["perclos"],
                        "heartRate": r.get("heartRate") or 0,
                        "faceConfidence": r.get("faceConfidence") or 0,
                        "label": -1 if label is None else int(label),
                        "state": r.get("state", "unlabelled"),
                        "level": "",
                    }
                )
                n_rows += 1
    (args.out / "drivers.json").write_text(json.dumps(list(drivers.values()), indent=1), encoding="utf8")
    print(f"imported {len(args.files)} sessions, {n_rows} ticks, {len(drivers)} drivers -> {args.out}")


if __name__ == "__main__":
    main()
