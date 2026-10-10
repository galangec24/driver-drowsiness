"""Keep the in-car monitor in step with what the admin promoted in the training console.

Every 5 minutes (with the personal thresholds) the backend reports
  device.yawnMar          calibrated yawn mouth-opening threshold (null = keep YAWN_MAR from .env)
  device.eyeStateVersion  id of the promoted eye open/closed model (null = keep the bundled model)
A new eye model is downloaded once and saved as models/eye_state.promoted.json (the bundled
models/eye_state.json is never overwritten); it is preferred at startup, so it survives restarts and
works offline. Set MODEL_SYNC=0 to ignore admin promotions on this device.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import config

EYE_MODEL_FILE = config.MODEL_DIR / "eye_state.promoted.json"
EYE_VERSION_FILE = config.MODEL_DIR / "eye_state.version"


def eye_model_path() -> Path:
    """Promoted model when one was downloaded, else the bundled one."""
    return EYE_MODEL_FILE if EYE_MODEL_FILE.exists() and EYE_VERSION_FILE.exists() else config.EYE_STATE_MODEL


def local_eye_version(version_file: Path = EYE_VERSION_FILE) -> str | None:
    try:
        return version_file.read_text(encoding="utf8").strip() or None
    except OSError:
        return None


def fetch_device_config(client: Any, driver_id: str, current_eye_version: str | None) -> dict[str, Any]:
    """Runs on the background pool: thresholds + device settings (+ a new eye model if promoted)."""
    body = client.get_thresholds(driver_id)
    device = body.get("device") or {}
    eye = None
    wanted = device.get("eyeStateVersion")
    if wanted and wanted != current_eye_version:
        eye = client.get_eye_model()
    return {"thresholds": body.get("personalThresholds") or {}, "device": device, "eye": eye}


def save_eye_model(
    eye: dict[str, Any], model_file: Path = EYE_MODEL_FILE, version_file: Path = EYE_VERSION_FILE
) -> None:
    """Write atomically: a half-written model must never be loaded after a power cut."""
    tmp = model_file.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(eye["model"]), encoding="utf8")
    tmp.replace(model_file)
    version_file.write_text(eye["version"], encoding="utf8")
