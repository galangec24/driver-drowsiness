"""Real-time driver monitoring screen (the preview window).

Camera on the left (scaled to the window), a status panel on the right:
  - big status: AWAKE / WARNING / DROWSY with the reason ("Eyes closed 2.4 s"),
  - gauges: eye openness vs the driver's own baseline, PERCLOS vs the limit, head movement,
    and the fuzzy-logic fatigue score (fusion/fuzzy.py) with its warning / drowsy bands,
  - counters: blinks per minute (3-min average), slow blinks (2 min), yawns (10 min), nods and
    distractions (5 min),
  - who is driving, and the connection state.
Pure drawing (OpenCV), no camera or network, so it can be tested with a still frame.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from ui import unitext

PANEL_W = 380
HEIGHT = 720

Color = tuple[int, int, int]

# BGR
GREEN = (129, 185, 16)
AMBER = (11, 158, 245)
RED = (68, 68, 239)
WHITE = (240, 240, 240)
MUTED = (195, 160, 154)
INK = (31, 13, 11)
BAR_BG = (70, 45, 40)
FONT = cv2.FONT_HERSHEY_SIMPLEX

LEVEL_STYLE = {0: ("AWAKE", GREEN), 1: ("WARNING", AMBER), 2: ("DROWSY", RED)}


@dataclass
class HudState:
    level: int = 0  # 0 awake, 1 warning, 2 drowsy
    reason: str = ""
    driver: str = ""
    connection: str = ""
    ear: float | None = None
    baseline: float | None = None
    perclos: float = 0.0
    perclos_limit: float = 0.4
    closed_for_s: float = 0.0
    movement: float = 0.0  # head-turn speed, deg/s
    movement_limit: float = 30.0
    yawns: int = 0
    nods: int = 0
    distractions: int = 0
    fatigue: float = 0.0  # fuzzy-logic fatigue 0..1
    fatigue_reason: str = ""
    blink_rate: float | None = None  # per minute, 3-min average (None until 2 min watched)
    long_blinks: int = 0
    face: tuple[int, int, int, int] | None = None  # x, y, w, h in camera pixels
    eyes: list[np.ndarray] = field(default_factory=list)
    night: str = ""
    extra: list[str] = field(default_factory=list)
    # (title, text) of a parent's message, shown in a highlighted box for a few seconds
    message: tuple[str, str] | None = None


def _text(
    img: np.ndarray,
    s: str,
    org: tuple[int, int],
    scale: float = 0.55,
    color: Color = WHITE,
    thick: int = 1,
) -> None:
    cv2.putText(img, s, org, FONT, scale, color, thick, cv2.LINE_AA)


def _bar(
    img: np.ndarray,
    x: int,
    y: int,
    w: int,
    label: str,
    value: float,
    maximum: float,
    color: Color,
    marker: float | None = None,
    right: str = "",
) -> None:
    _text(img, label, (x, y), 0.5, MUTED)
    if right:
        (tw, _), _ = cv2.getTextSize(right, FONT, 0.5, 1)
        _text(img, right, (x + w - tw, y), 0.5, WHITE)
    y0 = y + 10
    cv2.rectangle(img, (x, y0), (x + w, y0 + 12), BAR_BG, -1)
    fill = int(w * max(0.0, min(1.0, value / maximum))) if maximum else 0
    cv2.rectangle(img, (x, y0), (x + fill, y0 + 12), color, -1)
    if marker is not None:
        mx = x + int(w * max(0.0, min(1.0, marker / maximum)))
        cv2.line(img, (mx, y0 - 3), (mx, y0 + 15), WHITE, 2)


def render(frame: np.ndarray, s: HudState, t: float) -> np.ndarray:
    """One screen: scaled camera + status panel. `t` drives the blink when drowsy."""
    h, w = frame.shape[:2]
    scale = HEIGHT / h
    cam_w = int(w * scale)
    cam = cv2.resize(frame, (cam_w, HEIGHT), interpolation=cv2.INTER_LINEAR)
    label, color = LEVEL_STYLE.get(s.level, LEVEL_STYLE[0])

    # Camera overlays: face box and eyes in the status colour.
    if s.face:
        x, y, fw, fh = (int(v * scale) for v in s.face)
        cv2.rectangle(cam, (x, y), (x + fw, y + fh), color, 3)
    for eye in s.eyes:
        cv2.polylines(cam, [np.array(eye * scale, dtype=np.int32)], True, (248, 140, 129), 1)
    blink_on = int(t * 3) % 2 == 0
    if s.level >= 2 and blink_on:
        cv2.rectangle(cam, (0, 0), (cam_w - 1, HEIGHT - 1), RED, 14)
    if s.night:
        _text(cam, s.night, (16, HEIGHT - 20), 0.6, AMBER, 2)

    panel = np.full((HEIGHT, PANEL_W, 3), INK, np.uint8)
    x, pw = 22, PANEL_W - 44
    _text(panel, "GUARDIAN DRIVE", (x, 36), 0.6, MUTED, 1)
    _text(panel, (s.driver or "Driver")[:34], (x, 64), 0.58, WHITE, 1)

    # Status card
    card_color = color if (s.level < 2 or blink_on) else tuple(int(c * 0.55) for c in color)
    cv2.rectangle(panel, (x, 82), (x + pw, 192), card_color, -1)
    (tw, _), _ = cv2.getTextSize(label, FONT, 1.5, 3)
    _text(panel, label, (x + (pw - tw) // 2, 140), 1.5, (255, 255, 255), 3)
    reason = s.reason or ("Eyes on the road" if s.level == 0 else "")
    rs = 0.55 if len(reason) <= 32 else 0.42
    reason = reason[:48]
    (rw, _), _ = cv2.getTextSize(reason, FONT, rs, 1)
    _text(panel, reason, (x + max(8, (pw - rw) // 2), 176), rs, (255, 255, 255), 1)

    y = 232
    openness = (s.ear / s.baseline) if (s.ear is not None and s.baseline) else None
    _bar(
        panel,
        x,
        y,
        pw,
        "Eye openness",
        openness if openness is not None else 0,
        1.2,
        GREEN if (openness or 0) > 0.7 else (AMBER if (openness or 0) > 0.45 else RED),
        marker=0.7,
        right=f"{min(openness, 1.2) * 100:.0f}%" if openness is not None else "no face",
    )
    y += 52
    _bar(
        panel,
        x,
        y,
        pw,
        "Eyes closed (PERCLOS, 30 s)",
        s.perclos,
        max(0.8, s.perclos_limit * 1.5),
        RED if s.perclos >= s.perclos_limit else (AMBER if s.perclos >= s.perclos_limit * 0.6 else GREEN),
        marker=s.perclos_limit,
        right=f"{s.perclos * 100:.0f}%",
    )
    y += 52
    _bar(
        panel,
        x,
        y,
        pw,
        "Head movement",
        s.movement,
        s.movement_limit * 1.6,
        AMBER if s.movement >= s.movement_limit else GREEN,
        marker=s.movement_limit,
        right=f"{s.movement:.0f} deg/s",
    )
    y += 52
    _bar(
        panel,
        x,
        y,
        pw,
        "Fatigue (fuzzy logic)",
        s.fatigue,
        1.0,
        RED if s.fatigue > 0.7 else (AMBER if s.fatigue > 0.4 else GREEN),
        marker=0.7,
        right=f"{s.fatigue * 100:.0f}%",
    )
    if s.fatigue_reason and s.fatigue > 0.4:
        _text(panel, s.fatigue_reason[:46], (x, y + 40), 0.42, AMBER)
    y += 62
    if s.closed_for_s >= 0.3:
        _text(
            panel,
            f"Eyes closed now: {s.closed_for_s:.1f} s",
            (x, y),
            0.6,
            RED if s.closed_for_s >= 1.5 else AMBER,
            2,
        )
    y += 34

    # Counters (last 5 minutes)
    _text(panel, "BLINK/MIN (3 MIN) - SLOW (2 MIN) - YAWNS (10 MIN)", (x, y), 0.38, MUTED)
    y += 12
    gap = 6
    box_w = (pw - 4 * gap) // 5
    blink = "--" if s.blink_rate is None else f"{s.blink_rate:.0f}"
    counters = (
        ("Blinks", blink, s.blink_rate is not None and s.blink_rate >= 28),
        ("Slow", str(s.long_blinks), s.long_blinks >= 6),
        ("Yawns", str(s.yawns), s.yawns >= 3),
        ("Nods", str(s.nods), s.nods >= 2),
        ("Distract", str(s.distractions), s.distractions >= 2),
    )
    for i, (name, value, warn) in enumerate(counters):
        bx = x + i * (box_w + gap)
        cv2.rectangle(panel, (bx, y), (bx + box_w, y + 62), (55, 33, 28), -1)
        (vw, _), _ = cv2.getTextSize(value, FONT, 0.9, 2)
        _text(panel, value, (bx + (box_w - vw) // 2, y + 34), 0.9, AMBER if warn else WHITE, 2)
        (nw, _), _ = cv2.getTextSize(name, FONT, 0.38, 1)
        _text(panel, name, (bx + (box_w - nw) // 2, y + 54), 0.38, MUTED)
    y += 86

    if s.message:
        title, text = s.message
        cv2.rectangle(panel, (x, y - 4), (x + pw, y + 58), (120, 70, 40), -1)
        cv2.rectangle(panel, (x, y - 4), (x + pw, y + 58), (248, 140, 129), 1)
        drawn = False
        if unitext.needs_unicode(title + text):  # Chinese, ñ, é...: OpenCV can't draw these
            font = unitext.font_for(text, 16)
            if font is not None:
                lines = unitext.wrap(text, font, pw - 20, 2)
                unitext.draw_lines(panel, [title[:40]], x + 10, y + 1, 16, (255, 255, 255))
                drawn = unitext.draw_lines(panel, lines, x + 10, y + 21, 16, WHITE, font, gap=2)
        if not drawn:
            _text(panel, title[:40], (x + 10, y + 16), 0.5, (255, 255, 255), 1)
            _text(panel, text[:42], (x + 10, y + 38), 0.48, WHITE)
            if len(text) > 42:
                _text(panel, text[42:84], (x + 10, y + 54), 0.48, WHITE)
        y += 70

    for line in s.extra[:3]:
        _text(panel, line[:44], (x, y), 0.48, MUTED)
        y += 22
    _text(panel, s.connection[:44], (x, HEIGHT - 44), 0.5, MUTED)
    _text(panel, "q: quit", (x, HEIGHT - 18), 0.45, MUTED)
    return np.hstack([cam, panel])
