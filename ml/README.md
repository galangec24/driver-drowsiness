# ml/ — false-positive reduction

Guardian Drive's fusion engine flags a tick as `warning`/`drowsy` from a single second of signals.
That is fast, but it fires on things that *look* like drowsiness for a moment: glancing down at a
phone, squinting into the sun, laughing, rubbing your eyes, a narrow-eyed driver still on default
thresholds, an athlete with a resting heart rate below 60.

This folder builds the **false-positive verifier**: a small gradient-boosted-tree model that looks
at the last 30 seconds of a driver's signals and decides whether a candidate alert is real. The
backend runs it in plain JavaScript (`backend/src/services/fpVerifier.js`) from the exported
`backend/src/ml/fp-verifier.json`; no Python runs in production.

```
fusion (1 tick) ──► candidate alert ──► verifier (30-tick window) ──► cooldown ──► alert:new
                                          p < threshold → suppressed (SensorLog keeps verifierScore)
```

The ingest contract is unchanged; a suppressed alert simply returns `alertTriggered: false`.

> **Admin console:** everything below can also be done from the web app (**Admin** menu): download
> public datasets, train, compare and promote models. See [docs/ADMIN.md](../docs/ADMIN.md).

## Quick start

```bash
cd ml
python -m venv venv && venv\Scripts\activate
pip install -r requirements-dev.txt

python scripts/make_dataset.py --drivers 160 --out data/synthetic_v1           # ~2 min
python scripts/make_dataset.py --drivers 60 --seed 99 --stress --out data/synthetic_shift
python scripts/train.py --data data/synthetic_v1 --shift-test data/synthetic_shift   # ~1 min
pytest
```

`train.py` writes:

| Output | Purpose |
|---|---|
| `../backend/src/ml/fp-verifier.json` | the model the backend loads at start-up |
| `../backend/tests/fixtures/fp-parity.json` | Python↔JS parity cases (backend `npm test` checks them) |
| `reports/fp_verifier_report.md`, `reports/metrics.json` | evaluation report |

Restart the backend after retraining. `FP_VERIFIER=off` in `backend/.env` disables the verifier;
`FP_VERIFIER_THRESHOLD=0.9` overrides the trained threshold (lower = fewer missed episodes, more
false alarms).

## The dataset (`data/synthetic_v1`)

**Synthetic, by necessity.** No labelled drowsiness data exists for this project yet, and the public
datasets (UTA-RLDD, NTHU-DDD) are 100+ GB of video. The generator (`guardian_ml/synth.py`) is
therefore a *model* of the signals, built from well-documented drowsiness markers:

- Eyelid openness is simulated at 10 Hz (the driver monitor analyses every 3rd frame of 30 fps) and
  aggregated to 1 Hz exactly as `driver_monitor` does: mean EAR, 30 s relative-baseline PERCLOS,
  mean face confidence, heart rate (0 when the driver has no sensor).
- **Drowsiness** ramps over 4–10 min: drooping lids, slower and longer blinks, long closures, then
  microsleeps (1.5–6 s) at the peak, with heart rate drifting down. How strongly it shows varies per
  driver (`expressivity`), and 30 % of drowsy drivers talk or sing to stay awake.
- **Confounders** (labelled *not drowsy*): `talking`, `laughing`, `mirror_check`, `phone_glance`
  (looking down makes lids appear nearly shut), `sun_squint`, `glare`, `occlusion`, `heavy_blinker`
  (dry eyes / contacts), `eye_rub_sneeze` (real 1–2 s closures).
- **Driver variety**: open-eye EAR 0.20–0.38; 40 % still on the default 0.21 EAR threshold; 12 %
  athletes (resting HR 44–58); 25 % glasses (noisier landmarks); 70 % with an HR sensor.
- **Labels per tick**: `1` drowsy (level ≥ 0.5 or microsleep), `0` not drowsy, `-1` early onset
  (ignored, so neither a hit nor a false alarm).

Default build: 160 drivers × 2 sessions × 25 min ≈ 140 h, 505 k ticks (4 MB gzipped CSV).
`--stress` builds a deliberately different population (subtler drowsiness, 2× glasses, 1.5× noise,
more confounders) used only as a robustness test.

Columns of `ticks.csv.gz`: `driver_id, session_id, t, ear, perclos, heartRate, faceConfidence,
label, state, level`. `drivers.json` holds each driver's profile and personal thresholds.

## The model

- **Features** (`guardian_ml/features.py`, ported line-for-line to `backend/src/services/fpFeatures.js`):
  22 window statistics — EAR relative to the driver's own threshold (last/mean/min/std/slope/
  volatility), time below threshold, PERCLOS level and trend, heart-rate level and trend, face
  confidence, fusion-score history. Everything is relative to personal thresholds, so the model
  transfers across drivers.
- **Classifier**: scikit-learn `GradientBoostingClassifier` (250 trees, depth 3), trained only on
  *candidate* ticks (the ones that would have raised an alert), split **by driver** 70/15/15.
- **Threshold**: chosen on validation drivers with event-level metrics — the fewest false alerts
  per hour while keeping ≥ 97 % of the baseline's drowsy-episode recall; ties go to the lower
  threshold because a missed episode costs more than a false alarm.
- **Parity**: the exporter's reference predictor equals `predict_proba` exactly (float32 split
  comparisons, like sklearn); the backend test suite replays 150 fixture windows through the JS.

### Current results (synthetic test drivers — see `reports/fp_verifier_report.md`)

