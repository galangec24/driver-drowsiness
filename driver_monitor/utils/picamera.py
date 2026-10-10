"""Raspberry Pi camera module (CSI ribbon cable) as a cv2.VideoCapture-like source.

Bookworm and later drive CSI cameras through libcamera, which OpenCV's V4L2 backend cannot open.
picamera2 comes from apt (python3-picamera2), so the Pi venv is created with
--system-site-packages (see deploy/raspberry-pi/install.sh). USB webcams don't need this.
"""

from __future__ import annotations

import numpy as np


class PiCamera:
    def __init__(self, width: int, height: int, camera_num: int = 0) -> None:
        try:
            from picamera2 import Picamera2
        except ImportError as exc:
            raise SystemExit(
                "CAMERA_BACKEND=picamera2 needs picamera2: sudo apt install -y python3-picamera2 "
                "(and a venv created with --system-site-packages)"
            ) from exc
        self._cam = Picamera2(camera_num)
        # "RGB888" in libcamera is BGR byte order in memory, i.e. exactly what OpenCV expects.
        cfg = self._cam.create_video_configuration(main={"size": (width, height), "format": "RGB888"})
        self._cam.configure(cfg)
        self._cam.start()
        self._open = True

    def isOpened(self) -> bool:  # noqa: N802 - mirrors cv2.VideoCapture
        return self._open

    def read(self) -> tuple[bool, np.ndarray | None]:
        try:
            return True, self._cam.capture_array()
        except Exception:  # noqa: BLE001 - a camera hiccup must not kill the monitor
            return False, None

    def get(self, _prop: int) -> float:
        return 0.0

    def release(self) -> None:
        if self._open:
            self._cam.stop()
            self._cam.close()
            self._open = False
