"""DMD (Driver Monitoring Dataset, Vicomtech) drowsiness annotations → per-frame eye labels.

Each session has an OpenLABEL file (`*_rgb_ann_drowsiness.json`) whose actions mark, per frame of
the face camera, `eyes_state/open`, `eyes_state/close`, `eyes_state/opening` and
`eyes_state/closing` (plus blinks and yawns). Only clear open / closed frames are used: the
half-open transition frames and the frames right next to a label change are ambiguous.

Pure helpers (no MediaPipe), used by scripts/process_dmd.py and unit-tested in tests/.
"""

from __future__ import annotations

import re

OPEN, CLOSED = 0, 1
EYE_ACTIONS = {"eyes_state/open": OPEN, "eyes_state/close": CLOSED}
FACE_SUFFIX = "_rgb_face.mp4"
ANN_SUFFIX = "_rgb_ann_drowsiness.json"


def openlabel_root(ann: dict) -> dict:
    return ann.get("openlabel") or ann.get("vcd") or ann


def session_name(ann: dict) -> str:
    """e.g. "gA_1_s5_2019-03-14T14;26;17+01;00_drowsiness"."""
    return str(openlabel_root(ann).get("metadata", {}).get("name", "unknown"))


def person_id(name: str) -> str:
    """Group + subject number ("gA_1"): sessions of one person share it."""
    parts = name.split("_")
    return "_".join(parts[:2]) if len(parts) >= 2 else name


def wears_glasses(ann: dict) -> bool | None:
    for obj in openlabel_root(ann).get("objects", {}).values():
        if obj.get("type") != "driver":
            continue
        for item in obj.get("object_data", {}).get("boolean", []):
            if item.get("name") == "glasses":
                return bool(item.get("val"))
    return None


def total_frames(ann: dict) -> int:
    root = openlabel_root(ann)
    face = root.get("streams", {}).get("face_camera", {})
    n = face.get("stream_properties", {}).get("total_frames")
    if n:
        return int(n)
    ends = [iv["frame_end"] for iv in root.get("frame_intervals", [])]
    return max(ends) + 1 if ends else 0


def eye_labels(ann: dict, margin: int = 2) -> dict[int, int]:
    """frame index → OPEN/CLOSED for frames clearly in one state.

    `margin` frames at both ends of every open/close interval are dropped (the lids are moving
    there), and a frame claimed by both states is dropped too.
    """
    labels: dict[int, int] = {}
    conflict: set[int] = set()
    for action in openlabel_root(ann).get("actions", {}).values():
        value = EYE_ACTIONS.get(action.get("type"))
        if value is None:
            continue
        for iv in action.get("frame_intervals", []):
            for f in range(iv["frame_start"] + margin, iv["frame_end"] - margin + 1):
                if labels.get(f, value) != value:
                    conflict.add(f)
                labels[f] = value
    for f in conflict:
        labels.pop(f, None)
    return labels


def _natural_key(name: str) -> list:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", name)]


def held_out_people(people: list[str], share: float = 0.25) -> set[str]:
    """People held out for testing: the last ~share of them (natural order, so gB_10 comes after
    gB_9), at least one, and only when at least 3 people exist. Fewer people → split each session
    by time instead (see time_split)."""
    people = sorted(set(people), key=_natural_key)
    if len(people) < 3:
        return set()
    n = max(1, round(len(people) * share))
    return set(people[-n:])


def time_split(frame: int, n_frames: int, test_share: float = 0.3, gap: int = 60) -> str | None:
    """Train on the start of a session, test on its end; frames within `gap` of the cut are
    dropped so neighbouring (near-identical) frames never land on both sides."""
    cut = int(n_frames * (1 - test_share))
    if frame < cut - gap:
        return "train"
    if frame >= cut:
        return "test"
    return None


def sample(frames: list[int], stride: int, cap: int, rng) -> list[int]:  # noqa: ANN001 - random.Random
    """Every `stride`-th frame (consecutive frames are near-duplicates), at most `cap`, sorted."""
    picked = sorted(frames)[::stride]
    if cap and len(picked) > cap:
        picked = sorted(rng.sample(picked, cap))
    return picked
