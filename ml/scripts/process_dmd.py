"""DMD (Driver Monitoring Dataset, Vicomtech) drowsiness sessions → eye crops for the eye model.

Real in-car face-camera video with every frame labelled eyes open / closed: the closest public match
to what the in-car monitor sees. Runs with the *driver_monitor* Python (MediaPipe):

    ../driver_monitor/venv/Scripts/python scripts/process_dmd.py data/videos/dmd --out data/eyes_dmd

Input: the archives as downloaded (dmd-dataset-drowsiness-gA-1.tar.gz …) and/or extracted folders.
Only each session's `*_rgb_face.mp4` and `*_rgb_ann_drowsiness.json` are read; the body and mosaic
videos are never extracted. Face videos are unpacked one at a time to a temporary file.

Eyes are cropped exactly like the live monitor does (FaceMesh landmarks → detectors.eye_state.crop_eye)
on frames downscaled to webcam size, so the crops look like the ones the model gets in the car.

Split: with 3+ people, whole people are held out for testing; with fewer, each session is split by
time (start = train, end = test, with a gap). Writes eyes.npz + stats.json in the same format as
fetch_eye_data.py, so train_eye_state.py takes it as `--extra data/eyes_dmd`.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import tarfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MONITOR = ROOT.parent / "driver_monitor"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(MONITOR))

from detectors.eye_state import crop_eye  # noqa: E402
from detectors.landmarks import LandmarkExtractor, eye_points  # noqa: E402
from fetch_eye_data import STORE, ahash  # noqa: E402

from guardian_ml.dmd import (  # noqa: E402
    ANN_SUFFIX,
    FACE_SUFFIX,
    eye_labels,
    held_out_people,
    person_id,
    sample,
    session_name,
    time_split,
    total_frames,
    wears_glasses,
)

ARCHIVES = (".tar", ".tar.gz", ".tgz")


def is_archive(p: Path) -> bool:
    return p.is_file() and any(p.name.lower().endswith(s) for s in ARCHIVES)


def find_sessions(folder: Path) -> list[dict]:
    """[{key, ann, face}] where ann/face are ("file", path) or ("tar", archive, member name)."""
    found: dict[str, dict] = {}
    for p in sorted(folder.rglob("*")):
        if is_archive(p):
            with tarfile.open(p, "r:*") as tf:
                for m in tf:
                    if not m.isfile():
                        continue
                    base = m.name.rsplit("/", 1)[-1]
                    for suffix, slot in ((FACE_SUFFIX, "face"), (ANN_SUFFIX, "ann")):
                        if base.endswith(suffix):
                            key = base[: -len(suffix)]
                            found.setdefault(key, {"key": key})[slot] = ("tar", p, m.name)
        elif p.is_file():
            for suffix, slot in ((FACE_SUFFIX, "face"), (ANN_SUFFIX, "ann")):
                if p.name.endswith(suffix):
                    key = p.name[: -len(suffix)]
                    found.setdefault(key, {"key": key})[slot] = ("file", p)
    sessions = [s for s in found.values() if "face" in s and "ann" in s]
    for s in found.values():
        if "face" not in s or "ann" not in s:
            print(f"skip {s['key']}: needs both {FACE_SUFFIX} and {ANN_SUFFIX}", flush=True)
    return sessions


def materialise(src: tuple, dest: Path) -> Path:
    """A session file on disk: as-is, or copied out of its archive to `dest` (a name we choose, so a
    member path can never write outside the temp folder)."""
    if src[0] == "file":
        return src[1]
    _, archive, member = src
    with tarfile.open(archive, "r:*") as tf:
        info = tf.getmember(member)
        if not info.isfile():
            raise SystemExit(f"{member} in {archive.name} is not a regular file")
        with tf.extractfile(info) as fin, open(dest, "wb") as fout:
            shutil.copyfileobj(fin, fout, 1 << 20)
    return dest


def crops_from_video(
    video: Path, wanted: dict[int, int], lm: LandmarkExtractor, width: int
) -> list[tuple[int, int, str, np.ndarray]]:
    """(frame, label, "R"/"L", 64x64 gray crop) for every wanted frame where a face was found."""
    out = []
    cap = cv2.VideoCapture(str(video))
    try:
        return _read_crops(cap, wanted, lm, width)
    finally:
        cap.release()  # also on errors, so the temporary video can be deleted


def _read_crops(
    cap: cv2.VideoCapture, wanted: dict[int, int], lm: LandmarkExtractor, width: int
) -> list[tuple[int, int, str, np.ndarray]]:
    out = []
    last = max(wanted) if wanted else -1
    idx = -1
    while idx < last:
        ok, bgr = cap.read()
        if not ok:
            break
        idx += 1
        if idx not in wanted:
            continue
        h, w = bgr.shape[:2]
        if w > width:
            bgr = cv2.resize(bgr, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)
        pts = lm.extract(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        if pts is None:
            continue
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        for side, eye in zip(("R", "L"), eye_points(pts), strict=True):
            c = crop_eye(gray, eye)
            if c is not None:
                out.append(
                    (idx, wanted[idx], side, cv2.resize(c, (STORE, STORE), interpolation=cv2.INTER_AREA))
                )
    cap.release()
    return out


def main() -> None:
    # Progress lines use "→" / "…": a redirected Windows console would otherwise be cp1252.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path, help="folder with DMD archives and/or extracted sessions")
    ap.add_argument("--out", default="data/eyes_dmd")
    ap.add_argument("--stride", type=int, default=2, help="use every Nth labelled frame")
    ap.add_argument("--per-class", type=int, default=300, help="max frames per class per session")
    ap.add_argument("--margin", type=int, default=2, help="frames dropped at each label change")
    ap.add_argument("--width", type=int, default=640, help="downscale frames to this width (webcam size)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    folder = args.folder.resolve()
    sessions = find_sessions(folder) if folder.exists() else []
    if not sessions:
        raise SystemExit(
            f"no DMD sessions under {folder}: put the downloaded dmd-dataset-drowsiness-*.tar.gz there"
        )
    print(f"{len(sessions)} session(s): {', '.join(s['key'] for s in sessions)}", flush=True)

    out = ROOT / args.out
    tmp = out / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    lm = LandmarkExtractor(MONITOR / "models" / "face_landmarker.task")
    images, labels, splits, names = [], [], [], []
    per_session = []
    try:
        anns = {
            s["key"]: json.loads(materialise(s["ann"], tmp / "ann.json").read_text(encoding="utf8"))
            for s in sessions
        }
        people = [person_id(session_name(a)) for a in anns.values()]
        held_out = held_out_people(people)
        rule = (
            f"by person: {', '.join(sorted(held_out))} held out for testing"
            if held_out
            else "by time: last 30 % of each session is the test set (fewer than 3 people)"
        )
        print(f"split {rule}", flush=True)

        for i, s in enumerate(sessions, 1):
            ann = anns[s["key"]]
            name, n_frames = session_name(ann), total_frames(ann)
            person = person_id(name)
            labelled = eye_labels(ann, margin=args.margin)

            def split_of(f: int, person: str = person, n_frames: int = n_frames) -> str | None:
                if held_out:
                    return "test" if person in held_out else "train"
                return time_split(f, n_frames)

            wanted: dict[int, int] = {}
            for value in (0, 1):
                for part in ("train", "test"):
                    frames = [f for f, v in labelled.items() if v == value and split_of(f) == part]
                    cap = args.per_class if part == "train" else max(1, args.per_class // 2)
                    for f in sample(frames, args.stride, cap, rng):
                        wanted[f] = value
            print(
                f"[{i}/{len(sessions)}] {s['key']}: {len(labelled)} clear frames, using {len(wanted)}; "
                "extracting face video…",
                flush=True,
            )
            video = materialise(s["face"], tmp / "face.mp4")
            try:
                crops = crops_from_video(video, wanted, lm, args.width)
            finally:
                if video.parent == tmp:
                    video.unlink(missing_ok=True)
            for f, value, side, img in crops:
                images.append(img)
                labels.append(value)
                splits.append(split_of(f))
                names.append(f"{s['key']}/{f}/{side}")
            faces = len({f for f, *_ in crops})
            got = [v for _, v, _, _ in crops]
            per_session.append(
                {
                    "session": s["key"],
                    "person": person,
                    "glasses": wears_glasses(ann),
                    "frames_used": len(wanted),
                    "faces_found": faces,
                    "open": got.count(0),
                    "closed": got.count(1),
                }
            )
            print(f"    faces found in {faces}/{len(wanted)} frames → {len(crops)} eye crops", flush=True)
    finally:
        lm.close()
        shutil.rmtree(tmp, ignore_errors=True)

    if not images:
        raise SystemExit("no eye crops produced (no faces found?)")
    X = np.stack(images)
    y = np.array(labels, dtype=np.int8)
    split_arr = np.array(splits)
    np.savez_compressed(out / "eyes.npz", images=X, labels=y, split=split_arr, names=np.array(names))

    hashes = [ahash(im) for im in X]
    train_hashes = {h for h, sp in zip(hashes, splits, strict=True) if sp == "train"}
    stats = {
        "dataset": "DMD drowsiness (Vicomtech, in-car face camera)",
        "images": int(len(y)),
        "open": int((y == 0).sum()),
        "closed": int((y == 1).sum()),
        "train": int((split_arr == "train").sum()),
        "test": int((split_arr == "test").sum()),
        "test_images_with_near_duplicate_in_train": sum(
            1 for h, sp in zip(hashes, splits, strict=True) if sp == "test" and h in train_hashes
        ),
        "people": sorted(set(people)),
        "split": rule,
        "sessions": per_session,
    }
    (out / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf8")
    print(json.dumps(stats, indent=2), flush=True)


if __name__ == "__main__":
    main()
