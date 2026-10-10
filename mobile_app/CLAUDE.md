# CLAUDE.md — Mobile App (Flutter — APK Only)

> **Read `../CLAUDE.md` first.** This file extends it. When a rule here conflicts with the root file, **this file wins for `mobile_app/`**.
>
> **last_updated:** 2026-10-07

---

## 1. Scope
Governs `mobile_app/` — the **parent's** Android app, delivered as a standalone APK. Not the driver app.

`[CONFIRM]`: If `mobile_app/` is actually the driver app, swap the screens section below. Default assumption: **parent app**.

---

## 2. THE #1 RULE
> **`mobile_app/` is APK-only. Never build Flutter Web. Never build Linux, macOS, or Windows.**

The `web/`, `linux/`, `macos/`, `windows/` platform folders must not exist in this repo. If `flutter create` regenerates them, delete them.

React is the only web UI.

---

## 3. Stack
- Flutter 3.x (stable channel)
- Dart 3.x
- State management: `provider` OR `riverpod` (pick ONE)
- HTTP: `dio`
- Socket: `socket_io_client`
- Push: `firebase_messaging` (Android only)
- Storage: `shared_preferences` + `flutter_secure_storage` for JWT
- Charts: `fl_chart`
- Navigation: `go_router`
- Image: `image_picker`
- Animations: `flutter_animate` for the 3D-feel motion parity with web

---

## 4. Directory Structure
mobile_app/
├── pubspec.yaml
├── android/ ← ONLY platform folder that exists
├── assets/
└── lib/
├── main.dart
├── config/
│ ├── theme.dart ← matches web design tokens
│ └── router.dart
├── models/
│ ├── driver.dart
│ └── alert.dart
├── services/
│ ├── api_service.dart
│ ├── socket_service.dart
│ ├── storage_service.dart
│ └── fcm_service.dart
├── widgets/
│ ├── glass_card.dart ← parity with web GlassCard
│ ├── depth_button.dart
│ ├── driver_card.dart
│ └── alert_card.dart
└── screens/
├── login_screen.dart
├── dashboard_screen.dart
├── drivers_screen.dart
├── register_driver_screen.dart
├── driver_detail_screen.dart
├── alerts_screen.dart
└── settings_screen.dart

text

---

## 5. Screens (Parity with Web)

| Screen | Purpose |
|--------|---------|
| Login | Email + password, JWT to secure storage |
| Dashboard | Driver cards + live alert ticker |
| Drivers | List, add, tap-through |
| Register Driver | Name, relationship, 3-photo face enrollment |
| Driver Detail | Threshold sliders, EAR/HR charts |
| Alerts | Chronological feed, filters, acknowledge |
| Settings | Notification prefs, account, APK info |

---

## 6. Design Parity With Web

The APK must feel like the web app. Same 3D language:
- Glass cards (`BackdropFilter` + blur)
- Depth shadows (`BoxShadow` layers)
- Hover/press motion via `flutter_animate`
- Same color palette from `config/theme.dart`

**Not identical widgets** — Flutter widgets are not React. But **visually and functionally equivalent.**

---

## 7. Face Registration
- `image_picker` for camera + gallery
- 3 photos: front, left, right
- Client-side quality check (blur via `image` package)
- Send base64 to `POST /api/drivers` — **backend computes embeddings**
- Never compute embeddings on-device

---

## 8. Real-time
- One Socket.io connection per logged-in parent
- Same events as web: `alert:new`, `alert:acknowledged`
- FCM fallback when app is backgrounded
- On `alert:new`: local notification + alert card animation + haptic

---

## 9. APK Distribution (No Play Store)

- Build: `flutter build apk --split-per-abi`
- Output: `build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`
- Host on Firebase Hosting at `https://guardian-drive-app.web.app/app.apk`
- Share link with parents; they sideload
- No Play Console, no Play Store metadata

**Release signing:**
- Generate keystore once: `keytool -genkey -v -keystore guardian-drive.jks -keyalg RSA -keysize 2048 -validity 10000 -alias guardian-drive`
- Configure `android/key.properties` (gitignored)
- Keep `.jks` and passwords safe — losing them breaks upgrades

---

## 10. Build Commands
```bash
flutter pub get
flutter build apk --split-per-abi
flutter run -d <android-device-id>
Never run:

flutter build web

flutter build linux

flutter build macos

flutter build windows

11. Testing
flutter test for widget tests

Required: GlassCard renders, DriverCard renders, login form validates

flutter analyze must show zero warnings

12. Anti-Patterns
❌ Don't	✅ Do
Build Flutter Web	Build React for web
Keep web/ folder	Delete it
Compute embeddings on-device	Send to backend
Put API keys in Dart	Read from backend at runtime
Use Redux-style state	provider OR riverpod
Skip release signing	Sign with a persistent keystore
last_updated: 2026-10-07

---

## 13. Implementation Decisions (2026-10-07)

- **Role confirmed:** `mobile_app/` is the **parent** app.
- **State management:** `provider` (`AuthController`, `DataController` ChangeNotifiers in `lib/state/`).
- **Push:** `firebase_messaging` is deferred — no Firebase project exists yet and adding it requires `google-services.json`. `fcm_service.dart` asks `GET /api/push/config` and is the integration point. Until then alerts arrive via Socket.io and are surfaced with `flutter_local_notifications` + haptics while the app is running.
- **Server URL:** build-time default via `--dart-define=API_URL=…` (public, not a secret), editable on the login/settings screens and stored in `shared_preferences`. `usesCleartextTraffic` is on for LAN HTTP in development.
- **Android build:** application id / namespace `app.guardiandrive.parent`. No `ndkVersion`; `packaging.jniLibs.keepDebugSymbols` avoids an NDK download. Core-library desugaring enabled (required by `flutter_local_notifications`). Release signing reads `android/key.properties` (gitignored).
- **Offline:** last drivers/alerts responses are snapshotted in `shared_preferences` and shown with a "Last updated" banner when the backend is unreachable; 10 s polling while the socket is down.
