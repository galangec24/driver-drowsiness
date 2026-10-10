"""Turn a folder of driver videos (public datasets you downloaded) into labelled recordings.

Runs with the *driver_monitor* Python; each video goes through the real monitor pipeline offline:

    ../driver_monitor/venv/Scripts/python scripts/process_videos.py data/videos/uta-rldd \\
        --preset rldd --out data/raw/uta-rldd

Presets
  rldd     UTA-RLDD layout <participant>/<0|5|10>.mov — 0 alert, 10 drowsy, 5 ignored (ambiguous)
  folders  label from a parent folder name containing drowsy/sleepy/fatigue or alert/awake/normal

Then import + train (the admin "Process videos" job does all of this):
    python scripts/import_recordings.py data/raw/uta-rldd --out data/recordings_uta-rldd
    python scripts/train.py --data data/synthetic_v1 --extra data/recordings_uta-rldd
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MONITOR = ROOT.parent / "driver_monitor"
sys.path.insert(0, str(ROOT))

from guardian_ml.calibration import recording_name, video_label  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--preset", choices=["rldd", "folders"], default="rldd")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--limit", type=int, default=0, help="process at most N videos (0 = all)")
    args = ap.parse_args()

    folder = args.folder.resolve()
    videos = [(p, video_label(p, args.preset)) for p in sorted(folder.rglob("*")) if p.is_file()]
    videos = [(p, lab) for p, lab in videos if lab is not None]
    if args.limit:
        videos = videos[: args.limit]
    if not videos:
        raise SystemExit(f"no labelled videos found under {folder} with preset {args.preset!r}")
    args.out.mkdir(parents=True, exist_ok=True)
    print(f"{len(videos)} videos to process", flush=True)

    done = failed = 0
    for i, (video, label) in enumerate(videos, 1):
        target = (args.out / recording_name(video, folder)).resolve()
        if target.exists() and target.stat().st_size > 0:
            print(f"[{i}/{len(videos)}] skip (already processed) {video.name}", flush=True)
            done += 1
            continue
        print(f"[{i}/{len(videos)}] {video.relative_to(folder)} → {label}", flush=True)
        cmd = [
            sys.executable,
            "main.py",
            "--offline",
            "--no-window",
            "--video",
            str(video),
            "--label",
            label,
            "--record",
            str(target),
        ]
        res = subprocess.run(cmd, cwd=MONITOR, capture_output=True, text=True)  # noqa: S603 - fixed args
        if res.returncode == 0:
            done += 1
        else:
            failed += 1
            target.unlink(missing_ok=True)
            print(f"    failed: {res.stderr.strip()[-300:]}", flush=True)
    print(f"processed {done}, failed {failed} → {args.out}", flush=True)
    if done == 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
