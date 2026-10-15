# Night-vision test scenarios

Drivers also drive at night, with only the dashboard glow, streetlights and other cars' headlights.
This document is the test plan for the driver monitor in low light: what is tested, how, the
pass criteria, and the results measured on 2026-10-15.

## 1. What the monitor does at night

A normal camera at night sees a face as a few grey levels buried in sensor noise.

- **Brightening a single frame does not work.** In our first test, contrast enhancement (CLAHE +
  gamma) amplified the noise and made face detection *worse* than the raw frame.
- **Night mode** (`driver_monitor/detectors/low_light.py`) does what night cameras do: when the
  frame is dark (mean brightness < 40/255) it **averages the last 8 frames** (~0.27 s: the face
  barely moves, the noise is different in every frame and cancels out), smooths lightly and
  stretches the contrast. Daylight frames are passed through untouched.
- The preview window shows **NIGHT MODE** (and **(IR)** for an infrared camera) with the light level.
- Averaging 8 frames smooths a single fast blink, but microsleeps (eyes closed ≥ 0.5 s) and PERCLOS
  are unaffected.
- **Below about 1 % light no camera can see the face.** The monitor then reports "no face" and sends
  no eye readings, so it never raises false drowsiness alerts in the dark. For real night driving,
  fit infrared light (section 5).

## 2. Automated test cases (run on any PC)

`driver_monitor/tests/test_night_vision.py` runs the **real MediaPipe face models** on two real
face photos, darkened the way a cabin camera sees them. Each scenario is repeated 4 times with
different sensor noise, 8 consecutive frames each, on both faces.

```bash
cd guardian-drive/driver_monitor
venv\Scripts\python -m pytest tests/test_night_vision.py -v
```

| ID | Scenario | Simulated condition | Pass criterion | Result |
|---|---|---|---|---|
| TC-N01 | Daylight | Bright cabin | Night mode **off**, frame unchanged, face found | ✅ Pass |
| TC-N02 | Dusk | 45 % of daylight | Face found 4/4 | ✅ 4/4 |
| TC-N03 | Night, dashboard glow | 6 % light + sensor noise (σ 6) | Face found 4/4 | ✅ 4/4 |
| TC-N04 | Very dark, distant streetlight | 2 % light (σ 3) | Face found 4/4 | ✅ 4/4 |
| TC-N05 | Dark, heavy sensor noise | 8 % light, σ 16 | Face found 4/4 | ✅ 4/4 |
| TC-N06 | Oncoming headlight glare | 10 % light + bright spot beside the head | Face found 4/4 | ✅ 4/4 |
| TC-N07 | Head movement at night | 6 % light + motion blur | Face found 4/4 | ✅ 4/4 |
| TC-N08 | Infrared camera | Grey (no colour) IR picture, σ 6 | Face found 4/4 | ✅ 4/4 |
| TC-N09 | No false "eyes closed" | Eye-openness (EAR) at 6 % light vs daylight | Within ±0.06 | ✅ Pass |
| TC-N10 | Pitch black, no IR | 0.3 % light | Reports **no face**, no EAR (no false alert) | ✅ Pass |
| — | Why night mode is needed | 5 % light, σ 10 | Raw frame fails, night mode 4/4 | ✅ Pass |

### Measured improvement (6 trials per cell, before choosing the method)

| Condition | Raw frame | Brighten one frame (blur + gamma) | **Night mode (average 8 + stretch)** |
|---|---|---|---|
| 3 % light, noise σ 6 | 0/6 · 0/6 | 1/6 · 4/6 | **6/6 · 6/6** |
| 5 % light, noise σ 10 | 0/6 · 0/6 | 0/6 · 3/6 | **6/6 · 6/6** |
| 8 % light, noise σ 16 | 0/6 · 0/6 | 0/6 · 2/6 | **6/6 · 6/6** |
| 2 % light, noise σ 3 | 0/6 · 0/6 | 5/6 · 6/6 | **6/6 · 6/6** |
| 10 % light + headlight glare | 6/6 · 6/6 | 6/6 · 6/6 | **6/6 · 6/6** |
| 6 % light + motion blur | 5/6 · 4/6 | 6/6 · 6/6 | **6/6 · 6/6** |

(Face A · Face B. "Raw" is what the monitor did before night mode.)

**Limits of the simulation:** real night frames also have rolling-shutter streaks, auto-exposure
pumping and compression artefacts, and these photos are of two adults. The field tests below
confirm the result in a real car.

## 3. Field test cases (in a car, parked first)

Set up: the Pi and camera mounted on the dashboard, the preview window on (or record with
`main.py --record night.jsonl`), the parent dashboard open on a phone. Do every test **parked**
first; then with a second person driving, never the person being tested.

| ID | Scenario | Steps | Expected result | Pass |
|---|---|---|---|---|
| FT-N1 | Dusk, engine running | Sit normally for 60 s | Face box stable; NIGHT MODE appears as light drops; dashboard status *alert* | ☐ |
| FT-N2 | Night, cabin light off | Sit normally 60 s, then close eyes 3 s | Face tracked; closing eyes 3 s → in-car alarm + parent alert within 5 s | ☐ |
| FT-N3 | Night, yawning | Yawn 3 times within 2 min | Yawn count rises; *yawning* alert | ☐ |
| FT-N4 | Night, head nod | Let the head drop forward and snap back | *nodding* alert | ☐ |
| FT-N5 | Oncoming headlights | A second car flashes headlights from the front-side | No false alert; face recovered within 2 s | ☐ |
| FT-N6 | Passing streetlights | Drive (passenger as subject) past streetlights | Face not lost for more than 1 s at a time | ☐ |
| FT-N7 | Glasses at night | Repeat FT-N2 with clear glasses | Same as FT-N2 (reflections tolerated) | ☐ |
| FT-N8 | Infrared light on (if fitted) | Cabin dark, IR LEDs on, repeat FT-N2 | NIGHT MODE (IR); same as FT-N2 | ☐ |
| FT-N9 | Total darkness, no IR | Cover the dashboard lights | Preview says no face; **no** drowsiness alert; in-car monitor keeps running | ☐ |

Record for each: date/time, light level shown in the preview (`light NN/255`), alert latency,
false alerts, notes. Recordings can be replayed with `python main.py --video night.mp4 --offline`.

## 4. Pass criteria for the night feature

- Face found in ≥ 95 % of analysed frames when the preview light level is ≥ 5/255.
- Microsleep (eyes closed ≥ 2 s) detected at night within the same time as in daylight (+1 s).
- No drowsiness alert caused by darkness alone (FT-N9) or by headlights (FT-N5).

## 5. Hardware for real night driving

Software night mode handles dim cabins. For very dark roads, add infrared light, which the driver
cannot see (no glare):

| Part | Notes | Approx. cost |
|---|---|---|
| Raspberry Pi Camera Module 3 **NoIR** | No infrared filter, so it sees IR light | ₱1,800–2,200 |
| 850 nm IR LED board (e.g. 3 W, 12 V/5 V) | Aim at the driver's face from the dashboard; 850 nm glows faintly red, 940 nm is invisible but dimmer | ₱300–600 |

With IR light the picture is grey (TC-N08 / FT-N8) and night mode marks it **(IR)**. In daylight a
NoIR camera's colours look pinkish; detection still works because the monitor uses shape, not colour.
