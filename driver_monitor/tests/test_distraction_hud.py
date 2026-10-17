"""Distraction (eyes off the road, restless movement) and the real-time HUD."""

from __future__ import annotations

import math

import numpy as np

from detectors.distraction import DistractionDetector
from detectors.head_pose import HeadPose
from fusion.watch_alerts import HIGH, MILD, NONE, WatchAlerter
from ui import hud


def steady(det: DistractionDetector, seconds: float, start: float = 0.0, fps: float = 10.0) -> float:
    """Driver looking at the road (small natural sway)."""
    t = start
    while t < start + seconds:
        det.update(HeadPose(pitch=-5 + math.sin(t) * 1.5, yaw=2 + math.sin(t * 0.7) * 2, roll=0), t)
        t += 1 / fps
    return t


def test_short_glances_are_fine_but_looking_away_is_counted():
    det = DistractionDetector()
    t = steady(det, 10)
    # 1 s mirror check: not a distraction
    for _ in range(10):
        s = det.update(HeadPose(pitch=-5, yaw=40, roll=0), t)
        t += 0.1
    assert s.away_for_s < det.away_s and s.count == 0
    t = steady(det, 2, t)
    # phone on the lap: head down for 3 s
    for _ in range(30):
        s = det.update(HeadPose(pitch=-35, yaw=2, roll=0), t)
        t += 0.1
    assert s.away_for_s >= det.away_s
    assert s.count == 1


def test_continuous_unnecessary_movement_is_restless():
    det = DistractionDetector()
    t = steady(det, 12)
    assert not det.state.restless and det.state.speed < det.restless_speed
    for i in range(130):  # fidgeting / looking around for 13 s
        yaw = 25 * math.sin(i * 0.9)
        det.update(HeadPose(pitch=-5 + 8 * math.sin(i * 1.3), yaw=yaw, roll=6 * math.sin(i)), t)
        t += 0.1
    assert det.state.restless and det.state.speed >= det.restless_speed
    assert det.state.count >= 1


def test_face_turned_out_of_view_counts_as_looking_away():
    det = DistractionDetector()
    t = steady(det, 10)
    for _ in range(30):
        s = det.update(None, t)
        t += 0.1
    assert s.away_for_s >= det.away_s
    # an empty seat long after the last face is not "looking away"
    s = det.update(None, t + 60)
    assert s.away_for_s == 0


def test_in_car_alarm_warns_then_escalates_for_distraction():
    sent: list[int] = []
    a = WatchAlerter(send=sent.append)
    assert a.on_frame(0, 0, 0.0, restless=True) == MILD
    assert a.reason_now == "restless: too much movement"
    assert a.on_frame(0, 0, 1.0, away_for_s=2.5) == MILD
    assert a.on_frame(0, 0, 2.0, away_for_s=5.5) == HIGH
    assert "eyes off the road" in a.reason_now
    assert sent[:2] == [MILD, HIGH]
    assert a.on_frame(0, 0, 30.0) == NONE


def test_hud_renders_each_state():
    frame = np.full((480, 640, 3), 90, np.uint8)
    for level in (0, 1, 2):
        screen = hud.render(
            frame,
            hud.HudState(
                level=level,
                reason="Eyes closed 2.4s" if level == 2 else "",
                driver="Driver: Ana (90%)",
                connection="Server: online",
                ear=0.1,
                baseline=0.31,
                perclos=0.5,
                closed_for_s=2.4,
                movement=12,
                yawns=1,
                nods=0,
                distractions=2,
                face=(200, 100, 220, 260),
            ),
            t=0.0,
        )
        assert screen.shape == (hud.HEIGHT, int(640 * hud.HEIGHT / 480) + hud.PANEL_W, 3)
    # drowsy: red frame around the camera image
    b, g, r = screen[5, 5]
    assert r > 200 and b < 100


def test_eye_readings_are_unreliable_right_after_the_face_returns():
    det = DistractionDetector()
    t = steady(det, 10)
    p = HeadPose(pitch=-5, yaw=2, roll=0)
    assert det.eyes_reliable(p, t)
    for _ in range(20):  # hiding from the camera for 2 s
        det.update(None, t)
        t += 0.1
    det.update(p, t)
    assert not det.eyes_reliable(p, t)  # just back: still settling
    t = steady(det, 2, t)
    assert det.eyes_reliable(p, t)
    turned = HeadPose(pitch=-5, yaw=40, roll=0)
    det.update(turned, t)
    assert not det.eyes_reliable(turned, t)  # head turned far aside
