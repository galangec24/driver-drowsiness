"""Download a small open/closed eye image dataset from Kaggle and compact it.

    python scripts/fetch_eye_data.py                     # serenaraju/yawn-eye-dataset-new, all ~1,450 eyes
    python scripts/fetch_eye_data.py --per-class 400     # smaller
    python scripts/fetch_eye_data.py --dataset <owner/name> --open-dir Open --closed-dir Closed

Public datasets download without a Kaggle account; if kagglehub asks for credentials, put your
token in %USERPROFILE%\\.kaggle\\kaggle.json (Kaggle → Settings → API → Create New Token).

Writes data/eyes_v1/eyes.npz (64x64 grayscale crops + labels + original split) and
data/eyes_v1/stats.json, then deletes the raw download (~160 MB) unless --keep-raw.
Check the dataset's licence on its Kaggle page before redistributing anything derived from it.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "kaggle"
STORE = 64  # stored crop size; training augments from this, then preprocesses to 32x32


def find_class_dirs(base: Path, name: str) -> list[Path]:
    return [p for p in base.rglob("*") if p.is_dir() and p.name.lower() == name.lower()]


def ahash(img: np.ndarray) -> int:
    """8x8 average hash, for near-duplicate detection across the train/test split."""
    small = cv2.resize(img, (8, 8), interpolation=cv2.INTER_AREA)
    bits = (small > small.mean()).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="serenaraju/yawn-eye-dataset-new")
    ap.add_argument(
        "--local", default=None, help="use a local folder with Open/ and Closed/ instead of Kaggle"
    )
    ap.add_argument("--open-dir", default="Open")
    ap.add_argument("--closed-dir", default="Closed")
    ap.add_argument("--per-class", type=int, default=0, help="cap images per class (0 = all)")
    ap.add_argument("--out", default="data/eyes_v1")
    ap.add_argument("--keep-raw", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    if args.local:
        base = Path(args.local)
        args.dataset = f"local:{base.name}"
        args.keep_raw = True
    else:
        os.environ.setdefault("KAGGLEHUB_CACHE", str(CACHE))
        import kagglehub

        base = Path(kagglehub.dataset_download(args.dataset))
    rng = random.Random(args.seed)
    images, labels, splits, names = [], [], [], []
    for label, cls in ((0, args.open_dir), (1, args.closed_dir)):
        files = []
        for d in find_class_dirs(base, cls):
            split = "test" if "test" in {p.lower() for p in d.relative_to(base).parts} else "train"
            files += [
                (f, split)
                for f in sorted(d.iterdir())
                if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}
            ]
        rng.shuffle(files)
        if args.per_class:
            files = files[: args.per_class]
        for f, split in files:
            img = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
            if img is None:
                continue
            images.append(cv2.resize(img, (STORE, STORE), interpolation=cv2.INTER_AREA))
            labels.append(label)
            splits.append(split)
            names.append(f"{cls}/{f.name}")
    if not images:
        raise SystemExit(f"no images found under {base} (folders {args.open_dir!r}/{args.closed_dir!r})")

    X = np.stack(images)
    y = np.array(labels, dtype=np.int8)
    split_arr = np.array(splits)
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out / "eyes.npz", images=X, labels=y, split=split_arr, names=np.array(names))

    hashes = [ahash(im) for im in X]
    train_hashes = {h for h, s in zip(hashes, splits, strict=True) if s == "train"}
    dup_test = sum(1 for h, s in zip(hashes, splits, strict=True) if s == "test" and h in train_hashes)
    stats = {
        "dataset": args.dataset,
        "images": int(len(y)),
        "open": int((y == 0).sum()),
        "closed": int((y == 1).sum()),
        "train": int((split_arr == "train").sum()),
        "test": int((split_arr == "test").sum()),
        "test_images_with_near_duplicate_in_train": dup_test,
    }
    (out / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf8")
    print(json.dumps(stats, indent=2))

    if not args.keep_raw:
        shutil.rmtree(CACHE, ignore_errors=True)
        print(f"removed raw download ({CACHE})")


if __name__ == "__main__":
    main()
