"""Pure helpers for the admin dataset jobs (no MediaPipe/OpenCV imports, so they are unit-testable).

- best_threshold(): pick a cut-off that separates two score distributions (yawn MAR calibration).
- video_label(): map a public-dataset video file to a recording label (UTA-RLDD, folder presets).
"""

from __future__ import annotations

from pathlib import Path


def best_threshold(positives: list[float], negatives: list[float], floor: float = 0.0) -> dict[str, float]:
    """Threshold maximising balanced accuracy for "score >= t means positive" (Youden's J), never below
    `floor`. The floor encodes what the photos can't show: e.g. talking opens the mouth to MAR ~0.4, and
    yawn datasets rarely contain talking faces.

    Returns threshold, balanced_accuracy, tpr (yawns caught) and fpr (non-yawns wrongly flagged).
    """
    if not positives or not negatives:
        raise ValueError("need samples of both classes")
    cands = {c for c in set(positives) | set(negatives) if c >= floor}
    if floor > 0:
        cands.add(floor)  # the floor itself is always a valid choice
    candidates = sorted(cands)
    best = {"threshold": candidates[0], "balanced_accuracy": 0.0, "tpr": 0.0, "fpr": 0.0}
    n_pos, n_neg = len(positives), len(negatives)
    for t in candidates:
        tpr = sum(p >= t for p in positives) / n_pos
        fpr = sum(n >= t for n in negatives) / n_neg
        bal = (tpr + (1 - fpr)) / 2
        if bal > best["balanced_accuracy"] + 1e-12:
            best = {"threshold": t, "balanced_accuracy": bal, "tpr": tpr, "fpr": fpr}
    return {k: round(v, 4) for k, v in best.items()}


def rates_at(threshold: float, positives: list[float], negatives: list[float]) -> dict[str, float]:
    tpr = sum(p >= threshold for p in positives) / len(positives)
    fpr = sum(n >= threshold for n in negatives) / len(negatives)
    return {
        "threshold": threshold,
        "balanced_accuracy": round((tpr + 1 - fpr) / 2, 4),
        "tpr": round(tpr, 4),
        "fpr": round(fpr, 4),
    }


VIDEO_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}
# UTA-RLDD: <participant>/<0|5|10>.<ext> — 0 alert, 5 low vigilance (ambiguous → ignored), 10 drowsy.
RLDD_LABELS = {"0": "alert", "10": "drowsy", "5": "ignore"}
FOLDER_WORDS = {
    "drowsy": "drowsy",
    "sleepy": "drowsy",
    "fatigue": "drowsy",
    "alert": "alert",
    "awake": "alert",
    "normal": "alert",
}


def video_label(path: Path, preset: str) -> str | None:
    """'alert' | 'drowsy' | 'ignore' for a video, or None when the file should be skipped."""
    if path.suffix.lower() not in VIDEO_SUFFIXES:
        return None
    if preset == "rldd":
        return RLDD_LABELS.get(path.stem.strip())
    if preset == "folders":
        for part in reversed(path.parts[:-1]):
            for word, label in FOLDER_WORDS.items():
                if word in part.lower():
                    return label
        return None
    raise ValueError(f"unknown preset {preset!r}")


def recording_name(path: Path, root: Path) -> str:
    """Stable recording file name: <participant>_<rest>.jsonl (import_recordings uses the part before
    the first "_" as the driver id, so all videos of one participant stay in the same split)."""
    rel = path.relative_to(root).with_suffix("")
    parts = [p.replace("_", "-").replace(" ", "-") for p in rel.parts]
    participant = parts[0] if len(parts) > 1 else "video"
    return f"{participant}_{'-'.join(parts[1:] or parts)}.jsonl"
