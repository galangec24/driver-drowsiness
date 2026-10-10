# CLAUDE.md — Backend (Node.js + Express + Socket.io + MongoDB)

> **Read `../CLAUDE.md` first.** This file extends it with backend-specific rules. When a rule here conflicts with the root file, **this file wins for `backend/`**.
>
> **last_updated:** 2026-10-07

---

## 1. Scope
Governs everything under `backend/`. This is the **only** place credentials, model weights, and secrets live.

---

## 2. Stack (Fixed)
- Node.js 20 LTS
- Express 4
- Socket.io 4
- MongoDB via Mongoose
- JWT (`jsonwebtoken`) + `bcrypt`
- Validation: `zod`
- Logging: `pino`
- Testing: `jest` + `supertest`
- Face: `face-api.js` running **server-side**, or Python `face_recognition` via a subprocess/microservice
- Media storage: Cloudinary (server-side SDK)

Do not add TypeScript, NestJS, Prisma, or a non-Mongoose ORM.

---

## 3. Directory Structure
backend/
├── package.json
├── .env.example
├── .env ← NEVER commit
└── src/
├── server.js
├── app.js
├── config/
│ ├── db.js
│ ├── cloudinary.js
│ └── faceApi.js
├── models/
│ ├── User.js
│ ├── Driver.js
│ ├── Alert.js
│ └── SensorLog.js
├── routes/
│ ├── auth.routes.js
│ ├── drivers.routes.js
│ ├── ingest.routes.js
│ └── alerts.routes.js
├── controllers/
│ ├── auth.controller.js
│ ├── drivers.controller.js
│ ├── ingest.controller.js
│ └── alerts.controller.js
├── middleware/
│ ├── auth.middleware.js
│ ├── apiKey.middleware.js
│ └── error.middleware.js
├── services/
│ ├── fusionEngine.js
│ ├── adaptiveTuner.js
│ ├── alertDispatcher.js
│ ├── faceEnrollment.js
│ └── faceMatcher.js
└── sockets/
└── index.js

text

---

## 4. Environment Variables

### `backend/.env.example`
PORT=3000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/guardian_drive
JWT_SECRET=change_me_in_prod
JWT_EXPIRES_IN=7d
INGEST_API_KEY=simulator_key_change_me

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

FCM_SERVER_KEY=
FIREBASE_PROJECT_ID=

CORS_ORIGIN=http://localhost:5173,http://localhost:8080

text

**Rule:** Every variable above is required by the backend. None of them ship to the client.

---

## 5. Fusion Engine

**File:** `src/services/fusionEngine.js`

Rules:
- Never hardcode EAR/PERCLOS/HR thresholds. Always read from `driver.personalThresholds`.
- Fuse at least two modalities: vision (EAR + PERCLOS) and physiological (heart rate).
- Return a continuous score (0..1), not a boolean.
- Classification bands: `> 0.70` → `drowsy`, `> 0.40` → `warning`, else `alert`.

