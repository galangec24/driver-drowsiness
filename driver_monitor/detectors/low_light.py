"""Night mode: make a dark, noisy cabin frame readable for the face detectors.

At night a normal camera sees a few grey levels of face buried in sensor noise. Brightening a single
frame (CLAHE, gamma) amplifies that noise and made detection WORSE in our tests. What works is what
night cameras do: average the last few frames (the driver's face barely moves in ~0.25 s, the noise
is different in every frame, so it cancels), smooth lightly, then stretch the contrast.

Measured on simulated night frames (tests/test_night_vision.py, docs/NIGHT_VISION_TESTS.md):
2-10 % of daylight brightness with sensor noise: face found 0/6 raw -> 6/6 with night mode.
Only dark frames are processed; daylight frames pass through untouched. Below ~1 % light no camera
works without infrared light (NoIR camera + 850 nm IR LEDs, see the docs).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import cv2
import numpy as np

# Mean brightness (0-255) below which a frame counts as "night".
NIGHT_LUMA = 40.0
# Frames averaged at night (8 frames = ~0.27 s at 30 fps: blinks are smoothed, microsleeps are not).
AVERAGE_FRAMES = 8


@dataclass(frozen=True)
class Lighting:
    luma: float  # mean brightness of the camera frame
    night: bool  # night processing applied
    infrared: bool  # colourless frame (NoIR camera with IR light, or a grey image)


def frame_lighting(bgr: np.ndarray) -> Lighting:
    small = cv2.resize(bgr, (64, 48), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    luma = float(gray.mean())
    # Infrared frames have (almost) no colour: channels nearly equal everywhere.
    spread = float(np.abs(small.astype(np.int16) - gray[..., None].astype(np.int16)).mean())
    return Lighting(luma=luma, night=luma < NIGHT_LUMA, infrared=spread < 4.0)


def stretch_contrast(img: np.ndarray) -> np.ndarray:
    """Map the 1st-99.5th percentile of brightness to the full 0-255 range."""
    lo, hi = np.percentile(img, 1.0), np.percentile(img, 99.5)
    return np.clip((img.astype(np.float32) - lo) * (255.0 / max(hi - lo, 1.0)), 0, 255).astype(np.uint8)


class NightVision:
    """Feed every camera frame to `push`; `frame()` returns what the detectors should look at."""

    def __init__(self, average_frames: int = AVERAGE_FRAMES, night_luma: float = NIGHT_LUMA) -> None:
        self.average_frames = average_frames
        self.night_luma = night_luma
        self._frames: deque[np.ndarray] = deque(maxlen=average_frames)
        self._sum: np.ndarray | None = None
        self.lighting = Lighting(luma=255.0, night=False, infrared=False)

    def push(self, bgr: np.ndarray) -> Lighting:
        light = frame_lighting(bgr)
        self.lighting = Lighting(light.luma, light.luma < self.night_luma, light.infrared)
        if not self.lighting.night:
            self._frames.clear()
            self._sum = None
            return self.lighting
        f = bgr.astype(np.float32)
        if self._sum is None or self._sum.shape != f.shape:
            self._frames.clear()
            self._sum = np.zeros_like(f)
        if len(self._frames) == self._frames.maxlen:
            self._sum -= self._frames[0]
        self._frames.append(f)
        self._sum += f
        return self.lighting

    def frame(self, bgr: np.ndarray) -> np.ndarray:
        """`bgr` unchanged in daylight; at night the denoised, contrast-stretched average."""
        if not self.lighting.night or self._sum is None or not self._frames:
            return bgr
        mean = self._sum / len(self._frames)
        return stretch_contrast(cv2.GaussianBlur(mean, (0, 0), 1.0))


def enhance_low_light(frames: list[np.ndarray]) -> tuple[np.ndarray, Lighting]:
    """One-shot helper: night-process a short burst of frames (oldest first)."""
    nv = NightVision(average_frames=len(frames))
    for f in frames:
        nv.push(f)
    return nv.frame(frames[-1]), nv.lighting
