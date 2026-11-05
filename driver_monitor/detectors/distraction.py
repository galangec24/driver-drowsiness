"""Distraction: eyes off the road, and restless (continuous unnecessary) head movement.

Everything is relative to the driver's own neutral head position (rolling median of the last
minute), so a camera mounted off-centre doesn't count as "looking away".

- Eyes off the road: head turned (yaw) or tilted down (phone on the lap) past a limit, or the face
  turned out of view right after being seen, for longer than `away_s` (warning) / `away_long_s`.
  Short glances (mirrors, ~1 s) don't count.
- Restless: the average head-turn speed over the last `window_s` stays above `restless_speed`
  (constant fidgeting / looking around), which is not normal driving.

Each new episode is counted (5-minute window) and sent as `distractionCount`.

Not distraction (field question 2026-11-03: the driver gets out at a gas station or for takeout):
- the car is parked (`parked`: GPS speed under 5 km/h): nothing here alarms;
- the face *left the picture* (it reached the edge, or moved across the frame just before it was
  lost: getting out, reaching into the back) rather than turning away in the seat.

`eyes_reliable()` also tells the eye-closure tracker when EAR can't be trusted: just after the face
comes back into view (it is still turning back) and while the head is turned far to the side.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from statistics import median

from detectors.head_pose import HeadPose


@dataclass(frozen=True)
class DistractionState:
    away_for_s: float  # how long the eyes have been off the road right now (0 = on the road)
    restless: bool  # continuous unnecessary movement right now
    speed: float  # average head-turn speed over the window (deg/s)
    count: int  # distraction episodes in the last 5 minutes


class DistractionDetector:
    def __init__(
        self,
        yaw_limit_deg: float = 30.0,
        pitch_down_deg: float = 22.0,
        away_s: float = 2.0,
        away_long_s: float = 5.0,
        window_s: float = 10.0,
        restless_speed: float = 30.0,
        neutral_window_s: float = 60.0,
        lost_face_grace_s: float = 3.0,
        settle_s: float = 1.5,
        eye_yaw_limit_deg: float = 25.0,
        left_move: float = 0.2,
        left_window_s: float = 1.5,
    ) -> None:
        self.yaw_limit_deg = yaw_limit_deg
        self.pitch_down_deg = pitch_down_deg
        self.away_s = away_s
        self.away_long_s = away_long_s
        self.window_s = window_s
        self.restless_speed = restless_speed
        self.neutral_window_s = neutral_window_s
        self.lost_face_grace_s = lost_face_grace_s
        self.settle_s = settle_s
        self.eye_yaw_limit_deg = eye_yaw_limit_deg
        self._returned_at: float | None = None
        self._poses: deque[tuple[float, float, float, float]] = deque()  # (t, pitch, yaw, roll)
        self._away_since: float | None = None
        self._last_face_t: float | None = None
        self._restless_on = False
        self._episodes: deque[float] = deque()
        self._counted_away = False
        self.state = DistractionState(0.0, False, 0.0, 0)
        # Where the face was in the picture (share of width / height, at the edge?), for telling
        # "left the seat" from "turned away".
        self.left_move = left_move
        self.left_window_s = left_window_s
        self._positions: deque[tuple[float, float, float, bool]] = deque()
        self._left_seat = False
        # Set by the monitor from the GPS: True while the car is stopped (speed < 5 km/h).
        self.parked = False

    def neutral(self) -> tuple[float, float] | None:
        """(pitch, yaw) the driver usually holds, or None until ~3 s of samples."""
        if len(self._poses) < 20:
            return None
        return median(p[1] for p in self._poses), median(p[2] for p in self._poses)

    def _speed(self, t: float) -> float:
        pts = [p for p in self._poses if t - p[0] <= self.window_s]
        if len(pts) < 10 or pts[-1][0] - pts[0][0] < self.window_s * 0.7:
            return 0.0
        moved = sum(
            abs(b[1] - a[1]) + abs(b[2] - a[2]) + abs(b[3] - a[3]) * 0.5
            for a, b in zip(pts, pts[1:], strict=False)
        )
        return moved / (pts[-1][0] - pts[0][0])

    def count(self, t: float) -> int:
        while self._episodes and t - self._episodes[0] > 300:
            self._episodes.popleft()
        return len(self._episodes)

    def eyes_reliable(self, pose: HeadPose | None, t: float) -> bool:
        """Can this frame's eye openness be trusted? Call after update() for the same frame."""
        if pose is None:
            return False
        if self._returned_at is not None and t - self._returned_at < self.settle_s:
            return False  # face just came back: still turning / sitting back up
        neutral = self.neutral()
        if neutral is None:
            return True
        # Turned far aside, or head down past the "eyes off the road" limit (phone on the lap: the
        # lids look closed because the driver looks down). Distraction covers those instead.
        return (
            abs(pose.yaw - neutral[1]) <= self.eye_yaw_limit_deg
            and pose.pitch - neutral[0] >= -self.pitch_down_deg
        )

    def _left_picture(self) -> bool:
        """The face was at the edge or moved across the frame just before it was lost."""
        if not self._positions:
            return False
        if self._positions[-1][3]:
            return True
        xs = [p[1] for p in self._positions]
        ys = [p[2] for p in self._positions]
        return max(max(xs) - min(xs), max(ys) - min(ys)) >= self.left_move

    def update(
        self,
        pose: HeadPose | None,
        t: float,
        face_pos: tuple[float, float, bool] | None = None,
    ) -> DistractionState:
        """face_pos: (centre x, centre y as a share of the frame, box touching the edge)."""
        neutral = self.neutral()
        away = False
        if face_pos is not None:
            self._positions.append((t, *face_pos))
            while self._positions and t - self._positions[0][0] > self.left_window_s:
                self._positions.popleft()
        if pose is not None:
            self._left_seat = False
            if self._last_face_t is not None and t - self._last_face_t >= 1.0:
                self._returned_at = t
            self._last_face_t = t
            self._poses.append((t, pose.pitch, pose.yaw, pose.roll))
            while self._poses and t - self._poses[0][0] > self.neutral_window_s:
                self._poses.popleft()
            if neutral is not None:
                n_pitch, n_yaw = neutral
                away = (
                    abs(pose.yaw - n_yaw) > self.yaw_limit_deg
                    or (pose.pitch - n_pitch) < -self.pitch_down_deg
                )
        elif (
            self._last_face_t is not None
            and t - self._last_face_t <= self.lost_face_grace_s + self.away_long_s
        ):
            # Face just disappeared: turned right away from the camera (distraction), unless it
            # left the picture (getting out of the car), decided once when it is lost.
            if not self._left_seat and self._positions and t - self._positions[-1][0] < 0.5:
                self._left_seat = self._left_picture()
            away = t - self._last_face_t > 0.5 and not self._left_seat
        if pose is None and t - (self._last_face_t or t) > self.left_window_s:
            self._positions.clear()  # an old position must not decide the next face loss
        if self.parked:
            away = False  # stopped: looking around or getting out is not distraction

        if away:
            if self._away_since is None:
                self._away_since = t
                self._counted_away = False
            away_for = t - self._away_since
            if away_for >= self.away_s and not self._counted_away:
                self._episodes.append(t)
                self._counted_away = True
        else:
            self._away_since = None
            away_for = 0.0

        speed = self._speed(t)
        restless = speed >= self.restless_speed and not self.parked
        if restless and not self._restless_on:
            self._episodes.append(t)
        self._restless_on = restless
        self.state = DistractionState(round(away_for, 2), restless, round(speed, 1), self.count(t))
        return self.state
