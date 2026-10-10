# CLAUDE.md — Guardian Drive (root)

## 0. Mission Summary

Guardian Drive is a multimodal driver safety system that detects driver drowsiness by fusing computer-vision signals (EAR, PERCLOS, head pose) with physiological signals (heart rate), using **per-driver adaptive thresholds**, and pushes **real-time alerts to a parent/guardian** — on the web (React PWA) and on Android (Flutter APK). There is no hardware yet: all sensor input arrives as **JSON over HTTP** at `POST /api/ingest`, and the system is designed so that when real cameras and sensors arrive, **only the input source changes — nothing else**. The parent has two access points (React PWA on web, Flutter APK on mobile); the driver has a Flutter APK and a Python monitoring script. The backend is Node.js + Express + Socket.io + MongoDB. **All credentials, model weights, and secrets live in the backend.** The frontend never talks to Firebase or MongoDB directly — only to our backend. When in doubt, ask the human — do not guess at architecture.

---

## 1. Non-Negotiable Constraints

1. **All credentials live in the backend.** API keys, Firebase config, Cloudinary keys, JWT secrets, MongoDB URIs, face model weights — none of these ship to the client.
2. **`POST /api/ingest` is the frozen contract.** Field names do not change. Real hardware later POSTs the same shape.
3. **MongoDB is the only data store.** Firebase is allowed only for FCM push and Firebase Hosting.
4. **Frontend calls only our backend.** No direct Firebase SDK for data. No direct MongoDB. No client-side model inference for face recognition.
5. **`mobile_app/` is APK-only.** Flutter Web, Linux, macOS, and Windows targets are deleted. React is the only web UI.
6. **Web is a first-class access point, not a mirror.** Same features, same data, same flows as the APK — but built in React + Tailwind.
7. **All thresholds are per-driver and adaptive.** Never hardcode `EAR < 0.21` in application logic.
8. **End-to-end alert latency < 500 ms** (ingest → fusion → Socket.io → parent UI).
9. **Alerts sync across all parent devices.** First acknowledge wins; other sessions update immediately.
10. **The web app is a PWA.** It must be installable, work offline for cached data, and support Web Push where the browser allows it.

---

## 2. Repository Layout
guardian-drive/
├── CLAUDE.md ← this file (root rules)
├── README.md
├── docker-compose.yml ← MongoDB
├── .gitignore
├── backend/ ← Node.js + Express + Socket.io + MongoDB
│ └── CLAUDE.md
├── web/ ← React + Vite + Tailwind + PWA (3D design)
│ └── CLAUDE.md
├── mobile_app/ ← Flutter — APK only
│ └── CLAUDE.md
├── driver_monitor/ ← Python — real facial drowsiness detection
│ └── CLAUDE.md
└── cv-simulator/ ← Python — fake JSON feed for testing
└── CLAUDE.md

text

---

## 3. System Architecture
┌────────────────────────────────────────────────────────────────┐
│ INPUT SOURCES (JSON over HTTP) │
│ │
│ driver_monitor/ (Python, real) ──┐ │
│ cv-simulator/ (Python, fake) ──┼──► POST /api/ingest │
│ mobile_app/ (Flutter driver) ─┘ │
└───────────────────────────────┬────────────────────────────────┘
▼
┌────────────────────────────────────────────────────────────────┐
│ BACKEND (Node.js + Express + Socket.io) │
│ • Auth (JWT) │
│ • Driver registry + face enrollment/matching │
│ • Adaptive fusion engine │
│ • Alert dispatcher (Socket.io + FCM) │
│ • ALL CREDENTIALS LIVE HERE │
└──────────┬────────────────────────────────────┬────────────────┘
▼ ▼
┌──────────┐ ┌──────────────────────┐
│ MongoDB │ │ Socket.io channel │
└──────────┘ └──────────┬───────────┘
│
┌───────────────────────────┴───────────────┐
▼ ▼
┌───────────────────────┐ ┌───────────────────────┐
│ web/ (React PWA) │ │ mobile_app/ (Flutter)│
│ Parent — browser │ │ Parent — APK │
│ 3D design, Tailwind │ │ Feature-identical │
└───────────────────────┘ └───────────────────────┘

