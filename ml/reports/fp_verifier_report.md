# False-positive verifier — evaluation report

Dataset `data/synthetic_v1` · drivers train/val/test =
112/24/24
(split **by driver**, so test drivers were never seen in training) · alert threshold **0.96**
(chosen on validation drivers: fewest false alerts while keeping >= 97 % of the baseline's
episode recall; ties go to the lowest threshold, since a missed drowsy episode costs more than a
false alarm).

## Held-out test drivers

| Policy | False alerts / hour | False alerts | Drowsy episodes detected | Median detection latency (s) |
|---|---|---|---|---|
| baseline (current backend) | 3.477 | 63 | 100.0% | 114.0 |
| persistence gate (drowsyDurationMs, 1-tick tolerance) | 2.152 | 39 | 100.0% | 157.0 |
| learned verifier | 0.11 | 2 | 100.0% | 114.0 |

**False alerts reduced by 97 %** versus the current backend.

False alerts by what the driver was actually doing:

| Policy | Breakdown |
|---|---|
| baseline (current backend) | phone_glance: 40, sun_squint: 17, laughing: 2, eye_rub_sneeze: 1, mirror_check: 1, drowsy: 1, alert: 1 |
| persistence gate (drowsyDurationMs, 1-tick tolerance) | phone_glance: 23, sun_squint: 16 |
| learned verifier | laughing: 1, alert: 1 |

## Robustness: shifted population (`data/synthetic_shift`, never used for training)

Subtler drowsiness, twice as many glasses wearers, 1.5x sensor noise, more confounders.

| Policy | False alerts / hour | Drowsy episodes detected | Median detection latency (s) |
|---|---|---|---|
| baseline (current backend) | 14.544 | 92.2% | 126.0 |
| learned verifier | 0.22 | 90.6% | 154.0 |

## Tick-level discrimination (candidate ticks, test drivers)

| Model | ROC-AUC | PR-AUC |
|---|---|---|
| Gradient-boosted trees (deployed) | 0.9968 | 0.999 |
| Logistic regression (reference) | 0.9964 | 0.9987 |

## Most important features

| Feature | Importance |
|---|---|
| ear_rel_mad | 0.8545 |
| face_conf_min | 0.0598 |
| ear_rel_mean | 0.0446 |
| ear_rel_last | 0.0127 |
| ear_rel_min | 0.0078 |
| ear_rel_slope | 0.0052 |
| ear_rel_std | 0.0031 |
| fusion_mean | 0.0024 |
| perclos_rel_last | 0.002 |
| face_conf_mean | 0.0019 |
| hr_mean | 0.0019 |
| perclos_rel_slope | 0.0014 |

## Caveats

- The data is **synthetic**: it models known drowsiness markers and common false-alarm situations,
  but its numbers are not real-world accuracy. Re-run this report on real recordings
  (`scripts/import_recordings.py`) and parent feedback (`npm run export:feedback` in `backend/`).
- The persistence gate is reported for comparison only. Applying `drowsyDurationMs` to 1 Hz
  classifications costs recall and latency because early drowsiness flickers between bands; it is
  not enabled in the backend.
- Python↔JS parity: max |Δp| = 0.00e+00 on held-out samples.
