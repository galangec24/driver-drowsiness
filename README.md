# Guardian Drive

**Real-time driver drowsiness and distraction monitoring, with live alerts for the family.**

An in-car camera (a Raspberry Pi, or any laptop with a webcam) watches the driver's eyes, mouth and
head. It recognises who is driving and judges fatigue with fuzzy logic: slow blinks, yawning, nodding
off, eyes closing more often, looking away from the road, restless movement. When a driver gets
drowsy it sounds an alarm in the car right away, even without internet. It also sends the reading to
a cloud server, which alerts the driver's parent or guardian live on the web app, the Android app and
the Windows app, with the car's location on a 3D map.

| | |
|---|---|
| **Web app** | https://guardian-drive-ph.web.app |
| **Downloads** (Android APK, Windows installer) | https://github.com/galangec24/guardian-drive-download/releases/latest |
| **API** | https://guardian-drive-api-ikun.onrender.com/api/health |

---

## Contents

1. [How it works](#how-it-works)
2. [Features](#features)
3. [Drowsiness detection in detail](#drowsiness-detection-in-detail)
4. [Architecture](#architecture)
5. [Repository layout](#repository-layout)
6. [Running it locally](#running-it-locally)
7. [Configuration](#configuration)
8. [In-car hardware (Raspberry Pi)](#in-car-hardware-raspberry-pi)
9. [Deployment and releases](#deployment-and-releases)
10. [Testing](#testing)
11. [Security and privacy](#security-and-privacy)
12. [Further documentation](#further-documentation)

---

## How it works

```
 ┌────────────── In the car ───────────────┐          ┌──────────── Cloud ────────────┐
 │                                          │          │                                │
 │  Camera ─► driver_monitor (Python)       │  HTTPS   │  backend (Node / Express)      │
 │            · face + landmarks (MediaPipe)│ ───────► │  · driver recognition          │
 │            · eyes, blinks, yawns, nods,  │  1 / s   │  · fusion + fuzzy verdict      │
 │              head pose, distraction      │          │  · false-alarm verifier (ML)   │
 │            · fuzzy-logic fatigue         │ ◄─────── │  · per-driver auto-tuning      │
 │            · in-car alarm (offline too)  │ verdict  │  · alerts, location, feedback  │
 │  GPS / Wi-Fi location                    │          │        │ MongoDB Atlas         │
 │  Optional: heart-rate radar / watch (BLE)│          └────────┼───────────────────────┘
 └──────────────────────────────────────────┘                   │ Socket.io (live) + push
                                                                ▼
                         Parent apps: web (PWA) · Android (Flutter) · Windows (Electron)
```

1. **The camera sees the driver.** About 10 times a second the monitor measures eye openness,
   blinks, mouth opening (yawns) and head angle, all relative to *this* driver's own normal face.
2. **The car reacts first.** If the eyes stay closed, the head nods, the driver looks away from the
   road too long, or several fatigue signs come together, the in-car alarm sounds at once (computer
   speaker, buzzer, or a vibrating watch). No internet is needed for this.
3. **Every second a reading goes to the server.** The server identifies the driver from their face,
   combines all signals into a verdict (*alert*, *warning* or *drowsy*), checks it against a
   false-alarm model, and stores it.
4. **The family sees it live.** The parent's dashboard updates in real time: status, signals, the
   car on the map. Real alerts arrive as notifications. The parent can mark an alert as a *false
   alarm*, and the system adjusts that driver's sensitivity on its own.
5. **No internet? Nothing is lost.** Readings are saved on the device and sent when the connection
   returns, marked as delayed.

---

## Features

### For the driver (in the car)
- **Automatic driver recognition.** No ID to type: the monitor matches the face against the
  drivers registered to the family. Passengers in view are ignored (the largest face is the driver).
- **Real-time monitoring screen.** AWAKE / WARNING / DROWSY with the reason ("Eyes closed 2.4 s",
  "fatigue: frequent blinking and repeated yawning"). It shows gauges for eye openness, PERCLOS,
  head movement and fuzzy fatigue, and live counters for blinks per minute, slow blinks, yawns,
  nods and distractions.
- **In-car alarm that works offline.** It escalates (warning → drowsy) and returns to normal
  within seconds once the driver is awake again.
- **Night mode.** Dark frames are averaged and contrast-stretched; IR cameras are supported.

### For the family (web, Android, Windows)
- **Live dashboard.** Every driver's status, signals and last update, pushed in real time.
- **Alerts.** Drowsy, microsleep, head nodding, yawning, distraction (eyes off the road / restless)
  and unknown-driver alerts, each with its confidence, sensor snapshot and location.
- **3D live map.** The car's position with buildings, distance from you, and directions.
- **Driver registration with guided photos.** Auto-capture once position and lighting are right.
  Every photo is checked to be the same person, and duplicate faces are caught (with a "they're
  twins" confirmation).
- **Feedback.** "False alarm / real" on each alert retunes that driver automatically. A feedback
  form with screenshots goes to the admins.
- **Accounts.** E-mail + 6-digit code verification, Google sign-in (also in the apps), forgot
  password, rate-limited codes.
- **Apps update themselves.** Windows auto-updates; Android and the web prompt for new versions;
  About shows the running version and build.
- **Admin console.** Parents and drivers overview, feedback inbox, ML datasets and model training.

### Under the hood
- **Per-driver, self-tuning thresholds.** Nobody edits numbers. Eye thresholds follow each driver's
  open-eye level, and alert sensitivity follows the family's false-alarm feedback, within safe
  bounds.
- **False-positive verifier.** A gradient-boosted model over the last 30 s of signals suppresses
  look-alikes (glancing at a phone, squinting into the sun, laughing).
- **Store-and-forward.** An SQLite outbox on the device holds up to 24 h of readings offline.
- **Optional vital signs.** A contactless 60 GHz radar (heart rate, breathing) or a wrist unit (heart
  rate, vibration alert) over Bluetooth LE.

---

## Drowsiness detection in detail

All signals are measured **against the driver's own baseline**, learnt continuously while driving,
so narrow or wide eyes, glasses and camera placement don't matter.

| Signal | How it is measured | Why it matters |
|---|---|---|
| **Eye openness (EAR)** | Eye-aspect ratio from 6 landmarks per eye, compared with the driver's open-eye baseline (90th percentile of the last 2 min) | The eyes closing is the core sign |
| **PERCLOS** | Share of the last 30 s with eyes closed | The standard fatigue measure |
| **Closure time** | How long the eyes have been closed right now | 2 s or more = microsleep, immediate alarm |
| **Blinks per minute** | Closures under 0.5 s, per minute actually watched | Blinking rises with fatigue |
| **Slow blinks** | Closures of 0.5–2 s in the last minute | One of the earliest signs, before PERCLOS rises |
| **Yawns** | Mouth-aspect ratio held open ≥ 1.5 s | Repeated yawning means fatigue |
| **Head nods** | Fast head drop with eyes already closed, or a jerk back up | Nodding off |
| **Eyes off the road** | Head turned or tilted down past a limit, or face out of view, for more than 2 s (warning) or 5 s (alarm) | Phone use, distraction |
| **Restless movement** | Average head-turn speed over 10 s | Continuous unnecessary movement |

**Avoiding false alarms.** Eye readings are ignored while the face is half out of the picture,
turning back into view, or turned or tilted far away, so they never count as drowsiness. Eye
closure has hysteresis and tolerates single noisy frames, which matters for narrow eyes. Looking
down at a phone is reported as *eyes off the road*, not as nodding off.

### Fuzzy-logic fatigue

Single signs are often harmless: people blink a lot while talking, and anyone can yawn once.
*Combinations* are what matter. The monitor runs a **Mamdani fuzzy inference system**
([`driver_monitor/fusion/fuzzy.py`](driver_monitor/fusion/fuzzy.py)):

- **Inputs:** PERCLOS, closure time, blink rate, slow blinks, yawns, nods. Their membership
  functions (trapezoids) scale with the driver's own server-tuned limits. Recent events weigh more
  than older ones, so a driver who is awake again recovers within about a minute.
- **Rules:** AND = min, NOT = 1 − μ, aggregation = max, centroid defuzzification. The output is
  fatigue from 0 to 1 (> 0.4 warning, > 0.7 drowsy).

| Situation | Result |
|---|---|
| Frequent blinking alone, one yawn, or one slow blink | Awake |
| Frequent blinking + a yawn · slow blinks + a yawn · many slow blinks · repeated yawning · eyes closing more often | **Warning** |
| Frequent blinking + repeated yawning · slow blinks + yawning · yawning + eyes closing more often | **Drowsy** |
| Eyes closed much of the time · eyes closed too long · repeated nods | **Drowsy** |

### Server-side fusion

The backend ([`backend/src/services/fusionEngine.js`](backend/src/services/fusionEngine.js))
combines vision (EAR, PERCLOS), vital signs (heart-rate drop and HRV rise against the driver's own
baseline, breathing), yawns and nods into a weighted score. The verdict is never lower than the
camera's fuzzy score. Candidate alerts then pass the false-positive verifier and per-type cooldowns.
Nodding, yawning and distraction alerts repeat only when a new event happens.

---

## Architecture

| Part | Technology | Hosted on |
|---|---|---|
| In-car monitor | Python 3.11+, OpenCV, MediaPipe Face Landmarker, SQLite, Bleak (BLE) | Raspberry Pi 4/5 or a Windows laptop |
| Backend API | Node.js 20, Express 4, Socket.io 4, Mongoose, Zod, face-api (TensorFlow.js) | Render |
| Database | MongoDB | MongoDB Atlas |
| Web app | React 18, TypeScript, Vite, Tailwind, TanStack Query, MapLibre GL (3D), PWA | Firebase Hosting |
| Android app | Flutter 3 (Dart), go_router, Dio | APK via GitHub Releases |
| Windows app | Electron + electron-updater (NSIS installer) | GitHub Releases |
| ML (false-positive verifier) | Python, scikit-learn / gradient-boosted trees, exported to JSON and run in JS | Trained offline or from the admin console |
| E-mail / push / media | Brevo (e-mail codes), Firebase Cloud Messaging, Cloudinary | |

**Data flow:** the device POSTs `/api/ingest` once a second with an ingest key. The backend
responds with the verdict, which the device's alarm also uses. Parents connect with JWT
(e-mail/password or Google). Live updates go out over Socket.io rooms per family.

---

## Repository layout

```
guardian-drive/
├── backend/          API: auth, drivers & face enrollment, ingest + fusion, alerts, feedback,
│                     admin, adaptive tuner, training worker            (Node, Jest)
├── web/              Parent web app / PWA, admin console                (React, Vitest, Playwright)
├── mobile_app/       Parent Android app                                 (Flutter)
├── desktop/          Windows app wrapper with auto-update               (Electron)
├── driver_monitor/   In-car camera monitor                              (Python, pytest)
│   ├── detectors/    EAR, PERCLOS, blinks, yawns, nods, head pose, distraction, night vision
│   ├── fusion/       fuzzy-logic fatigue, in-car alarm, interval aggregation
│   ├── transport/    ingest client, automatic driver recognition, offline outbox,
│   │                 GPS / Windows / Google Wi-Fi location
│   └── ui/           real-time monitoring screen
├── ml/               False-positive verifier: datasets, training, export
├── cv-simulator/     Fake sensor feed for development (scenarios)
├── wearable/         ESP32 firmware: 60 GHz radar (heart rate, breathing), wrist unit
├── docs/             Setup and test guides (see below)
├── tools/            Maintenance scripts (build-cache cleaner)
├── render.yaml       Render blueprint for the backend
└── firebase.json     Firebase Hosting for the web app
```

---

## Running it locally

**Prerequisites:** Node 20+, Python 3.11+, Git. Flutter 3 and the Android SDK are only needed to
build the APK. MongoDB is optional: the backend dev launcher starts an embedded one automatically.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env           # set JWT_SECRET and INGEST_API_KEY to long random values
npm run models:download        # face-recognition weights → backend/models/
npm run dev                    # http://localhost:3000 (embedded MongoDB)
npm run seed                   # demo parent + driver
```

Demo login after seeding: `demo@guardiandrive.app` / `guardian123`.

### 2. Web app

```bash
cd web
npm install
cp .env.example .env           # VITE_API_URL=http://localhost:3000 (public, not a secret)
npm run dev                    # http://localhost:5173
```

### 3. Driver monitor (webcam)

```bash
cd driver_monitor
python -m venv venv
venv\Scripts\activate          # Linux / Pi: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env           # API_URL, INGEST_API_KEY, FAMILY_EMAIL (see Configuration)
python main.py                 # monitoring window; press q to quit
python main.py --offline       # no server: local detection and alarm only
```

MediaPipe model files (~4 MB) download to `driver_monitor/models/` on first run.

### 4. Simulated feed (no camera)

```bash
cd cv-simulator
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python drowsiness_sim.py       # cycles alert → warning → drowsy
```

### 5. Android APK

```bash
cd mobile_app
flutter pub get
flutter test
flutter build apk --release --dart-define=API_URL=https://<your-backend>.onrender.com
```

Release signing uses `mobile_app/android/key.properties` and the keystore (both gitignored). Back
them up: without them, installed apps can't be upgraded.

---

## Configuration

### Driver monitor (`driver_monitor/.env`)

| Variable | Purpose | Default |
|---|---|---|
| `API_URL` | Backend address | `http://localhost:3000` |
| `INGEST_API_KEY` | Device key; must match the backend's `INGEST_API_KEY` | (required) |
| `FAMILY_EMAIL` | Parent account whose drivers are recognised automatically | (empty) |
| `DRIVER_ID` | Fix one driver instead of recognising them | (empty = automatic) |
| `CAMERA_INDEX`, `CAMERA_BACKEND` | Which camera to use | `0` |
| `GPS_SOURCE` | `auto` (Windows location on a laptop) · `windows` · `nmea` (USB/serial GPS) · `google` · `fixed` · `none` | `auto` |
| `GPS_PORT`, `GPS_BAUD` | Serial GPS receiver, e.g. `/dev/ttyACM0`, `9600` | |
| `GOOGLE_GEOLOCATION_KEY` | Google Geolocation API key for Wi-Fi positioning, used only while the GPS has no fix | (empty) |
| `GEOLOCATION_EVERY_S` | How often to ask Google (billed per request) | `90` |
| `WATCH_ALERTS`, `ALARM_CMD`, `LOCAL_BEEP` | In-car alarm: watch vibration, buzzer command (Pi), computer beep | on |
| `WEARABLE`, `VITALS` | Bluetooth wrist unit / radar | off |
| `EYE_STATE` | Eye-image model: `shadow` (shown only) or `on` | `shadow` |
| `MODEL_SYNC` | Use admin-promoted models and thresholds | on |

### Backend (`backend/.env` locally, Render → Environment in production)

`MONGO_URI`, `JWT_SECRET`, `INGEST_API_KEY`, `CORS_ORIGIN`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`,
`EMAIL_PROVIDER` / `BREVO_API_KEY` / `EMAIL_FROM`, `CLOUDINARY_*`, `FCM_SERVER_KEY`,
`FIREBASE_PROJECT_ID`. See [`render.yaml`](render.yaml) and [`backend/.env.example`](backend/.env.example).

---

## In-car hardware (Raspberry Pi)

| Part | Notes |
|---|---|
| Raspberry Pi 4 or 5 (4 GB+) | Runs `driver_monitor` |
| USB or Pi camera (IR recommended for night) | Facing the driver from the dashboard |
| GPS: USB dongle (u-blox 7/8) or NEO-6M / NEO-M8N on the UART | `GPS_SOURCE=nmea`. Works offline and gives speed and heading |
| Buzzer or speaker | `ALARM_CMD` |
| Optional: Seeed MR60BHA2 60 GHz radar | Contactless heart rate and breathing |
| Optional: ESP32-C3 wrist unit | Heart rate and a vibration alert |

```bash
git clone https://github.com/galangec24/driver-drowsiness.git guardian-drive
cd guardian-drive/driver_monitor
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt pyserial
cp .env.example .env && nano .env      # API_URL, INGEST_API_KEY, FAMILY_EMAIL, GPS_SOURCE=nmea …
python main.py
```

Update later with `git pull`. Wiring, flashing and test steps are in [docs/WEARABLE.md](docs/WEARABLE.md).

---

## Deployment and releases

| Part | How |
|---|---|
| **Backend** | Pushing to `main` redeploys on Render automatically (`render.yaml`). Secrets live only in Render's Environment page. `/api/health` reports the running version and commit. |
| **Web app** | `cd web && npm run build && cd .. && firebase deploy --only hosting` |
| **Windows app** | `cd desktop && npm ci && npm run dist`. Produces `GuardianDrive-Setup.exe`, `.blockmap` and `latest.yml` |
| **Android app** | `flutter build apk --release` → `GuardianDrive.apk` |
| **Release** | Raise the version in `mobile_app/pubspec.yaml` and `desktop/package.json`, then publish a release tagged `v<version>` in [guardian-drive-download](https://github.com/galangec24/guardian-drive-download) with the 4 files. The apps find it and offer the update. |

---

## Testing

| Part | Command | Covers |
|---|---|---|
| Backend | `cd backend && npm test` | Auth and codes, ingest + fusion, fuzzy and narrow-eye handling, alerts and cooldowns, distraction, adaptive tuning, feedback, admin, location. In-memory MongoDB. |
| Driver monitor | `cd driver_monitor && pytest` | Every detector, fuzzy rules, blinks, distraction, recovery, alarm levels, HUD, location sources, offline outbox, mock-camera pipeline |
| Web | `cd web && npm test` / `npm run e2e` | Components and pages (Vitest), end-to-end smoke (Playwright) |
| Android | `cd mobile_app && flutter test` | Screens, update check, models |
| ML | `cd ml && pytest` | Feature parity with the backend, training and export |

Manual test scenarios: [docs/TESTING.md](docs/TESTING.md), [docs/NIGHT_VISION_TESTS.md](docs/NIGHT_VISION_TESTS.md).

---

## Security and privacy

- **Secrets never ship in the apps.** JWT secret, ingest key, database URI, e-mail, Cloudinary,
  FCM and Google keys live only in `backend/.env` / Render, and the device keys only in
  `driver_monitor/.env`. All `.env` files and the signing keystore are gitignored. The web bundle
  and APK contain only the public backend URL.
- **Faces stay on the server.** Photos are uploaded once at registration. The backend computes face
  descriptors server-side, and the descriptors never leave it.
- **Accounts:** passwords hashed with bcrypt, e-mail verification codes hashed and rate-limited,
  Google ID tokens verified server-side, short-lived one-time hand-off codes for app sign-in.
- **Families are isolated:** every query is scoped to the signed-in parent, and live updates go only
  to that family's room.

---

## Further documentation

| Document | Topic |
|---|---|
| [docs/OFFLINE_MODE.md](docs/OFFLINE_MODE.md) | Store-and-forward when the car has no internet |
| [docs/NIGHT_VISION_TESTS.md](docs/NIGHT_VISION_TESTS.md) | Night / IR test scenarios |
| [docs/WEARABLE.md](docs/WEARABLE.md) | Radar and wrist unit: parts, wiring, firmware |
| [docs/GOOGLE_SIGNIN.md](docs/GOOGLE_SIGNIN.md) | Google sign-in setup |
| [docs/EMAIL.md](docs/EMAIL.md) | E-mail verification codes (Brevo) |
| [docs/ADMIN.md](docs/ADMIN.md) | Admin console and the training worker |
| [docs/TESTING.md](docs/TESTING.md) | Test plan |
| [ml/README.md](ml/README.md) | False-positive verifier |
| [desktop/README.md](desktop/README.md) | Windows app and auto-update |

---

© 2026 Emmanuel Christian. Guardian Drive capstone project.