| | False alerts / h | Episodes detected | Median latency |
|---|---|---|---|
| Current backend (fusion only) | 3.48 | 100 % | 114 s |
| With verifier | 0.11 | 100 % | 114 s |
| *Shifted population*: fusion only | 14.5 | 92.2 % | 126 s |
| *Shifted population*: with verifier | 0.22 | 90.6 % | 154 s |

**Read these honestly.** On data that follows the generator's own rules the verifier is close to
perfect — that only proves the pipeline works and that these confounders are separable with window
features. The shifted population shows the real trade-off: far fewer false alarms, slightly lower
recall and later detection. **Real-world accuracy is unknown until you evaluate on real recordings.**

Also evaluated and *not* shipped: a persistence gate using each driver's `drowsyDurationMs` on
1 Hz classifications. It cuts some false alerts but costs recall and ~45 s of latency, because early
drowsiness flickers between bands.

## Image model: open/closed eyes (Kaggle)

The verifier above works on *signals*. The second model looks at the eye *image*: a small
open/closed classifier the driver monitor can use to decide which frames count as "closed" for
PERCLOS. Looking down, squinting and glasses lower EAR while the eye is still visibly open — exactly
the false positives this targets. The ingest payload does not change.

```bash
pip install kagglehub opencv-python-headless           # once (in this venv)
python scripts/fetch_eye_data.py                        # Kaggle serenaraju/yawn-eye-dataset-new → data/eyes_v1 (5 MB)
python scripts/train_eye_state.py                       # → driver_monitor/models/eye_state.json + reports/eye_state_report.md
```

- **Data:** 726 open + 726 closed close-up eye photos (public; no Kaggle login needed).
  `--per-class 400` takes fewer. The raw 160 MB download is deleted after compaction. Check the
  dataset licence on Kaggle before redistributing anything derived from it (the data is gitignored).
- **Model:** 32x32 equalised gray → HOG (324 features, plain numpy in
  `driver_monitor/detectors/eye_state.py`, shared by training and runtime) → MLP (64 hidden units),
  chosen over logistic regression on validation. Training images are augmented to look like webcam
  eyes (12–28 px, blur, noise, rotation, lighting, mirroring). Runtime is numpy only.
- **Results** (`reports/eye_state_report.md`): **94.5 %** accuracy / ROC-AUC 0.99 on the published
  test split; **91.3 %** when test eyes are degraded to 16 px.
- **Honest limitation:** on a real 640x480 webcam frame the eye is only ~30–40 px and the model's
  output still moves a lot with crop framing and blur. That's why the driver monitor runs it in
  **shadow mode** by default (`EYE_STATE=shadow`: probability shown on the overlay, PERCLOS keeps the
  EAR rule). Switch to `EYE_STATE=on` only after training on your own eyes:

  ```bash
  cd driver_monitor
  python main.py --offline --save-eyes data/my_eyes/unsorted     # keep eyes open, then closed, for ~1 min each
  # sort the PNGs into data/my_eyes/Open and data/my_eyes/Closed (delete blurry/mis-cropped ones)
  cd ../ml
  python scripts/fetch_eye_data.py --local ../driver_monitor/data/my_eyes --out data/eyes_own
  python scripts/train_eye_state.py --extra data/eyes_own
  ```

  A few hundred of your own crops per class usually closes most of the gap; re-check the overlay
  probability with eyes open, closed, and looking down before turning it on.

## Getting real data (do this before relying on the model)

1. **Parent feedback (automatic).** Every alert card on the web and APK has **False alarm** /
   **Report false alarm**. Labels are stored on the alert together with the 30-tick window the
   verifier saw. Export and retrain:

   ```bash
   cd backend && npm run export:feedback            # → ml/data/feedback/alerts.jsonl
   cd ../ml && python scripts/train.py --data data/synthetic_v1 --feedback data/feedback/alerts.jsonl
   ```

   Feedback examples are weighted 5× synthetic ones.

2. **Recorded sessions (with consent).** Record labelled sessions from the webcam pipeline:

   ```bash
   cd driver_monitor
   python main.py --offline --record ../ml/data/raw/alex_day1.jsonl
   #   hotkeys in the preview window: 1 drowsy · 0 alert · 9 ignore · t talking · m mirror · p phone · s squint
   ```

3. **Public video datasets.** Run the same pipeline over videos, e.g. UTA-RLDD
   (labels 0 = alert, 10 = drowsy; skip 5 = low vigilance or label it `ignore`):

   ```bash
   python main.py --offline --no-window --video rldd/07/10.mov --label drowsy --record ../ml/data/raw/rldd07_10.jsonl
   ```

4. **Import and retrain** (real drivers are split train/val/test like synthetic ones, so the report
   then measures real performance):

   ```bash
   python scripts/import_recordings.py data/raw/*.jsonl --out data/recordings_v1
   python scripts/train.py --data data/synthetic_v1 --extra data/recordings_v1 --shift-test data/synthetic_shift
   ```

## Layout

```
ml/
├── guardian_ml/
│   ├── synth.py      dataset generator (drivers, sessions, confounders, labels)
│   ├── features.py   canonical window features  (mirrored in backend/src/services/fpFeatures.js)
│   ├── fusion.py     exact port of backend fusionEngine.js
│   ├── policy.py     replica of the backend alert path + event-level metrics
│   ├── export.py     sklearn GBT → portable JSON + reference predictor
│   └── data.py       dataset loading
├── scripts/          make_dataset.py · train.py · import_recordings.py
├── tests/            pytest
├── data/             generated / imported datasets
└── reports/          evaluation report + metrics.json
```
