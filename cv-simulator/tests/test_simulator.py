"""Payload shape + scenario logic. No test talks to the backend."""

from __future__ import annotations

import random
from datetime import datetime

import pytest

from drowsiness_sim import (
    DEFAULT_SNAPSHOT,
    RouteSimulator,
    build_payload,
    build_replay_payload,
    load_phases,
    load_profile,
    parse_latlng,
    phase_at,
    snapshot_payload,
)

DRIVER = "665f00000000000000000001"


@pytest.mark.parametrize("name", ["alert", "drowsy", "microsleep"])
def test_payload_matches_ingest_contract(name: str) -> None:
    payload = build_payload(DRIVER, load_profile(name), random.Random(1))
    assert list(payload) == ["driverId", "source", "signals", "timestamp"]
    assert payload["source"] == "simulated"
    assert list(payload["signals"]) == ["ear", "perclos", "heartRate", "faceConfidence", "matchedDriver"]
    assert isinstance(payload["signals"]["heartRate"], int)
    assert 0 <= payload["signals"]["ear"] <= 0.5
    assert 0 <= payload["signals"]["perclos"] <= 1
    assert payload["timestamp"].endswith("Z")
    datetime.fromisoformat(payload["timestamp"].replace("Z", "+00:00"))


def test_profiles_are_ordered_by_severity() -> None:
    rng = random.Random(7)
    mean_ear = {
        n: sum(build_payload(DRIVER, load_profile(n), rng)["signals"]["ear"] for _ in range(200)) / 200
        for n in ("alert", "drowsy", "microsleep")
    }
    assert mean_ear["alert"] > mean_ear["drowsy"] > mean_ear["microsleep"]


def test_mixed_cycles_20_10_5() -> None:
    phases = load_phases("mixed")
    assert [p.label for p in phases] == ["alert", "warning", "drowsy"]
    assert phase_at(phases, 0).label == "alert"
    assert phase_at(phases, 19.9).label == "alert"
    assert phase_at(phases, 20).label == "warning"
    assert phase_at(phases, 31).label == "drowsy"
    assert phase_at(phases, 35).label == "alert"  # repeats
    assert phase_at(phases, 35 + 22).label == "warning"


def test_single_profile_is_one_endless_phase() -> None:
    phases = load_phases("drowsy")
    assert len(phases) == 1
    assert phase_at(phases, 10_000).label == "drowsy"


def test_unknown_scenario_exits() -> None:
    with pytest.raises(SystemExit):
        load_profile("does_not_exist")


@pytest.mark.parametrize("name", ["episode", "false_alarm"])
def test_replay_scenarios_follow_the_contract(name: str) -> None:
    phases = load_phases(name)
    assert len(phases) == 1 and "replay" in phases[0].profile
    replay = phases[0].profile["replay"]
    assert len(replay) >= 30
    payload = build_replay_payload(DRIVER, replay[0])
    assert list(payload) == ["driverId", "source", "signals", "timestamp"]
    assert set(payload["signals"]) <= {"ear", "perclos", "heartRate", "faceConfidence", "matchedDriver"}
    assert payload["signals"]["matchedDriver"] == DRIVER


def test_replay_omits_missing_signals() -> None:
    payload = build_replay_payload(DRIVER, {"heartRate": 0, "faceConfidence": 0.0})
    assert "ear" not in payload["signals"] and "perclos" not in payload["signals"]


def test_route_moves_at_plausible_speed() -> None:
    route = RouteSimulator((14.5547, 121.0244), random.Random(3))
    first = route.step(1.0)
    last = first
    for _ in range(59):
        last = route.step(1.0)
    assert set(first) == {"lat", "lng", "heading", "speed", "accuracy"}
    # 60 s at 15-90 km/h stays within ~1.5 km of the start.
    dlat = (last["lat"] - 14.5547) * 111_000
    dlng = (last["lng"] - 121.0244) * 111_000 * 0.968
    assert 50 < (dlat**2 + dlng**2) ** 0.5 < 1500
    assert 0 <= last["heading"] < 360 and 15 <= last["speed"] <= 90


def test_parse_latlng() -> None:
    assert parse_latlng("14.5,121.0") == (14.5, 121.0)
    assert parse_latlng("") is None
    assert parse_latlng("95,10") is None


@pytest.mark.skipif(not DEFAULT_SNAPSHOT.exists(), reason="backend fixture not present")
def test_snapshot_payload_is_jpeg_data_url() -> None:
    p = snapshot_payload(DRIVER, "665f00000000000000000002", str(DEFAULT_SNAPSHOT))
    assert list(p) == ["driverId", "alertId", "image"]
    assert p["image"].startswith("data:image/jpeg;base64,/9j/")
