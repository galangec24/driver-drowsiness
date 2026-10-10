# Admin console: training the models

Guardian Drive has an **admin side** in the web app (**Admin** in the menu, admins only). There you
collect training data, download public datasets, run training, compare the result with the live model,
and **promote** it so every driver and in-car device uses it. Rollback is one click.

```mermaid
flowchart LR
  subgraph Data["1 · Data"]
    FB[Parent "False alarm" taps<br/>(saved with the 30 s signal window)]
    REC[Recorded drives<br/>driver_monitor --record → upload]
    PUB[Public datasets<br/>Kaggle one-click · video sets manual]
    SYN[Synthetic drives<br/>generated]
  end
  subgraph Worker["2 · Training worker (Python)"]
    J[Background jobs<br/>one at a time · live log]
  end
  subgraph Review["3 · Review"]
    C[Candidate model<br/>+ test report]
  end
  subgraph Live["4 · Promote"]
    A[Active model in MongoDB]
    BE[Backend verifier<br/>(reloads ≤ 1 min)]
    PI[In-car Pi<br/>(pulls ≤ 5 min)]
  end
  FB & REC & PUB & SYN --> J --> C -->|Promote| A --> BE & PI
```

## 1. Become an admin

Pick one:

- **`ADMIN_EMAILS=you@example.com`** in `backend/.env` (or the Render dashboard). That account becomes an
  admin at its next sign-in.
- **`npm run make-admin -- you@example.com`** in `backend/` (the account must exist; `--remove` to revoke).

Sign out and in again. **Admin** appears in the menu. The role is checked in the database on every
request, so revoking it takes effect immediately.

## 2. Where training runs

Training runs Python (`ml/` and `driver_monitor/` venvs), so it needs a machine with those environments:
your PC is fine. The backend finds them automatically (`ml/venv`, `driver_monitor/venv`); otherwise
set `ML_PYTHON` / `MONITOR_PYTHON` in `backend/.env`.

| Setup | How |
|---|---|
| **Everything on your PC** (testing) | Just works: `npm run dev`, open Admin. |
| **Public app on Render + Atlas** | Render has no Python, so its Admin page reviews and promotes but can't train. Run a second backend on your PC with the **same `MONGO_URI` (Atlas)**, train there, then promote from either one. Models live in MongoDB, so the Render backend switches to a newly promoted verifier within a minute, and Pis pull new device settings within 5 minutes. |

Downloaded datasets stay on the training machine (`ml/data/`, gitignored). Only trained models (small
JSON) go into the database.

## 3. Data sources

| Source | Trains | How to add |
|---|---|---|
| **Parent feedback** | False-alarm verifier | Automatic: every **False alarm** / **Report false alarm** tap. Included in each verifier run (weight 5×). |
| **Your recorded drives** | False-alarm verifier | `python main.py --offline --record drive.jsonl` (hotkeys 1 drowsy / 0 alert / 9 ignore / t m p s confounders) → Datasets → **Upload .jsonl** → **Import uploads** |
| **Synthetic drives** | False-alarm verifier | Generated automatically on the first run (≈140 h, 160 virtual drivers + look-alikes) |
| **Kaggle: Yawn & Eye Dataset** (176 MB) | Eye model | Already downloaded (the current eye model) |
| **Kaggle: Drowsiness Dataset** (176 MB) | Eye model | Datasets → **Download** |
| **Kaggle: MRL Eye** (23 MB, infrared) | Eye model | Datasets → **Download**. Adds night/IR camera eyes. |
| **Kaggle: Yawn & Eye, yawn faces** | Yawn threshold | Datasets → **Calibrate yawn detector** |
| **UTA-RLDD** (60 people, ~30 h video) | False-alarm verifier | Request access at the dataset site → put videos in `ml/data/videos/uta-rldd/<participant>/<0\|5\|10>.mov` → **Process videos** |
| **NTHU-DDD**, **YawDD** (video) | False-alarm verifier | Request access → sort into `drowsy/` and `alert/` sub-folders under `ml/data/videos/<id>/` → **Process videos** |
| Kaggle: Yawn Dataset (mouth crops), DDD (2.7 GB frames) | — | Listed for reference; not usable automatically (see the card text) |