```js
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function computeDrowsinessScore(signals, driver) {
  const t = driver.personalThresholds;

  const visionScore = clamp(
    (t.earThreshold - signals.ear) / t.earThreshold, 0, 1
  );
  const perclosScore = clamp(signals.perclos / t.perclosThreshold, 0, 1);
  const physioScore = signals.heartRate < 60
    ? clamp((60 - signals.heartRate) / 15, 0, 1)
    : 0;

  const fused =
    t.fusionWeightVision * (0.6 * visionScore + 0.4 * perclosScore) +
    t.fusionWeightPhysio * physioScore;

  const classification =
    fused > 0.70 ? 'drowsy' :
    fused > 0.40 ? 'warning' :
                   'alert';

  return { fusionScore: fused, classification };
}

module.exports = { computeDrowsinessScore };
Required tests:

Boundary at exactly 0.40 and 0.70

All three classification bands

Missing signal fields → must not throw

Different drivers with different thresholds → different outcomes for same signals

6. Face Enrollment & Matching (Server-Side Only)
Files: src/services/faceEnrollment.js, src/services/faceMatcher.js

Rules:

face-api.js or face_recognition runs server-side only.

The client sends an image (base64 or multipart). The backend returns { embedding, quality }.

Embeddings are never returned to the client — they are stored on the Driver document.

Face matching at runtime compares an incoming embedding to the stored one and returns a confidence.

Model weights live in backend/models/ (gitignored — download via a setup script).

Images are uploaded to Cloudinary; only the URL is stored in MongoDB.

Endpoints:

POST /api/drivers — accepts name + base64 photo → enrolls → returns driverId

POST /api/drivers/:id/verify — accepts base64 photo → returns { match: boolean, confidence }

7. /api/ingest Controller Rules
Order of operations (do not reorder):

Validate payload with zod. Reject 400 on shape mismatch.

Verify API key (apiKey.middleware.js).

Load Driver by driverId. Reject 404 if missing.

Compute fusion via fusionEngine.computeDrowsinessScore.

Persist a SensorLog (always — even for alert classification).

If classification !== 'alert' → create Alert, emit via Socket.io, optionally send FCM.

Return the standard response shape.

Log ingest_latency_ms=<n> with pino.

Never do fusion in the route handler — always delegate to services/.

8. Socket.io Rules
File: src/sockets/index.js

On connect, verify JWT from handshake auth.

Extract parentId from JWT. Join room parent:<parentId>.

Emit events from alertDispatcher.js only — never call io.to() from controllers.

On disconnect, no cleanup needed.

9. Testing
Unit tests required for fusionEngine.js, adaptiveTuner.js, faceEnrollment.js.

Integration tests for /api/ingest, /api/auth/*, /api/alerts/:id/ack.

Coverage target: > 70% on src/services/.

npm test must pass before any commit.

10. Anti-Patterns
❌ Don't	✅ Do
Business logic in routes	Put it in services/
console.log in production	Use pino
Return stack traces	Use error.middleware.js
Trust client parentId	Read from JWT
Skip zod validation	Validate first
Fuse in the controller	Call fusionEngine service
Send embeddings to client	Keep them server-side
last_updated: 2026-10-07

---

## 11. Implementation Decisions (2026-10-07)

- **Password hashing:** `bcryptjs` (pure JS, same API as `bcrypt`) — native `bcrypt` has no prebuilt binaries for current Node.
- **Face recognition:** `@vladmandic/face-api` (maintained face-api.js fork) on the TensorFlow.js **WASM** backend, server-side. Models: SSD MobileNet v1 + 68-point landmarks + 128-d recognition net. `npm run models:download` copies them into `backend/models/`. JPEG/PNG decoding is pure JS (`jpeg-js`, `pngjs`).
- **Cloudinary is optional in dev:** when keys are empty, reference photos go to `backend/uploads/` and are served at `/uploads/<driverId>.jpg` (relative URL; clients prefix the API origin).
- **Alert cooldown:** one alert per driver per type per `ALERT_COOLDOWN_MS` (default 15 s). SensorLog is still written every tick; `alertTriggered` is `false` during cooldown. Prevents a 1 Hz feed from producing 1 alert/second.
- **Alert types:** `warning` → `warning`; `drowsy` → `microsleep` when EAR < 50 % of the driver's EAR threshold and PERCLOS ≥ their PERCLOS limit, else `drowsy`; `matchedDriver` ≠ `driverId` → `face_match`.
- **Ingest validation:** all `signals.*` are optional; unknown fields pass through (additive hardware signals). `heartRate: 0` means "no sensor".
- **Additive endpoints** (contract unchanged): `GET /api/auth/me`, `PUT /api/auth/fcm-token`, `GET /api/drivers/:id/logs`, `DELETE /api/drivers/:id`, `GET /api/push/config`, `GET /api/health`. `PATCH /api/alerts/:id/ack` accepts `{ acknowledgedBy }` and returns `{ alert, alreadyAcknowledged }` — first ack wins atomically.
- **Socket extras:** `driver:status` also carries `fusionScore`, `signals`, `source` (additive). On connect the server replays the latest status of each of the parent's drivers.
- **FCM:** stubbed in `services/fcm.js` until a Firebase project exists; Socket.io is the live channel.
- **Dev database:** `npm run dev` starts an embedded MongoDB (`mongodb-memory-server`, persistent `backend/.mongo-data/`) when nothing listens on the `MONGO_URI` port. Tests use an in-memory MongoDB.
- **Adaptive tuner:** daily 03:00; per driver, 70th-percentile EAR of the last 7 days = open-eye baseline; target = 75 % of baseline clamped to [0.12, 0.35]; moves 30 % toward the target per run; needs ≥ 300 samples.
- **False-positive verifier:** candidate alerts (non-`alert` classification) pass through
  `services/fpVerifier.js` (model `src/ml/fp-verifier.json`, trained in `ml/`). It needs ≥ 10 ticks of
  per-driver history (`services/signalWindow.js`, in memory) and abstains otherwise. Env:
  `FP_VERIFIER=off` disables, `FP_VERIFIER_THRESHOLD` overrides. Suppressed ticks keep
  `SensorLog.verifierScore`; raised alerts store `Alert.verifier` (score + window, `select: false`).
- **Feedback:** `Alert.feedback {falseAlarm, by, at}`; `PATCH /api/alerts/:id/ack` accepts optional
  `falseAlarm`; `PATCH /api/alerts/:id/feedback {falseAlarm, by}`; socket events carry `falseAlarm`
  (additive) and `alert:feedback {alertId, falseAlarm}` is new. Public alerts expose `falseAlarm`.
- `npm run export:feedback` → `ml/data/feedback/alerts.jsonl`.
- The `drowsyDurationMs` persistence gate was evaluated in `ml/` and rejected (costs recall/latency
  at 1 Hz). The field stays in the schema for frame-level use by future hardware.
