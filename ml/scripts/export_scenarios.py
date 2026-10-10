"""Export realistic replay scenarios for cv-simulator from the synthetic test drivers.

    python scripts/export_scenarios.py --data data/synthetic_v1

Writes cv-simulator/scenarios/episode.json (a drowsiness onset the verifier confirms) and
false_alarm.json (confounders that fusion alone alerts on but the verifier suppresses). Each is
checked with the exact backend alert policy before it is written.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from guardian_ml.data import load_dataset
from guardian_ml.export import predict_portable
from guardian_ml.fusion import DEFAULT_THRESHOLDS
from guardian_ml.policy import run_session

OUT = ROOT.parent / "cv-simulator" / "scenarios"
SIGNALS = ("ear", "perclos", "heartRate", "faceConfidence")
LEAD_S = 45  # awake seconds before onset (the verifier needs >= 10 ticks of history)


def as_replay(ticks: list[dict]) -> list[dict]:
    return [
        {k: (int(t[k]) if k == "heartRate" else t[k]) for k in SIGNALS if t[k] is not None} for t in ticks
    ]


def alerts(ticks: list[dict], model: dict | None) -> list[tuple[float, str]]:
    """Alerts the backend would raise for this replay, for a driver on default thresholds."""
    replay = [{**t, "t": float(i)} for i, t in enumerate(ticks)]
    verifier = (lambda f: predict_portable(model, f)) if model else None
    run = run_session(
        replay, DEFAULT_THRESHOLDS, verifier=verifier, threshold=model["threshold"] if model else 0.5
    )
    return [(d.t, d.alert) for d in run.decisions if d.alert]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/synthetic_v1")
    args = ap.parse_args()
    model = json.loads(
        (ROOT.parent / "backend" / "src" / "ml" / "fp-verifier.json").read_text(encoding="utf8")
    )
    drivers, sessions = load_dataset(ROOT / args.data)

    # Replays run on a simulator driver with DEFAULT thresholds, so only use drivers on defaults.
    default_ids = {d for d, v in drivers.items() if v["thresholds"]["earThreshold"] == 0.21}
    episode = false_alarm = None
    episode_first = float("inf")
    for _, ticks in sorted(sessions.items()):
        if ticks[0]["driver_id"] not in default_ids:
            continue
        # Episode: the drowsiness onset the verifier confirms soonest (best for a live demo).
        onset = next((i for i, t in enumerate(ticks) if t["label"] == 1), None)
        if onset is not None and onset > LEAD_S:
            seg = ticks[onset - LEAD_S : onset + 180]
            fired = alerts(seg, model)
            # No alert during the awake lead-in, so the first alert is one the verifier confirmed.
            if fired and fired[0][0] >= LEAD_S and all(t["label"] != 0 for t in seg[LEAD_S:]):
                if episode is None or fired[0][0] < episode_first:
                    episode, episode_first = seg[: int(fired[0][0]) + 30], fired[0][0]
        if false_alarm is None:
            for start in range(0, len(ticks) - 150, 30):
                seg = ticks[start : start + 150]
                if any(t["label"] != 0 for t in seg) or seg[0]["state"] == "alert" == seg[-1]["state"]:
                    continue
                if len(alerts(seg, None)) >= 2 and not alerts(seg, model):
                    false_alarm = seg
                    break

    if not episode or not false_alarm:
        raise SystemExit("no suitable segments found; generate a larger dataset")

    for name, seg, desc in [
        (
            "episode",
            episode,
            "Realistic drowsiness onset (45 s awake, then drowsy). The verifier confirms it.",
        ),
        (
            "false_alarm",
            false_alarm,
            "Not drowsy: "
            + ", ".join(sorted({t["state"] for t in false_alarm}))
            + ". Fusion alone alerts; the verifier "
            "suppresses it.",
        ),
    ]:
        data = {
            "description": desc,
            "replay": as_replay(seg),
            "expected": {
                "fusion_only_alerts": len(alerts(seg, None)),
                "with_verifier_alerts": len(alerts(seg, model)),
                "first_alert_after_s": next(iter(t for t, _ in alerts(seg, model)), None),
            },
        }
        (OUT / f"{name}.json").write_text(json.dumps(data, indent=1), encoding="utf8")
        print(name, data["expected"], f"{len(seg)} ticks")


if __name__ == "__main__":
    main()
