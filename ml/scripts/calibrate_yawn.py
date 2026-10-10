"""Calibrate the yawn detector's mouth-opening threshold (YAWN_MAR) on a public yawn image dataset.

Runs with the *driver_monitor* Python (it needs MediaPipe and the face landmark model):

    ../driver_monitor/venv/Scripts/python scripts/calibrate_yawn.py \\
        --dataset davidvazquezcic/yawn-dataset --yawn-dir yawn --no-yawn-dir "no yawn" --out-dir out/

For each image the face landmarks are found and the mouth aspect ratio (MAR) computed exactly as the
live monitor does. The threshold that best separates yawning from non-yawning faces is reported, with
how the current default (0.5) performs on the same images. Writes OUT/result.json and OUT/report.md.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MONITOR = ROOT.parent / "driver_monitor"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(MONITOR))

from guardian_ml.calibration import best_threshold, rates_at  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp"}


def class_images(base: Path, name: str) -> list[Path]:
    dirs = [p for p in base.rglob("*") if p.is_dir() and p.name.lower() == name.lower()]
    return sorted(f for d in dirs for f in d.iterdir() if f.suffix.lower() in IMAGE_SUFFIXES)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="Kaggle owner/name")
    ap.add_argument("--yawn-dir", default="yawn")
    ap.add_argument("--no-yawn-dir", default="no yawn")
    ap.add_argument("--per-class", type=int, default=400)
    ap.add_argument("--current", type=float, default=0.5, help="threshold in use today")
    ap.add_argument(
        "--floor",
        type=float,
        default=0.3,
        help="never recommend below this: talking reaches MAR ~0.4 and yawn photos rarely include talking",
    )
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--min-faces", type=int, default=30, help="per class; fewer = dataset unsuitable")
    ap.add_argument("--keep-raw", action="store_true", help="keep the Kaggle download")
    args = ap.parse_args()
    t0 = time.time()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    import config
    import cv2
    import kagglehub
    from detectors.landmarks import LandmarkExtractor
    from detectors.mouth import mouth_aspect_ratio

    os.environ.setdefault("KAGGLEHUB_CACHE", str(ROOT / "data" / "kaggle"))
    base = Path(kagglehub.dataset_download(args.dataset))
    print(f"dataset at {base}", flush=True)
    config.ensure_models()
    landmarker = LandmarkExtractor(config.FACE_LANDMARKER_MODEL)
    rng = random.Random(0)

    mars: dict[str, list[float]] = {"yawn": [], "other": []}
    seen = {"yawn": 0, "other": 0}
    for key, folder in (("yawn", args.yawn_dir), ("other", args.no_yawn_dir)):
        files = class_images(base, folder)
        rng.shuffle(files)
        files = files[: args.per_class] if args.per_class else files
        if not files:
            raise SystemExit(f"no images in a folder named {folder!r}")
        for i, f in enumerate(files):
            img = cv2.imread(str(f))
            if img is None:
                continue
            seen[key] += 1
            pts = landmarker.extract(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            if pts:
                mars[key].append(round(mouth_aspect_ratio(pts), 4))
            if (i + 1) % 100 == 0:
                print(f"{key}: {i + 1}/{len(files)} images, {len(mars[key])} faces found", flush=True)
    landmarker.close()
    if not args.keep_raw:
        import shutil

        shutil.rmtree(base, ignore_errors=True)

    found = {k: len(v) for k, v in mars.items()}
    if min(found.values()) < args.min_faces:
        raise SystemExit(
            f"Only {found['yawn']} yawn / {found['other']} non-yawn faces were detected. "
            "The images must show the whole face (mouth-only crops can't be measured), "
            "so this dataset can't calibrate the detector."
        )

    best = best_threshold(mars["yawn"], mars["other"], floor=args.floor)
    unconstrained = best_threshold(mars["yawn"], mars["other"])

    def percentiles(v: list[float]) -> dict[str, float]:
        s = sorted(v)
        return {f"p{q}": s[min(len(s) - 1, int(q / 100 * len(s)))] for q in (5, 25, 50, 75, 95)}

    current = rates_at(args.current, mars["yawn"], mars["other"])
    result = {
        "dataset": args.dataset,
        "images": seen,
        "faces_found": {k: len(v) for k, v in mars.items()},
        "recommended": best,
        "unconstrained": unconstrained,
        "floor": args.floor,
        "current": current,
        "mar_percentiles": {k: percentiles(v) for k, v in mars.items()},
        "seconds": round(time.time() - t0, 1),
    }
    (out / "result.json").write_text(json.dumps(result, indent=2), encoding="utf8")

    def row(name: str, r: dict[str, float]) -> str:
        return f"| {name} {r['threshold']} | {r['tpr']:.0%} | {r['fpr']:.0%} | {r['balanced_accuracy']:.0%} |"

    (out / "report.md").write_text(
        f"""# Yawn threshold calibration

Dataset: Kaggle `{args.dataset}` · images used yawn/no-yawn = {seen['yawn']}/{seen['other']} ·
faces found {len(mars['yawn'])}/{len(mars['other'])}.

| Threshold (MAR) | Yawns caught | Non-yawns wrongly flagged | Balanced accuracy |
|---|---|---|---|
{row('current', current)}
{row('**recommended**', best)}
{row('best on photos only', unconstrained)}

The recommendation is never below {args.floor}: talking and singing open the mouth to MAR ~0.4 and
these photos contain no talking faces, so a lower value could count long sentences as yawns.
MAR percentiles (5/25/50/75/95): yawn {list(percentiles(mars['yawn']).values())},
non-yawn {list(percentiles(mars['other']).values())}.

Static photos only test the mouth-opening level. The live detector additionally requires the mouth to
stay open for YAWN_MIN_S (1.5 s), which filters out talking and laughing.
""",
        encoding="utf8",
    )
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
