# CV Simulator

Fake sensor feed for Guardian Drive. Samples plausible EAR / PERCLOS / heart-rate values from a
scenario profile and POSTs them to `POST /api/ingest` — the exact payload shape `driver_monitor/`
sends, with `"source": "simulated"`. No camera, no ML, no database access.

## Setup

```bash
python -m venv venv
venv\Scripts\activate          # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env`:

| Variable           | Value                                                              |
|--------------------|--------------------------------------------------------------------|
| `API_URL`          | Backend base URL, e.g. `http://localhost:3000`                     |
| `INGEST_API_KEY`   | Same value as `INGEST_API_KEY` in `backend/.env`                   |
| `DRIVER_ID`        | A driver's id (`npm run seed` in `backend/` prints one)            |
| `SCENARIO`         | `alert`, `drowsy`, `microsleep` or `mixed` (default)               |
| `POST_INTERVAL_MS` | Milliseconds between POSTs (default `1000`)                        |

## Run

```bash
python drowsiness_sim.py                        # runs until Ctrl+C
python drowsiness_sim.py --duration 30          # stop after 30 s
python drowsiness_sim.py --scenario microsleep  # override SCENARIO
```

Each response is logged:

```
21:04:26 | INFO | [ drowsy] ear=0.063 perclos=0.693 hr= 49 -> classification=drowsy  fusionScore=0.785 alertTriggered=True
```

## Scenarios

| File               | Profile                                         | Typical classification* |
|--------------------|-------------------------------------------------|-------------------------|
| `alert.json`       | eyes open, PERCLOS ~8 %, HR ~74                 | alert                   |
| `drowsy.json`      | EAR ~0.16, PERCLOS ~45 %, HR ~56                | warning                 |
| `microsleep.json`  | EAR ~0.06, PERCLOS ~75 %, HR ~50                | drowsy                  |
| `mixed.json`       | 20 s alert → 10 s drowsy → 5 s microsleep, loop | all three               |

\* With default per-driver thresholds. The backend classifies using each driver's own thresholds,
so the same feed can classify differently for different drivers.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
ruff check . && black --check .
```
