# Eye open/closed model: results on real in-car video (DMD)

*Guardian Drive · 3 November 2026 · updated with 6 people (was 4)*

## Summary

With six people, training on real in-car video from the Driver Monitoring Dataset (DMD) gives a
model that is **better on average**: 92.6 % against 90.4 % for the live model. It is more accurate
for four of the six people, and for five of them it raises fewer false "eyes closed" readings.

It is **not yet safe to promote**. For one person (gB_7) it misses **31 %** of closed eyes, against
**15.5 %** for the live model. Missing a closed eye is the costly mistake: a sleepy driver gets no
warning. The rule set in the previous report was to promote only a model that catches at least as
many closed eyes as the live one for every group, and this model fails it for gB_7.

**Recommendation: keep the live model for now.** The next step is to fix the gB_7 weakness
(section 7). Promotion stays a one-click decision in the admin console's Models tab.

## 1. Why this test

The eye model decides, frame by frame, whether the driver's eyes are open or closed. That feeds
PERCLOS (the share of time the eyes are closed), the main drowsiness signal. The model was trained on
close-up eye photos, and earlier checks showed it does worse on webcam-quality faces. The question is
whether training on real in-car camera frames closes that gap.

## 2. Data

DMD (Vicomtech) records drivers in a real car with a face camera. Every frame is labelled eyes
*open*, *closed*, *opening* or *closing*. Seven drowsiness sessions from six people were used:

| Person | Glasses | Sessions | Eye crops | Open | Closed |
|---|---|---|---|---|---|
| gA_1 | yes | 1 | 1,144 | 594 | 550 |
| gA_5 | no | 1 | 1,030 | 600 | 430 |
| gB_6 | no | 1 | 724 | 600 | 124 |
| gB_7 | no | 1 | 1,126 | 598 | 528 |
| gB_9 | no | 1 | 600 | 300 | 300 |
| gB_10 | no | 2 | 1,200 | 600 | 600 |
| **Total** | | **7** | **5,824** | **3,292** | **2,532** |

A face was found in 2,750 of 2,752 frames.

How the eye crops were made:
- Only clearly open or clearly closed frames were used. Half-open frames and the 2 frames on each
  side of a label change were left out.
- Every 2nd labelled frame was used, at most 300 per class per session (150 for the admin console's
  test people, gB_9 and gB_10), because neighbouring frames are nearly identical.
- Frames were downscaled to webcam size (640 px wide), then the eyes were cropped with the in-car
  monitor's own landmark code, so the crops match what the model sees in the car.

The frames are a fresh random sample, so gB_6 and gB_7 do not have exactly the same frames as in
the 4-person report. gB_7 now has more frames because it is no longer a capped test person.

## 3. How the models were compared

Each person was held out in turn (leave-one-person-out):
1. Train a new model on the original eye photos, the MRL infrared eyes and the **other five** DMD
   people.
2. Test both the new model and the live model on the held-out person's frames. Both see exactly
   the same images.

This was done six times, once per person. The live model never trained on any DMD frame.

## 4. Results

### Accuracy on the held-out person

| Held-out person | New model | Live model | Difference |
|---|---|---|---|
| gA_1 | **95.4 %** | 93.4 % | +2.0 |
| gA_5 | **97.7 %** | 90.8 % | +6.9 |
| gB_6 | 86.2 % | **89.2 %** | −3.0 |
| gB_7 | 79.9 % | **81.9 %** | −2.0 |
| gB_9 | **99.0 %** | 94.7 % | +4.3 |
| gB_10 | **97.5 %** | 92.4 % | +5.1 |
| **Average of the six** | **92.6 %** | 90.4 % | +2.2 |
| **All 5,824 crops pooled** | **92.5 %** | 90.1 % | +2.4 |

ROC-AUC, which does not depend on the decision threshold, averaged **0.969 for the new model and 0.964
for the live model**.

### What kind of mistakes

| Held-out person | Closed eyes caught, new | Closed eyes caught, live | Open eyes called closed, new | Open eyes called closed, live |
|---|---|---|---|---|
| gA_1 | 97.5 % | 97.6 % | **6.6 %** | 10.6 % |
| gA_5 | **97.2 %** | 95.6 % | **2.0 %** | 12.7 % |
| gB_6 | **91.9 %** | 87.1 % | 15.0 % | **10.3 %** |
| gB_7 | 68.9 % | **84.5 %** | **10.4 %** | 20.4 % |
| gB_9 | **98.7 %** | 91.3 % | **0.7 %** | 2.0 % |
| gB_10 | **98.5 %** | 89.8 % | **3.5 %** | 5.0 % |

- **Closed eyes caught:** the new model is better for four people, equal for gA_1, and much worse
  for gB_7.
- **False "closed" readings** (false alarms): the new model has fewer for five of the six.
- **gB_7** is the one hard case: the new model calls about a third of this person's closed eyes
  open. The live model also does worst on gB_7, so this person's eyes are hard for both models.

### Compared with the 4-person report

With four people the two models tied on average (88.9 % each). Adding gB_9 and gB_10 shows that the
group-B weakness was not the whole group: the new model is clearly better on both new people. So
more varied in-car data does help, but gB_7 has to be understood before promotion.

## 5. The admin console's candidate

The admin console tests on whole people it never trained on: with six people it holds out gB_9 and
gB_10. The candidate trained that way (`reports/candidate_eye_dmd/`) scored:

| Test set | Images | Candidate | Live model |
|---|---|---|---|
| DMD gB_9 + gB_10 (in-car) | 1,800 | **98.2 %** (AUC 0.991) | 93.2 % (AUC 0.977) |
| Original eye photos (test split) | 218 | 94.0 % (AUC 0.980) | **94.5 %** (AUC 0.992) |

This single split is useful for comparing models with each other in the Models tab, but it happens to
test two people the new model does well on. The leave-one-person-out results above are the fairer
picture.

## 6. What changed in the software

- **Processing:** natural ordering of people (gB_10 after gB_9) when choosing test people, and UTF-8
  progress output so the script works when its output is redirected.
- **Admin console** (unchanged from before): DMD card with **Process**, DMD under *Train eye model*,
  and the **In-car (DMD)** column in the Models tab.

## 7. Limitations and next steps

- **Six people** is still a small sample, and all but one come from DMD groups A and B. One person
  moves the average by about 1.5 points.
- **gB_7.** Next: look at this person's misclassified crops (lighting, eye shape, head angle) and
  check whether a different decision threshold, chosen **on the training people only**, recovers
  closed-eye recall without bringing back the false alarms. Choosing it on gB_7 itself would
  overstate the result.
- **More people from other groups** (gC, gD, gE) would show whether gB_7 is a one-off.
- Accuracy is per frame. The car alerts on PERCLOS over 30 seconds, which smooths out isolated
  mistakes, so frame accuracy is a proxy for alert quality.
- Only daytime RGB video was used; night-time infrared video was not tested.

## Reproducing

```
cd ml
../driver_monitor/venv/Scripts/python scripts/process_dmd.py data/videos/dmd --out data/eyes_dmd
venv/Scripts/python scripts/train_eye_state.py --data data/eyes_v1 --extra data/eyes_mrl-eyes \
    --extra data/eyes_dmd --out-dir reports/candidate_eye_dmd
```

Per-person results: `reports/dmd_lopo.json`.
