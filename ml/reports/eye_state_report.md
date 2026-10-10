# Eye-state classifier (open / closed)

Dataset: Kaggle `serenaraju/yawn-eye-dataset-new` — 726 open + 726 closed eye photos
(1234 train / 218 test as published;
0 test images have a near-duplicate in train).
Training images get 4 augmented copies each
(webcam-like low resolution, blur, noise, rotation, lighting, mirroring).

Features: 32x32 histogram-equalised gray → OpenCV HOG (324 values), computed by
`driver_monitor/detectors/eye_state.py` for both training and runtime.

## Model selection (validation = 15 % of the published train split)

| Model | Params | Val accuracy | Val accuracy, webcam quality (16 px) |
|---|---|---|---|
| logreg | C=0.05 | 0.9301 | 0.9247 |
| logreg | C=0.3 | 0.9194 | 0.9247 |
| logreg | C=1.0 | 0.9301 | 0.9247 |
| mlp | hidden=64 alpha=0.001 | 0.9462 | 0.9516 |
| mlp | hidden=64 alpha=0.01 | 0.9462 | 0.9516 |

Selected: **mlp (hidden=64 alpha=0.001)**.

## Held-out test set

| Metric | Value |
|---|---|
| Accuracy | 94.5% |
| ROC-AUC | 0.9918 |
| Confusion [open, closed] (rows = truth) | [[106, 3], [9, 100]] |
| Accuracy at webcam quality (eye downscaled to 16 px) | 91.3% |
| ROC-AUC at webcam quality | 0.9753 |

Runtime/sklearn parity: max |Δp| = 2.5e-07.

## How it is used

`driver_monitor` crops each eye from the FaceMesh landmarks every analysed frame. A frame counts as
*closed* for PERCLOS when the model's mean closed-probability for both eyes is ≥ 0.5; EAR is still
measured and sent unchanged. Looking down, squinting and glasses lower EAR but usually leave the eye
visibly open, so PERCLOS stops counting those frames — fewer false drowsiness signals before the
backend's fusion engine and verifier even see them. `EYE_STATE=off` restores the EAR-only rule.

## Caveats

- Close-up photos, not dashboard-webcam frames: the webcam-quality rows estimate the resolution gap,
  not angle, infrared or motion blur. Record your own eyes with `driver_monitor --save-eyes` and add
  them (see ml/README.md) to close the gap.
- ~1,450 images from a scraped dataset; subjects are unknown, so test images may share people with
  training images. Treat the test accuracy as optimistic.
