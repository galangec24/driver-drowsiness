"""Generate the synthetic Guardian Drive dataset.

    python scripts/make_dataset.py                       # default: 240 drivers x 2 sessions x 25 min
    python scripts/make_dataset.py --drivers 20 --out data/smoke

Writes <out>/ticks.csv.gz (one row per 1 Hz tick), <out>/drivers.json and <out>/stats.json.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from guardian_ml.synth import Shift, generate

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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--drivers", type=int, default=240)
    ap.add_argument("--sessions", type=int, default=2)
    ap.add_argument("--minutes", type=float, default=25)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="data/synthetic_v1")
    ap.add_argument("--stress", action="store_true", help="shifted population for robustness testing")
    args = ap.parse_args()

    started = time.time()
    drivers, rows = generate(
        args.drivers, args.sessions, args.minutes, args.seed, Shift.stress() if args.stress else None
    )
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with gzip.open(out / "ticks.csv.gz", "wt", newline="", encoding="utf8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r[k] is None else r[k]) for k in COLUMNS})
    (out / "drivers.json").write_text(json.dumps(drivers, indent=1), encoding="utf8")

    labels = Counter(r["label"] for r in rows)
    states = Counter(r["state"] for r in rows)
    stats = {
        "seed": args.seed,
        "stress_shift": args.stress,
        "drivers": args.drivers,
        "sessions": args.drivers * args.sessions,
        "ticks": len(rows),
        "hours": round(len(rows) / 3600, 2),
        "labels": {
            "drowsy(1)": labels[1],
            "not_drowsy(0)": labels[0],
            "early_onset_ignored(-1)": labels[-1],
        },
        "states_seconds": dict(states.most_common()),
        "athletes": sum(d["athlete"] for d in drivers),
        "hr_sensor": sum(d["hr_sensor"] for d in drivers),
        "untuned_default_threshold": sum(d["thresholds"]["earThreshold"] == 0.21 for d in drivers),
    }
    (out / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf8")
    print(json.dumps(stats, indent=2))
    print(f"wrote {out} in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
