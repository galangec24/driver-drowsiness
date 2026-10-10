# Guardian Drive

Multimodal driver-drowsiness monitoring. Computer-vision signals (EAR, PERCLOS, head pose) and heart
rate are fused against **per-driver adaptive thresholds**, and parents get **real-time alerts** on
the web (React PWA) and Android (Flutter APK).

```
driver_monitor/ (Python, webcam) ─┐
cv-simulator/   (Python, fake)    ├─► POST /api/ingest ─► backend (Express + Socket.io + MongoDB)
hardware (later, same JSON)       ┘                          │ fusion · alerts · face enrollment
                                                             ▼
                                         Socket.io ─► web/ (React PWA)  +  mobile_app/ (APK)
```

| Folder            | What                                               | Stack                                      |
|-------------------|----------------------------------------------------|--------------------------------------------|
| `backend/`        | API, fusion engine, face enrollment, alerts        | Node 20+, Express 4, Socket.io 4, Mongoose |
| `web/`            | Parent web app (installable PWA, 3D glass design)  | React 18, Vite, TS, Tailwind, React Query  |
| `mobile_app/`     | Parent Android app — **APK only**                  | Flutter 3, provider, dio, go_router        |
| `driver_monitor/` | Real webcam drowsiness detection                   | Python, OpenCV, MediaPipe                  |
| `cv-simulator/`   | Fake sensor feed for development                   | Python, requests                           |

Rules for contributors (and AI agents) live in `CLAUDE.md` and each folder's `CLAUDE.md`.

---

## Quick start (local)

Prerequisites: Node 20+, Python 3.11+. MongoDB is optional — the dev launcher starts an embedded
MongoDB automatically if nothing is listening on `localhost:27017` (or run `docker compose up -d`).

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env          # then set JWT_SECRET and INGEST_API_KEY to long random values
npm run models:download       # face-recognition weights → backend/models/ (gitignored)
npm run dev                   # http://localhost:3000  (embedded MongoDB, data in backend/.mongo-data)
npm run seed                  # demo parent + face-enrolled driver; prints DRIVER_ID
npm test                      # 80 tests (unit + integration, in-memory MongoDB)
```

Demo login: `demo@guardiandrive.app` / `guardian123`.

### 2. Simulated sensor feed

```bash
cd cv-simulator
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # INGEST_API_KEY from backend/.env, DRIVER_ID from `npm run seed`
python drowsiness_sim.py      # cycles alert → warning → drowsy
```

### 3. Web app

```bash
cd web
npm install
cp .env.example .env          # VITE_API_URL=http://localhost:3000 (public, not a secret)
npm run dev                   # http://localhost:5173
npm test                      # Vitest
npm run e2e                   # Playwright smoke (uses installed Microsoft Edge); needs E2E_INGEST_KEY
```

### 4. Android APK

The APK is in `mobile_app/build/app/outputs/flutter-apk/`. Install `app-arm64-v8a-release.apk`
on the phone (allow "install unknown apps"). Phone and PC must be on the same Wi-Fi, and Windows
Firewall must allow inbound TCP 3000 for Node. On the login screen, tap **Server** to change the
backend URL (defaults to the URL baked in at build time).

Rebuild:

```bash
cd mobile_app
flutter pub get
flutter analyze && flutter test
flutter build apk --release --split-per-abi --dart-define=API_URL=http://<PC-LAN-IP>:3000
```

Release signing uses `mobile_app/android/key.properties` + `guardian-drive.jks` (both gitignored).
**Back them up** — losing them means existing installs can't be upgraded.

### 5. Real driver monitor (webcam)

```bash
cd driver_monitor
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # same INGEST_API_KEY / DRIVER_ID as the simulator
python main.py                # preview window with EAR / PERCLOS / head-pose overlay; 'q' quits
pytest                        # synthetic-landmark unit tests + mock-camera integration test
```

MediaPipe model files (~4 MB) download to `driver_monitor/models/` on first run.

---

## The ingest contract (frozen)

```http
POST /api/ingest
x-api-key: <INGEST_API_KEY>

{ "driverId": "…", "source": "simulated|driver_monitor|mobile_app|hardware",
  "signals": { "ear": 0.17, "perclos": 0.48, "heartRate": 56, "faceConfidence": 0.94, "matchedDriver": "…" },
  "timestamp": "2026-10-07T10:23:00Z" }

→ { "classification": "alert|warning|drowsy", "fusionScore": 0.4152, "alertTriggered": true, "alertId": "…" }
```

Signal fields are optional (missing ones count as "no evidence"); extra fields are accepted, so
hardware can add signals without breaking anything.

## Deployment

- **Backend → Render**: `render.yaml` (Blueprint). Needs a MongoDB Atlas URI in `MONGO_URI`.
  Secrets are entered in the Render dashboard; `JWT_SECRET`/`INGEST_API_KEY` are generated.
- **Web + APK → Firebase Hosting**: `firebase.json` serves `web/dist` and `/app.apk`.

```bash
cd web && VITE_API_URL=https://<render-service>.onrender.com npm run build && cd ..
cp mobile_app/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk web/dist/app.apk
firebase deploy --only hosting
```

Build the APK for production with `--dart-define=API_URL=https://<render-service>.onrender.com`.

## Security model

All credentials (JWT secret, ingest key, Cloudinary, FCM, Mongo URI) and face embeddings stay in
`backend/`. The web bundle and APK contain only the public backend URL. Face photos are sent to the
backend, which computes embeddings server-side; embeddings never leave the server.
