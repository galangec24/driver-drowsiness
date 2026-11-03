"""DMD annotation parsing and splitting (guardian_ml.dmd)."""

import random

from guardian_ml.dmd import (
    CLOSED,
    OPEN,
    eye_labels,
    held_out_people,
    person_id,
    sample,
    session_name,
    time_split,
    total_frames,
    wears_glasses,
)


def ann(actions, total=100, glasses=True):
    return {
        "openlabel": {
            "metadata": {"name": "gA_1_s5_2019-03-14T14;26;17+01;00_drowsiness"},
            "streams": {"face_camera": {"stream_properties": {"total_frames": total}}},
            "objects": {
                "0": {"type": "driver", "object_data": {"boolean": [{"name": "glasses", "val": glasses}]}}
            },
            "actions": {
                str(i): {"type": t, "frame_intervals": [{"frame_start": a, "frame_end": b} for a, b in ivs]}
                for i, (t, ivs) in enumerate(actions)
            },
        }
    }


def test_open_and_closed_frames_with_margin_and_no_transitions():
    a = ann(
        [
            ("eyes_state/open", [(0, 9)]),
            ("eyes_state/closing", [(10, 12)]),
            ("eyes_state/close", [(13, 22)]),
            ("blinks/blinking", [(10, 25)]),
        ]
    )
    labels = eye_labels(a, margin=2)
    assert [f for f, v in labels.items() if v == OPEN] == list(range(2, 8))
    assert [f for f, v in labels.items() if v == CLOSED] == list(range(15, 21))
    assert 11 not in labels  # "closing" is ambiguous, never used


def test_frames_claimed_by_both_states_are_dropped():
    a = ann([("eyes_state/open", [(0, 10)]), ("eyes_state/close", [(8, 20)])])
    labels = eye_labels(a, margin=0)
    assert all(f not in labels for f in (8, 9, 10))
    assert labels[7] == OPEN and labels[11] == CLOSED


def test_metadata():
    a = ann([], total=5481, glasses=False)
    assert session_name(a).startswith("gA_1_s5")
    assert person_id(session_name(a)) == "gA_1"
    assert total_frames(a) == 5481
    assert wears_glasses(a) is False


def test_people_held_out_only_when_there_are_enough():
    assert held_out_people(["gA_1", "gA_5"]) == set()
    assert held_out_people(["gA_1", "gA_5", "gB_2", "gB_3"]) == {"gB_3"}
    assert len(held_out_people([f"g_{i}" for i in range(12)])) == 3
    # numbers compare as numbers: gB_10 is the last person, not gB_9
    assert held_out_people(["gA_1", "gB_6", "gB_9", "gB_10"]) == {"gB_10"}


def test_time_split_leaves_a_gap_at_the_cut():
    assert time_split(0, 1000) == "train"
    assert time_split(639, 1000) == "train"
    assert time_split(650, 1000) is None  # within 60 frames before the cut at 700
    assert time_split(700, 1000) == "test"


def test_sample_strides_then_caps():
    rng = random.Random(0)
    assert sample(list(range(10)), 2, 0, rng) == [0, 2, 4, 6, 8]
    picked = sample(list(range(100)), 1, 10, rng)
    assert len(picked) == 10 and picked == sorted(picked)