text

---

## 4. Data Models (MongoDB / Mongoose)

### 4.1 User (Parent)
```js
{
  _id: ObjectId,
  name: String,
  email: { type: String, unique: true, lowercase: true },
  passwordHash: String,
  role: { type: String, default: 'parent' },
  fcmToken: String,
  createdAt: Date
}
4.2 Driver
js
{
  _id: ObjectId,
  parentId: ObjectId,              // ref User
  name: String,
  relationship: String,            // "son", "daughter", "spouse", ...
  faceEmbedding: [Number],         // 128-d vector (never sent to client)
  referencePhotoUrl: String,       // Cloudinary URL
  personalThresholds: {
    earThreshold:        { type: Number, default: 0.21 },
    perclosThreshold:    { type: Number, default: 0.40 },
    drowsyDurationMs:    { type: Number, default: 2000 },
    fusionWeightVision:  { type: Number, default: 0.6 },
    fusionWeightPhysio:  { type: Number, default: 0.4 }
  },
  createdAt: Date
}
4.3 Alert
js
{
  _id: ObjectId,
  driverId: ObjectId,
  parentId: ObjectId,
  type: 'drowsy' | 'microsleep' | 'distraction' | 'face_match' | 'warning',
  confidence: Number,              // 0..1
  sensorSnapshot: {
    ear: Number,
    perclos: Number,
    heartRate: Number,
    timestamp: Date
  },
  acknowledged: { type: Boolean, default: false },
  acknowledgedAt: Date,
  acknowledgedBy: String,          // 'apk' | 'web' | 'unknown'
  createdAt: Date
}
4.4 SensorLog (feeds adaptive tuning)
js
{
  _id: ObjectId,
  driverId: ObjectId,
  signals: { ear, perclos, heartRate, faceConfidence },
  classification: 'alert' | 'warning' | 'drowsy',
  fusionScore: Number,
  source: 'simulated' | 'driver_monitor' | 'mobile_app' | 'hardware',
  createdAt: Date
}
Required indexes:

Alert: { driverId: 1, createdAt: -1 }, { parentId: 1, acknowledged: 1 }

SensorLog: { driverId: 1, createdAt: -1 }

Driver: { parentId: 1 }

5. API Contract (FROZEN — Do Not Break)
Base URL: http://localhost:3000/api

Method	Endpoint	Auth	Purpose
POST	/auth/register	—	Register parent
POST	/auth/login	—	Login → JWT
GET	/drivers	JWT	List parent's drivers
POST	/drivers	JWT	Register driver (name + base64 photo)
GET	/drivers/:id	JWT	Driver details + thresholds
PATCH	/drivers/:id/thresholds	JWT	Update personal thresholds
POST	/ingest	API key	Sensor JSON in
GET	/alerts	JWT	List alerts (filters: driverId, from, to)
PATCH	/alerts/:id/ack	JWT	Acknowledge alert
WS	/socket.io	JWT (handshake)	Live alert push
5.1 /api/ingest Request — THE CONTRACT
json
{
  "driverId": "665f...",
  "source": "driver_monitor",
  "signals": {
    "ear": 0.17,
    "perclos": 0.48,
    "heartRate": 56,
    "faceConfidence": 0.94,
    "matchedDriver": "665f..."
  },
  "timestamp": "2026-10-07T10:23:00Z"
}
source enum: "simulated" | "driver_monitor" | "mobile_app" | "hardware"

5.2 /api/ingest Response
json
{
  "classification": "drowsy",
  "fusionScore": 0.91,
  "alertTriggered": true,
  "alertId": "6660..."
}
Rules: Always return fusionScore. Never rename, remove, or reorder fields. New fields must be optional and additive.

5.3 Socket.io Events
Event	Direction	Payload
alert:new	server → parent	Full alert object
alert:acknowledged	server → parent	{ alertId, acknowledgedBy }
driver:status	server → parent	{ driverId, status, lastUpdate }
subscribe:driver	parent → server	{ driverId }
Parents join room parent:<parentId> on connect.

6. Cross-Cutting Rules
6.1 Credentials — The Hard Rule
Every secret lives in backend/.env. The frontend never sees:

API keys

Firebase config (except the public web config for FCM — and even that is proxied)

Cloudinary keys

JWT secrets

MongoDB URIs

Face model weights or embeddings

If Claude ever generates code that puts a secret in web/, mobile_app/, or driver_monitor/, stop and fix it.

6.2 Coding Standards
Backend: JavaScript (Node 20 LTS). Prettier + ESLint. pino for logging — no console.log.

Web: React 18 + Vite + TypeScript. Tailwind CSS. Framer Motion. React Query + Axios.

Flutter: Dart with flutter_lints. One widget per file. const constructors.

Python: Python 3.11+. black + ruff. Type hints required on public functions.

Commits: Conventional Commits (feat:, fix:, chore:, docs:).

6.3 Definition of Done (per feature)
□ Compiles with zero warnings
□ Linter passes
□ Tests pass; new logic has tests
□ Parent-facing change verified on both web and APK
□ No secrets in client code
□ /api/ingest contract unchanged
□ Latency budget still met (< 500 ms end-to-end)
7. Anti-Patterns (Do NOT Do)
❌ Don't	✅ Do
Put API keys in React/Flutter code	Put them in backend/.env
Call Firebase Firestore from the client	Call our backend, which calls MongoDB
Run face recognition in the browser	Send images to backend, get results back
Build Flutter Web	Build React for web; Flutter for APK only
Hardcode EAR < 0.21	Read driver.personalThresholds.earThreshold
Merge parent and driver apps	Keep them as separate Flutter projects
Add camera code to the backend	Keep camera code in driver_monitor/
Change /api/ingest field names	Add new optional fields instead
Poll the backend	Use Socket.io + FCM
Commit .env files	Only commit .env.example
8. Hardware Migration Path (Future)
Hardware	Replacement
Raspberry Pi camera	Replace cv-simulator with driver_monitor on the Pi
Heart-rate sensor	Add heartRate field to ingest payload (already in schema)
Onboard buzzer	Subscribe to MQTT alert/triggered topic
Steering angle sensor	Add steeringVariance to signals (additive, backward-compatible)
No changes to web/, mobile_app/, backend/ models, or MongoDB schemas. If a hardware change requires a UI change, stop and ask.

9. Claude's Operating Rules for This Repo
Read this file, then the subdirectory CLAUDE.md for the subtree you're editing.

Ask before changing the API contract at /api/ingest.

Never put secrets in client code.

Never build Flutter Web.

Never merge the two Flutter apps.

Never add hardware code — respond with the JSON simulation alternative.

Prefer editing existing files over creating parallel ones.

When unsure, ask. Do not guess at architecture.

Update the relevant CLAUDE.md whenever an architectural decision changes.

10. Build Order (Follow This Sequence)
Backend: models, auth, /api/ingest, fusion engine, Socket.io

cv-simulator/ — prove the contract works end-to-end

web/ — React PWA with login, dashboard, register driver, alerts

mobile_app/ — Flutter APK mirroring web features

driver_monitor/ — Python real detection, POSTs to the same endpoint

Never start a phase until the previous phase's contract is proven working.

last_updated: 2026-10-07
phase: greenfield build
status: ready for implementation

---

## 11. False-Positive Verifier (added 2026-10-07)

New top-level folder `ml/` (Python, scikit-learn) — **offline only**, never imported by the backend.

- `ml/` generates the synthetic dataset, trains a gradient-boosted-tree verifier on 30-tick signal
  windows, and exports `backend/src/ml/fp-verifier.json` + parity fixtures. See `ml/README.md`.
- The backend runs the model in pure JS (`services/fpFeatures.js`, `services/fpVerifier.js`) between
  fusion and alert creation. **`/api/ingest` is unchanged**; a suppressed candidate returns
  `alertTriggered: false`.
- `ml/guardian_ml/features.py` is the canonical feature definition; `fpFeatures.js` is a line-for-line
  port. Change both together and retrain — the backend parity test enforces it.
- Parents label alerts with **False alarm** (web + APK) → `PATCH /api/alerts/:id/ack {falseAlarm}` or
  `PATCH /api/alerts/:id/feedback`. `npm run export:feedback` produces retraining data.
- Real recordings and feedback exports may contain personal data: they are gitignored.

## 12. Location, snapshots, unique driver names (added 2026-10-08)

- **Optional `location` on `/api/ingest`** — `{lat, lng, heading?, speed? (km/h), accuracy? (m)}`,
  additive: the frozen keys and the response shape are unchanged. Stored on SensorLog, the alert
  (`alert.location`), the live `driver:status` (`location`) and throttled to `Driver.lastLocation`.
  Senders: cv-simulator (simulated route, `SIM_GPS`), driver_monitor (`GPS_SOURCE=none|fixed|nmea`).
- **`POST /api/ingest/snapshot`** (same `x-api-key`) `{driverId, alertId, image}` — the in-car device
  attaches its camera frame to an alert it triggered (≤ 2 min old, ≤ 1.5 MB). Stored like reference
  photos (Cloudinary or `/uploads/alerts/<driverId>/`), sets `alert.snapshotUrl`, emits additive socket
  event `alert:updated {alertId, snapshotUrl}`. Deleted with the driver. driver_monitor: `SEND_SNAPSHOTS`.
- **Maps** — web/APK use Google's keyless embed (`maps.google.com/maps?q=…&output=embed`) plus Maps URLs
  for "Directions" / "Open in Google Maps". Optional `VITE_GOOGLE_MAPS_EMBED_KEY` (referrer-restricted
  browser key, public by design) switches the web to the official Embed API. No key is required.
- **Driver names are unique per parent** after normalisation (NFKC, trimmed, collapsed whitespace,
  lower-case) — `Driver.nameKey` + unique partial index; 409 with a twins hint. Enrollment also returns
  `similarFaces` (already-registered drivers whose face matches, e.g. twins) as a warning, not an error.

## 13. BLE wearable, yawns, personal heart-rate fusion (added 2026-10-10)

Full design: `docs/WEARABLE.md`. Summary for future changes:

- **Hardware split:** Raspberry Pi = in-car hub (camera + BLE central + uplink). The wrist watch is an
  ESP32-C3 running Arduino firmware (`wearable/guardian_watch/`) with a MAX30102, exposing the
  *standard* BLE Heart Rate (0x180D), Battery (0x180F) and Immediate Alert (0x1802) services. No wired Arduino.
- **New optional signals** on `/api/ingest` (contract keys unchanged): `signals.yawnCount`, `mar`, `hrv`,
  `hrBaseline`, `hrvBaseline`, plus top-level `wearable {connected, contact, battery, name}`.
- **Fusion** (`fusionEngine.js`, mirrored in `ml/guardian_ml/fusion.py`): personal HR-drop/HRV-rise physio
  term and an additive yawn term. **Without the new signals the score equals the original formula**:
  keep it that way. New per-driver thresholds: `yawnThreshold`, `fusionWeightYawn`, `hrDropThreshold`.
- **Alert type `yawning`**: yawn count ≥ threshold with otherwise-alert eyes. Skips the FP verifier,
  5-minute cooldown.
- **In-car vibration** (`driver_monitor/fusion/watch_alerts.py`): local microsleep (continuous closure ≥
  `drowsyDurationMs`) works offline. Backend verdict → level 1/2. Thresholds fetched from
  `GET /api/ingest/drivers/:id/thresholds` (API key).

## 14. Dashboard mmWave radar (added 2026-10-10)

- Recommended, low-cost body sensor: **Seeed MR60BHA2 60 GHz radar kit** (XIAO ESP32-C6) on the dashboard,
  contactless heart rate + breathing + presence. Firmware `wearable/guardian_radar/` exposes the standard
  Heart Rate service plus a custom Vitals characteristic (`6e0f0002-8c3b-4b8e-9a6e-6a5f3c1d0a01`).
  The watch is now optional (vibration + HRV).
- Pi: `VITALS=ble` (radar) and `WEARABLE=ble` (watch) can run together; `HR_PRIORITY` picks the HR source;
  `ALARM_CMD` plays a sound on HIGH alerts (car stereo / speaker).
- New optional signals `breathingRate`, `breathingBaseline`; top-level `radar {connected, present, distanceCm}`;
  threshold `breathDropThreshold` (0.2). Relative physio = weighted mean of HR drop (0.7), HRV rise (0.3),
  breathing drop (0.4) over the parts present. HR + HRV alone stays 0.7/0.3, so earlier behaviour holds.

## 15. Head-nod detection (added 2026-10-10)

- `driver_monitor/detectors/head_nod.py`: fast forward head drop (≥ `NOD_DEG` below the driver's rolling
  neutral pitch at ≥ `NOD_SPEED` °/s), followed by closed eyes or a fast snap back up = one nod. Slow
  looking-down is ignored. A nod fires the in-car alarm immediately (offline-capable).
- New optional signal `signals.nodCount` (5-min count). Fusion: additive `fusionWeightNod` (0.3) term;
  `nodCount ≥ nodThreshold` (2) → `drowsy` + alert type **`nodding`** (severe; skips the FP verifier,
  1-minute cooldown). Absent `nodCount` leaves the score unchanged.

## 16. Admin console & model training (added 2026-10-10)

Full guide: `docs/ADMIN.md`.

- **Role:** `User.role === 'admin'` (ADMIN_EMAILS at sign-in, or `npm run make-admin -- email`). `requireAdmin`
  re-reads the role from MongoDB on every request. Web: `/admin` (Overview · Datasets · Training · Models).
- **Worker:** `services/trainingRunner.js` spawns `ml/` scripts (and `driver_monitor` Python for MediaPipe
  jobs) one at a time; job types in `models/TrainingJob.js`; logs → socket room `admins`
  (`training:job`, `training:log`). Python auto-detected from the venvs or `ML_PYTHON` / `MONITOR_PYTHON`.
  Spawn uses argument arrays (no shell); job params are validated (catalog ids, simple folder names).
- **Models:** `models/ModelRelease.js` stores trained artifacts in MongoDB (kind `fp_verifier` | `eye_state`
  | `yawn_threshold`; one `active` per kind; none = bundled file). `services/modelRegistry.js` promotes,
  resets, and re-syncs the in-memory verifier every 60 s (multiple backends, one DB).
- **Devices:** thresholds endpoint adds `device {yawnMar, eyeStateVersion}`; `GET /api/ingest/models/eye-state`.
  `driver_monitor/transport/model_sync.py` applies them (`MODEL_SYNC=0` opts out); the promoted eye model is
  saved as `models/eye_state.promoted.json` (bundled file never overwritten).
- **ml scripts:** `train.py` / `train_eye_state.py --out-dir` write candidates without touching the live
  model, parity fixture or reports; new `calibrate_yawn.py` (refuses datasets without detectable faces;
  never recommends below `--floor` 0.3) and `process_videos.py` (UTA-RLDD / folder presets);
  `import_recordings.py` accepts folders. Public dataset catalog: `backend/src/config/datasetCatalog.js`.

## 17. E-mail verification (added 2026-10-10)

Guide: `docs/EMAIL.md`. New accounts get a 6-digit e-mailed code (`services/emailOtp.js`, hashed, 10 min,
5 attempts, 60 s resend cooldown, 5/hour) and receive no JWT until `POST /api/auth/verify-email`. Login of an
unverified account → 403 `details.code = EMAIL_NOT_VERIFIED`. Mail goes through `services/mailer.js`
(`EMAIL_PROVIDER=brevo` HTTPS API, because Render free blocks SMTP; `console` for local). On automatically when a
provider is set; `EMAIL_VERIFICATION=off` disables. Users without `emailVerified` (pre-feature) count as verified.
Web: `components/auth/OtpForm.tsx`; APK: `widgets/otp_view.dart` + `VerificationRequired` exception.
