# CLAUDE.md — CV Simulator (Python — Fake JSON Feed)

> **Read `../CLAUDE.md` first.** This file extends it. When a rule here conflicts with the root file, **this file wins for `cv-simulator/`**.
>
> **last_updated:** 2026-10-07

---

## 1. Scope
Governs `cv-simulator/`. This is a **development tool** that generates plausible fake sensor data and POSTs it to `/api/ingest`. It lets the backend, web, and mobile teams build and test without needing a camera or a real driver.

It is **not** the real monitor. The real monitor is `driver_monitor/`.

Both POST to the same endpoint with the same JSON shape.

---

## 2. Stack
- Python 3.11+
- `requests`
- `python-dotenv`
- `loguru`

No OpenCV. No camera. No ML.

---

## 3. Directory Structure
cv-simulator/
├── requirements.txt
├── .env.example
├── drowsiness_sim.py ← main script
├── scenarios/
│ ├── alert.json ← "driver is fine" profile
│ ├── drowsy.json ← "driver is drowsy" profile
│ ├── microsleep.json ← "driver is asleep" profile
│ └── mixed.json ← cycles through all states
└── utils/
└── logger.py

text

---

## 4. Environment Variables

### `cv-simulator/.env.example`
API_URL=http://localhost:3000
INGEST_API_KEY=simulator_key_change_me
DRIVER_ID=
SCENARIO=mixed
POST_INTERVAL_MS=1000
LOG_LEVEL=INFO

text

---

## 5. Behavior

- Reads `SCENARIO` from env. Loads the corresponding JSON profile.
- Every `POST_INTERVAL_MS`, generates a payload with plausible values from that profile.
- `mixed` scenario cycles: 20s alert → 10s warning → 5s drowsy → repeat.
- Logs each response: `classification`, `fusionScore`, `alertTriggered`.
- On Ctrl+C, exits cleanly.

### Example profile (`scenarios/drowsy.json`)
```json
{
  "ear":       { "mean": 0.16, "std": 0.02 },
  "perclos":   { "mean": 0.45, "std": 0.05 },
  "heartRate": { "mean": 56,   "std": 3 }
}
6. Payload (Must Match Root Contract)
python
{
  "driverId": DRIVER_ID,
  "source": "simulated",
  "signals": {
    "ear": float,
    "perclos": float,
    "heartRate": int,
    "faceConfidence": float,
    "matchedDriver": DRIVER_ID,
  },
  "timestamp": "...Z",
}
Identical shape to driver_monitor/. Only source differs.

7. Rules
Never access a camera.

Never access MongoDB.

Never compute real EAR — only sample from a distribution.

Only talks to /api/ingest.

Same env var names as driver_monitor/ for consistency.

8. Running
bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python drowsiness_sim.py
9. Anti-Patterns
❌ Don't	✅ Do
Import OpenCV	Use random sampling
Talk to MongoDB	POST to /api/ingest
Use a different payload shape	Match driver_monitor/ exactly
Send real data	Send synthetic data
last_updated: 2026-10-07

---

## 10. Implementation Decisions (2026-10-07)

- `mixed` cycles the `alert` (20 s) → `drowsy` (10 s, classifies as *warning* with default thresholds) → `microsleep` (5 s, classifies as *drowsy*) profiles.
- CLI flags `--duration N` and `--scenario NAME` override `.env` for scripted runs.
