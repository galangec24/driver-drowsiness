# CLAUDE.md — Driver Monitor (Python — Real Facial Drowsiness Detection)

> **Read `../CLAUDE.md` first.** This file extends it. When a rule here conflicts with the root file, **this file wins for `driver_monitor/`**.
>
> **last_updated:** 2026-10-07

---

## 1. Scope
Governs `driver_monitor/`. This is the **real** driver monitoring script — the one that runs on the driver's device (laptop now, Raspberry Pi later) and does actual facial drowsiness detection.

It is **not** the simulator. The simulator (`cv-simulator/`) generates fake data. This generates real data.

Both POST to the same endpoint: `POST /api/ingest`.

---

## 2. Stack
- Python 3.11+
- `opencv-python` — camera capture
- `mediapipe` — face landmarks (preferred) OR `face_recognition` + `dlib`
- `numpy` — math
- `requests` — HTTP
- `python-dotenv` — env loading
- `loguru` — logging
- `black` + `ruff` for formatting and linting

---

## 3. Directory Structure
driver_monitor/
├── requirements.txt
├── .env.example
├── main.py ← entry point: camera loop
├── config.py ← reads env, exposes constants
├── detectors/
│ ├── init.py
│ ├── face_detector.py ← locate face in frame
│ ├── landmarks.py ← extract eye/mouth landmarks
│ ├── ear.py ← Eye Aspect Ratio
│ ├── perclos.py ← rolling PERCLOS over window
│ └── head_pose.py ← pitch/yaw/roll estimation
├── fusion/
│ └── scorer.py ← local pre-fusion (optional)
├── transport/
│ └── ingest_client.py ← POST to /api/ingest
├── utils/
│ ├── logger.py
│ └── env.py
└── tests/
├── test_ear.py
├── test_perclos.py
└── test_head_pose.py

text

---

## 4. Environment Variables

### `driver_monitor/.env.example`
API_URL=http://localhost:3000
INGEST_API_KEY=simulator_key_change_me
DRIVER_ID=
CAMERA_INDEX=0
POST_INTERVAL_MS=1000
LOG_LEVEL=INFO

text

**No other secrets in this folder.** The API key is scoped to `/api/ingest` only.

---

## 5. Detection Pipeline
Camera frame (OpenCV)
↓
Face detection (MediaPipe FaceMesh)
↓
Landmarks → eyes (6 pts each), mouth
↓
EAR per eye → average EAR
↓
PERCLOS over rolling 30s window
↓
Head pose (solvePnP) → pitch/yaw/roll
↓
Heart rate (optional, rPPG — skip in MVP)
↓
Build payload → POST /api/ingest

text

**POST cadence:** every `POST_INTERVAL_MS` (default 1000ms). Do **not** POST per frame — that floods the backend.

---

## 6. Payload (Must Match Root Contract)

```python
payload = {
    "driverId": DRIVER_ID,
    "source": "driver_monitor",
    "signals": {
        "ear": round(ear, 3),
        "perclos": round(perclos, 3),
        "heartRate": hr or 0,
        "faceConfidence": round(face_conf, 3),
        "matchedDriver": DRIVER_ID,     # MVP: assume match
    },
    "timestamp": datetime.utcnow().isoformat() + "Z",
}
requests.post(f"{API_URL}/api/ingest", json=payload,
              headers={"x-api-key": INGEST_API_KEY})
Never rename keys. Never add required fields.

7. Rules
No credentials in this folder beyond the ingest API key.

No database access from here — only HTTP to the backend.

No face recognition here — only detection (find face, compute EAR). Recognition/matching happens on the backend.

Never POST embeddings — only signals.

Never write to Firebase — the backend does that.

Camera resolution: 640x480 is enough. Higher wastes CPU.

Frame processing: skip frames — analyze every 3rd frame, not every frame.

Graceful shutdown on Ctrl+C: release camera, close socket.

8. Testing
Unit tests for ear.py, perclos.py, head_pose.py using synthetic landmark data

Integration test: mock camera, verify a payload is built correctly

pytest — all tests must pass

No test hits the real backend

9. Running
bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # fill in DRIVER_ID and INGEST_API_KEY
python main.py
Output: a live window showing the frame with EAR/PERCLOS overlays, and a log line per POST.

10. Anti-Patterns
❌ Don't	✅ Do
POST every frame	POST every POST_INTERVAL_MS
Compute embeddings here	Let the backend do it
Read from MongoDB	POST to /api/ingest
Hardcode thresholds	Send raw signals; backend applies per-driver thresholds
Store API keys in code	Read from .env
Use GPU-only models	Keep it CPU-friendly for Pi
last_updated: 2026-10-07

---

## 11. Implementation Decisions (2026-10-07)

- **MediaPipe Tasks API:** `FaceDetector` (BlazeFace short-range) for location + `faceConfidence`; `FaceLandmarker` (478 points) for eyes and head-pose points. Model files download to `driver_monitor/models/` on first run (~4 MB).
- **PERCLOS without a hardcoded EAR cutoff:** a sample counts as "closed" when EAR < `PERCLOS_CLOSURE_RATIO` (default 0.7) × the driver's own open-eye baseline (90th percentile of the last 120 s of EAR). The backend still applies per-driver thresholds to the raw values.
- **Per-interval aggregation:** each POST carries the mean EAR of the analysed frames in that interval and the current 30 s PERCLOS. If no face was seen, `ear`/`perclos` are omitted and `faceConfidence` is 0.
- **Head pose** is computed (solvePnP) and drawn on the overlay but **not sent** — adding it to the payload changes the ingest contract and needs approval first.
- POSTs run on a single background worker so the camera loop never blocks; an interval is skipped if the previous POST is still in flight.
- Extra env (optional): `PERCLOS_CLOSURE_RATIO`, `SHOW_WINDOW=0` (headless). CLI: `--duration N`, `--no-window`.
- **Data collection modes:** `--record FILE.jsonl` (per-interval rows; hotkeys 1/0/9/t/m/p/s set the
  label), `--video FILE` (offline processing at the file's frame rate), `--offline` (no POST, no
  INGEST_API_KEY/DRIVER_ID needed), `--label drowsy|alert|ignore`. Feeds `ml/scripts/import_recordings.py`.
- **Eye-state image model** (`detectors/eye_state.py`, weights `models/eye_state.json` trained in
  `ml/scripts/train_eye_state.py` from a Kaggle eye dataset): `EYE_STATE=shadow` (default — shown on the
  overlay, PERCLOS still uses the EAR rule), `on` (model decides closed frames), `off`. Shadow by
  default because it is not yet reliable on ~30 px webcam eye crops. `--save-eyes DIR` collects crops
  for retraining. Payload unchanged.
- **Head pose** uses `SOLVEPNP_SQPNP`; the default ITERATIVE solver returned mirrored solutions behind
  the camera on real faces (~±135° roll).
