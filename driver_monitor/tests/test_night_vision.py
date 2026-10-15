"""Night-vision test scenarios (docs/NIGHT_VISION_TESTS.md, TC-N01 ... TC-N10).

Real MediaPipe models on real face photos, darkened the way a cabin camera sees them at night:
low light, sensor noise, headlight glare, motion blur, an infrared (NoIR) picture and total darkness.
Each scenario is repeated with different noise; `night mode` must find the face in (almost) every
trial and keep the eye-openness reading close to daylight, or stay silent when nothing is visible.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

import config
from detectors.ear import average_ear
from detectors.low_light import NIGHT_LUMA, NightVision, frame_lighting

FIXTURES = Path(__file__).parent / "fixtures"
FACES = ["face_a.jpg", "face_b.jpg"]
TRIALS = 4
FRAMES = 8  # consecutive camera frames per trial (~0.27 s at 30 fps)

pytestmark = pytest.mark.skipif(
    not (config.FACE_DETECTOR_MODEL.exists() and config.FACE_LANDMARKER_MODEL.exists()),
    reason="MediaPipe models not downloaded (run main.py once)",
)


@pytest.fixture(scope="module")
def models():
    from detectors.face_detector import FaceDetector
    from detectors.landmarks import LandmarkExtractor

    det = FaceDetector(config.FACE_DETECTOR_MODEL)
    lm = LandmarkExtractor(config.FACE_LANDMARKER_MODEL)
    yield det, lm
    det.close()
    lm.close()


def simulate(img: np.ndarray, seed: int, light: float, noise: float, glare=False, blur=0.0, ir=False):
    """One camera frame: `light` = fraction of daylight brightness, `noise` = sensor noise (sigma)."""
    rng = np.random.default_rng(seed)
    f = img.astype(np.float32)
    if ir:  # NoIR camera + 850 nm LEDs: no colour, the face lit from the front, darker background
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        f = np.repeat(g[..., None], 3, axis=2)
    f *= light
    if glare:  # oncoming headlights over the driver's shoulder
        h, w = img.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        spot = np.exp(-(((xx - w * 0.85) ** 2 + (yy - h * 0.3) ** 2) / (2 * (w * 0.12) ** 2)))
        f += 255 * spot[..., None]
    if blur:
        f = cv2.GaussianBlur(f, (0, 0), blur)
    noise_shape = f.shape[:2] if ir else f.shape
    n = rng.normal(0, noise, noise_shape)
    f += n[..., None] if ir else n
    return np.clip(np.round(f), 0, 255).astype(np.uint8)


def analyse(models, frames: list[np.ndarray], night_mode: bool):
    """(face found with landmarks, EAR, lighting) for the last frame of a burst."""
    det, lm = models
    nv = NightVision()
    for f in frames:
        nv.push(f)
    src = nv.frame(frames[-1]) if night_mode else frames[-1]
    rgb = cv2.cvtColor(src, cv2.COLOR_BGR2RGB)
    face = det.detect(rgb)
    pts = lm.extract(rgb) if face is not None else None
    return bool(pts), (average_ear(pts) if pts else None), nv.lighting


def detection_rate(models, img, night_mode: bool, **scenario) -> int:
    hits = 0
    for trial in range(TRIALS):
        frames = [simulate(img, seed=trial * 100 + k, **scenario) for k in range(FRAMES)]
        hits += analyse(models, frames, night_mode)[0]
    return hits


# id, description, scenario, minimum hits (out of TRIALS) required with night mode
SCENARIOS = [
    ("TC-N02", "dusk, 45% light", dict(light=0.45, noise=2), TRIALS),
    ("TC-N03", "night, dashboard glow 6%, sensor noise", dict(light=0.06, noise=6), TRIALS),
    ("TC-N04", "very dark streetlight 2%", dict(light=0.02, noise=3), TRIALS),
    ("TC-N05", "dark with heavy sensor noise", dict(light=0.08, noise=16), TRIALS),
    ("TC-N06", "headlight glare at night", dict(light=0.10, noise=6, glare=True), TRIALS),
    ("TC-N07", "night + head motion blur", dict(light=0.06, noise=6, blur=2.0), TRIALS),
    ("TC-N08", "infrared camera (NoIR + 850 nm LEDs)", dict(light=0.35, noise=6, ir=True), TRIALS),
]


@pytest.mark.parametrize("face", FACES)
def test_tc_n01_daylight_is_untouched(models, face):
    img = cv2.imread(str(FIXTURES / face))
    frame = cv2.convertScaleAbs(img, alpha=1.6, beta=20)  # a bright cabin
    nv = NightVision()
    nv.push(frame)
    assert not nv.lighting.night
    assert nv.frame(frame) is frame  # daylight frames are not modified
    assert analyse(models, [frame], night_mode=True)[0]


@pytest.mark.parametrize("face", FACES)
@pytest.mark.parametrize("tc,desc,scenario,required", SCENARIOS, ids=[s[0] for s in SCENARIOS])
def test_night_scenarios(models, face, tc, desc, scenario, required):
    img = cv2.imread(str(FIXTURES / face))
    with_night = detection_rate(models, img, night_mode=True, **scenario)
    assert with_night >= required, f"{tc} {desc}: face found {with_night}/{TRIALS} with night mode"


@pytest.mark.parametrize("face", FACES)
def test_night_mode_beats_the_raw_frame_in_noisy_darkness(models, face):
    """The reason night mode exists: raw frames fail where the averaged frames succeed."""
    img = cv2.imread(str(FIXTURES / face))
    scenario = dict(light=0.05, noise=10)
    raw = detection_rate(models, img, night_mode=False, **scenario)
    night = detection_rate(models, img, night_mode=True, **scenario)
    assert night == TRIALS and raw < night


def test_tc_n09_eye_openness_is_preserved_at_night(models):
    """Night processing must not make open eyes look closed (no false drowsiness at night)."""
    img = cv2.imread(str(FIXTURES / "face_a.jpg"))
    _, day_ear, _ = analyse(models, [img], night_mode=False)
    frames = [simulate(img, seed=k, light=0.06, noise=6) for k in range(FRAMES)]
    found, night_ear, light = analyse(models, frames, night_mode=True)
    assert light.night and found
    assert night_ear == pytest.approx(day_ear, abs=0.06)


def test_tc_n10_pitch_black_reports_no_face_instead_of_guessing(models):
    """Without any light (no IR) the monitor must say 'no face', never invent eye readings."""
    img = cv2.imread(str(FIXTURES / "face_a.jpg"))
    frames = [simulate(img, seed=k, light=0.003, noise=3) for k in range(FRAMES)]
    found, ear, light = analyse(models, frames, night_mode=True)
    assert light.night and light.luma < 5
    assert not found and ear is None


def test_lighting_classification():
    dark = np.full((48, 64, 3), 10, np.uint8)
    assert frame_lighting(dark).night and frame_lighting(dark).infrared
    bright = np.full((48, 64, 3), 150, np.uint8)
    bright[..., 2] = 220  # colourful
    light = frame_lighting(bright)
    assert not light.night and not light.infrared
    assert NIGHT_LUMA < 60
