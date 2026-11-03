"""The alert photo: eyes closed, and the sharpest such frame (not the motion-blurred one)."""

from __future__ import annotations

import cv2
import numpy as np

from transport.evidence import EvidencePicker, sharpness


def face(seed: int = 0) -> np.ndarray:
    """A detailed test image (checkerboard + noise): lots of edges, like a face in focus."""
    rng = np.random.default_rng(seed)
    img = np.kron((np.indices((12, 16)).sum(axis=0) % 2) * 200, np.ones((40, 40))).astype(np.uint8)
    img = cv2.add(img, rng.integers(0, 40, img.shape, dtype=np.uint8))
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)


def blurred(img: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(img, (21, 21), 8)  # like a head moving during the exposure


def test_sharpness_ranks_motion_blur_lower() -> None:
    img = face()
    assert sharpness(img) > 5 * sharpness(blurred(img))
    assert sharpness(img, (100, 100, 200, 200)) > sharpness(blurred(img), (100, 100, 200, 200))


def test_picks_the_sharp_closed_frame_over_the_blurred_most_closed_one() -> None:
    p = EvidencePicker()
    sharp, blur = face(1), blurred(face(2))
    p.offer(0.30, face(3))  # eyes open
    p.offer(0.11, blur)  # most closed, but blurred (mid head drop)
    p.offer(0.12, sharp)  # about as closed, and sharp
    assert p.best() is not None and np.array_equal(p.best(), sharp)


def test_never_trades_closed_eyes_for_sharpness() -> None:
    p = EvidencePicker()
    blur, open_sharp = blurred(face(1)), face(2)
    p.offer(0.10, blur)
    p.offer(0.25, open_sharp)  # sharp, but the eyes are open: not evidence of drowsiness
    assert np.array_equal(p.best(), blur)


def test_keeps_the_last_three_intervals_and_only_a_few_frames_each() -> None:
    p = EvidencePicker(keep=5, intervals=3)
    for _ in range(4):
        for i in range(20):
            p.offer(0.2 + i / 100, face(i))
        assert len(p._current) == 5
        p.next_interval()
    assert len(p._history) == 3
    p.reset()
    assert p.best() is None


def test_alert_photo_is_cropped_to_the_face_and_enlarged() -> None:
    from transport.evidence import alert_photo

    frame = face(4)  # 480 x 640
    out = alert_photo(frame, (270, 130, 100, 110))  # a small face, like the dashboard camera's
    assert out.shape[1] == 560  # enlarged for the phone
    assert abs(out.shape[0] / out.shape[1] - 0.75) < 0.02  # 4:3
    # Head and shoulders, not the whole room: the crop is about 2.8 face widths across.
    whole = alert_photo(frame)
    assert whole.shape[1] == 560 and whole.shape[0] == 420


def test_alert_photo_crop_stays_inside_the_frame_and_balances_contrast() -> None:
    from transport.evidence import alert_photo

    washed_out = np.full((480, 640, 3), 200, np.uint8)
    washed_out[150:300, 560:640] = 225  # a low-contrast face at the very edge
    out = alert_photo(washed_out, (560, 150, 80, 150))
    assert out.shape == (420, 560, 3)  # shifted inside the frame, not padded or squeezed
    gray = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    assert int(gray.max()) - int(gray.min()) > 25  # contrast stretched (was 25)
