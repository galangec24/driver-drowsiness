"""Reads .env and exposes constants. Only the ingest API key is a credential here."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from utils.env import ROOT, env_float, env_int, env_str, load_env

MODEL_DIR = ROOT / "models"
FACE_DETECTOR_MODEL = MODEL_DIR / "blaze_face_short_range.tflite"
FACE_LANDMARKER_MODEL = MODEL_DIR / "face_landmarker.task"
# Open/closed eye classifier trained in ml/ (scripts/train_eye_state.py); committed, not downloaded.
EYE_STATE_MODEL = MODEL_DIR / "eye_state.json"

MODEL_URLS = {
    FACE_DETECTOR_MODEL: "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
    FACE_LANDMARKER_MODEL: "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/latest/face_landmarker.task",
}

FRAME_WIDTH = 640  # 640x480 is enough; higher wastes CPU
FRAME_HEIGHT = 480
ANALYZE_EVERY_N_FRAMES = 3  # analyse every 3rd frame, not every frame
PERCLOS_WINDOW_S = 30.0


@dataclass(frozen=True)
class Config:
    api_url: str
    api_key: str
    driver_id: str
    camera_index: int
    post_interval_ms: int
    log_level: str
    # PERCLOS "closed" = EAR below this fraction of the driver's own open-eye baseline.
    # Relative to each driver, so no absolute EAR threshold is hardcoded here.
    perclos_closure_ratio: float
    show_window: bool
    # Eye-state image model: "shadow" (default) = computed + shown, PERCLOS keeps the EAR rule;
    # "on" = the model decides closed frames for PERCLOS; "off" = not loaded.
    eye_state: str
    # Vehicle location (transport/gps.py): none | fixed | nmea
    gps_source: str = "none"
    gps_fixed: str = ""
    gps_port: str = ""
    gps_baud: int = 9600
    # Upload the camera frame when the backend reports a new alert (parents see who/what).
    send_snapshots: bool = True
    # opencv (USB webcam / laptop camera) | picamera2 (Raspberry Pi camera module on the ribbon cable)
    camera_backend: str = "opencv"
    # Bluetooth LE wearable (docs/WEARABLE.md): off | ble
    wearable: str = "off"
    wearable_name: str = ""
    wearable_address: str = ""
    # Dashboard radar (contactless heart rate + breathing, wearable/guardian_radar): off | ble
    vitals: str = "off"
    vitals_name: str = ""
    vitals_address: str = ""
    # Which heart-rate source wins when both report: radar | watch
    hr_priority: str = "radar"
    # Command run on a HIGH in-car alert, e.g. a sound through the car's Bluetooth stereo:
    # "paplay /home/pi/alarm.wav" (empty = no sound). Works with or without the watch.
    alarm_cmd: str = ""
    # Vibrate the watch when the driver is drowsy (in-car alert, works offline too)
    watch_alerts: bool = True
    # Yawn detector: mouth aspect ratio that counts as wide open, and how long it must stay open
    yawn_mar: float = 0.5
    yawn_min_s: float = 1.5
    # Head nod: forward drop below the driver's neutral pitch (degrees) and minimum fall speed (deg/s)
    nod_deg: float = 15.0
    nod_speed: float = 25.0
    # Apply models/settings the admin promoted in the training console (yawn threshold, eye model)
    model_sync: bool = True


def load_config(require_backend: bool = True) -> Config:
    load_env()
    cfg = Config(
        api_url=env_str("API_URL", "http://localhost:3000").rstrip("/"),
        api_key=env_str("INGEST_API_KEY"),
        driver_id=env_str("DRIVER_ID"),
        camera_index=env_int("CAMERA_INDEX", 0),
        post_interval_ms=env_int("POST_INTERVAL_MS", 1000),
        log_level=env_str("LOG_LEVEL", "INFO"),
        perclos_closure_ratio=env_float("PERCLOS_CLOSURE_RATIO", 0.7),
        show_window=env_str("SHOW_WINDOW", "1") != "0",
        eye_state=env_str("EYE_STATE", "shadow").lower(),
        gps_source=env_str("GPS_SOURCE", "none").lower(),
        gps_fixed=env_str("GPS_FIXED"),
        gps_port=env_str("GPS_PORT"),
        gps_baud=env_int("GPS_BAUD", 9600),
        send_snapshots=env_str("SEND_SNAPSHOTS", "1") != "0",
        camera_backend=env_str("CAMERA_BACKEND", "opencv").lower(),
        wearable=env_str("WEARABLE", "off").lower(),
        wearable_name=env_str("WEARABLE_NAME", "GuardianWatch"),
        wearable_address=env_str("WEARABLE_ADDRESS"),
        watch_alerts=env_str("WATCH_ALERTS", "1") != "0",
        vitals=env_str("VITALS", "off").lower(),
        vitals_name=env_str("VITALS_NAME", "GuardianRadar"),
        vitals_address=env_str("VITALS_ADDRESS"),
        hr_priority=env_str("HR_PRIORITY", "radar").lower(),
        alarm_cmd=env_str("ALARM_CMD"),
        yawn_mar=env_float("YAWN_MAR", 0.5),
        yawn_min_s=env_float("YAWN_MIN_S", 1.5),
        nod_deg=env_float("NOD_DEG", 15.0),
        nod_speed=env_float("NOD_SPEED", 25.0),
        model_sync=env_str("MODEL_SYNC", "1") != "0",
    )
    missing = [k for k, v in (("INGEST_API_KEY", cfg.api_key), ("DRIVER_ID", cfg.driver_id)) if not v]
    if missing and require_backend:
        raise SystemExit(f"Missing required env vars: {', '.join(missing)} (see .env.example)")
    return cfg


def ensure_models() -> None:
    """Download the MediaPipe model files on first run (CPU-friendly, ~4 MB total)."""
    import urllib.request

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for path, url in MODEL_URLS.items():
        if not Path(path).exists():
            urllib.request.urlretrieve(url, path)  # noqa: S310 - fixed https URLs