"Process videos" runs the real driver monitor over every video offline (the same EAR / PERCLOS pipeline
as in the car), labels each recording from the dataset's folder/file names, and imports the result as
`recordings_<id>`. Tick it under **Training → False-alarm verifier** to include it.

Check each dataset's licence before using it beyond research.

## 4. Training jobs

| Job | Python | Output |
|---|---|---|
| Download dataset | ml | `ml/data/eyes_<id>` |
| **Train false-alarm verifier** | ml | candidate `fp_verifier` + report (false alerts/h, drowsy episodes caught, latency, harder population) |
| **Train eye model** | ml | candidate `eye_state` + report (accuracy, webcam-quality accuracy) |
| **Calibrate yawn detector** | driver_monitor (MediaPipe) | candidate `yawn_threshold` + report |
| Process videos | driver_monitor, then ml | `ml/data/recordings_<id>` |
| Import uploads | ml | `ml/data/recordings_uploads` |

Jobs run one at a time in a queue. The log streams live (Training tab, click a job), and a job can be
cancelled. A job interrupted by a server restart is marked failed; start it again.

**Every model is tested on data it never trained on:** verifier test drivers are held out by driver,
eye test images are the dataset's published test split. So the numbers in the Models tab are fair
comparisons.

## 5. Review and promote

Models tab, per kind: the live model (or "bundled with the code") and every candidate with its headline
numbers. **Report** shows the full evaluation. **Promote** makes a candidate live:

| Kind | Effect of promotion |
|---|---|
| False-alarm verifier | Backend switches immediately; other backends on the same database within 1 minute |
| Eye model | In-car monitors download it within 5 minutes (`models/eye_state.promoted.json`), offline-safe |
| Yawn threshold | In-car monitors apply it within 5 minutes |

**Roll back:** promote an older (retired) entry, or **Revert to bundled**. A device can opt out with
`MODEL_SYNC=0` in `driver_monitor/.env`.

What to look for before promoting:
- **Verifier:** false alerts/hour should drop **while drowsy episodes caught stays ~100 %**. A model
  that stops false alarms by missing real drowsiness is worse, not better. Check the "harder population"
  column too.
- **Eye model:** webcam-quality accuracy matters more than clean-photo accuracy.
- **Yawn threshold:** see below.

## 6. Results from the first real runs (this repository, 2026-10-10)

| Job | Data | Result |
|---|---|---|
| Download MRL Eye | 2,000 open + 2,000 closed IR eye crops | 91 s |
| Yawn calibration | 400 yawning + 400 non-yawning **full-face** photos, faces found 392/400 | Current threshold **0.50 catches 77 %** of yawn photos. Recommended **0.30**: **95.7 % caught, 0 % false** (balanced accuracy 97.8 %). Best on photos alone would be 0.22, but the floor of 0.30 protects against talking (MAR ≈ 0.4; the photos contain no talking). |
| Eye model | Yawn & Eye + MRL infrared eyes (5,452 images) | Webcam-quality accuracy **92.7 %** (bundled model 91.3 %); clean-photo accuracy 94.0 % (bundled 94.5 %) |
| Verifier | Synthetic (no parent feedback yet) | 0.11 false alerts/h vs 3.48 fusion-only, 100 % drowsy episodes caught; harder population 0.22/h, 90.6 %. Same as the bundled model, as expected until real feedback/recordings are added. |
| Yawn calibration (rejected) | Kaggle "Yawn Dataset": 65×71 px **mouth crops** | Only 18/800 faces detectable. The job now refuses datasets like this instead of producing a meaningless threshold. |

## 7. API (for reference)

All under `/api/admin`, JWT + admin role:
`GET overview` · `GET datasets` · `POST recordings {name, content}` · `GET/POST jobs` ·
`GET jobs/:id` (with log) · `POST jobs/:id/cancel` · `GET models` · `GET models/:id` (report, metrics) ·
`POST models/:id/promote` · `POST models/reset/:kind`.
Socket.io (admins' room): `training:job`, `training:log`.
In-car devices (ingest API key): `GET /api/ingest/drivers/:id/thresholds` → `device {yawnMar, eyeStateVersion}`,
`GET /api/ingest/models/eye-state`.
