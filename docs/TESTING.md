# Setting up and testing Guardian Drive (web + Android APK)

Everything runs on your Windows PC; the phone talks to it over Wi-Fi. Total setup time ≈ 10 minutes.

```
 cv-simulator / driver_monitor ──► backend :3000 ──► web :5173 (PC browser or phone browser)
                                        └──────────► Android APK (phone, same Wi-Fi)
```

## 0. One-time setup

**Software:** Node 20+, Python 3.11+ (both already installed on this PC).

**Find your PC's Wi-Fi address** (the phone needs it):

```powershell
ipconfig     # "Wireless LAN adapter Wi-Fi" → IPv4 Address, e.g. 192.168.254.101
```

The APK was built with `http://192.168.254.101:3000` as its default server. If your address is
different (or changes later), just type the new one on the APK's login screen (tap **Server: …**).

**Allow the phone through Windows Firewall** (PowerShell *as Administrator*, once):

```powershell
New-NetFirewallRule -DisplayName "Guardian Drive (dev)" -Direction Inbound -Protocol TCP `
  -LocalPort 3000,5173,4173 -Action Allow -Profile Private
```

Your Wi-Fi network must be set to **Private** (Settings → Network & internet → Wi-Fi → your network).

If your IP is not `192.168.254.101`, also add it to `CORS_ORIGIN` in `backend/.env`
(e.g. `http://192.168.1.20:5173`) — only needed for the web app opened from the phone.

## 1. Start the backend (terminal 1)

```powershell
cd guardian-drive\backend
npm install          # first time only
npm run dev          # starts an embedded MongoDB + API on http://0.0.0.0:3000
```

Look for `fp verifier loaded` and `Guardian Drive backend listening`. Leave it running.

First time only, in another terminal: `npm run seed` — creates the demo parent and a face-enrolled
driver and prints the driver id.

| Demo login | |
|---|---|
| Email | `demo@guardiandrive.app` |
| Password | `guardian123` |

Check from the phone's browser: `http://<PC-IP>:3000/api/health` should show `{"status":"ok",…}`.
If it doesn't load, fix the firewall/Wi-Fi step before going further.

## 2. Start the web app (terminal 2)

```powershell
cd guardian-drive\web
npm install          # first time only
npm run dev          # http://localhost:5173 (also http://<PC-IP>:5173 for the phone)
```

Open **http://localhost:5173** and sign in with the demo account.

## 3. Install the APK on the phone

File: `mobile_app\build\app\outputs\flutter-apk\app-release.apk` (21 MB, arm64 — practically every
Android phone from 2017 on; it will not run on old 32-bit-only phones).

Pick one way to get it onto the phone:

- **USB cable:** copy the file to the phone's *Download* folder, open it with the Files app.
- **Google Drive / email to yourself:** upload from the PC, open the attachment on the phone.
- **Download page (easiest):** open `http://<PC-IP>:5173/download` on the phone, or open `http://localhost:5173/download` on the PC and scan its QR code. It detects the device and shows the right button and steps. The login page links to it (*Get the app*).
- **Over Wi-Fi from the dev server:** copy the APK to `web\public\app.apk`, then on the phone open
  `http://<PC-IP>:5173/app.apk` (the web app's Settings page links to `/app.apk` too).

Android will ask to allow installing from that app ("Install unknown apps") → allow → **Install**.
If Play Protect warns about an unknown developer, choose **More details → Install anyway** — the app
is signed with your own release key, not distributed through Play.

Open **Guardian Drive**, check the server under the sign-in button (`Server: http://192.168.254.101:3000`
— tap to change), sign in with the demo account, and allow notifications when asked.

## 4. Generate alerts (terminal 3)

```powershell
cd guardian-drive\cv-simulator
venv\Scripts\activate
python drowsiness_sim.py --scenario episode       # realistic drowsiness onset → alert after ~50 s
python drowsiness_sim.py --scenario false_alarm   # phone glances / squinting → no alert (verifier)
python drowsiness_sim.py                          # the original mixed alert/warning/drowsy cycle
```

| Scenario | What it is | Expected |
|---|---|---|
| `episode` | 45 s awake, then realistic drowsiness | warning/drowsy alert ≈ 50 s in, on web + APK |
| `false_alarm` | looking down, squinting, rubbing eyes | **no alerts** — fusion alone would raise 2 |
| `mixed` (default) | instant jumps alert→warning→microsleep | few alerts: the verifier distrusts these jumps |
| `alert` / `drowsy` / `microsleep` | constant random profiles | see note below |

**Seeing alerts from every scenario:** the false-positive verifier suppresses physiologically
implausible signals, and the classic profiles are i.i.d. random numbers. To see the raw fusion
behaviour, set `FP_VERIFIER=off` in `backend\.env` and restart the backend. Turning it back on and
replaying `false_alarm` is the clearest demonstration of what the model adds.

## 5. Test checklist

Run these with the backend, web app and APK all open. ✓ = what you should see.

### Live alerts and cross-device sync

1. Start `--scenario episode`.
   ✓ Dashboard driver card shows live EAR / PERCLOS / HR, status pill changes Alert → Warning/Drowsy.
   ✓ Within ~1 s of the alert: web toast + red pulsing alert card; APK snackbar + system notification + vibration.
2. On the **APK**, tap **Acknowledge**.
   ✓ The web card flips to "Acknowledged via Android app" without reloading (and vice versa).
   ✓ Acknowledging the same alert on the other device says "already acknowledged" (first ack wins).
3. On a new alert, tap **False alarm** (web or APK).
   ✓ Card shows "reported as false alarm" on both devices. This label is training data
   (`npm run export:feedback` in `backend`).
4. On an acknowledged alert, tap **Report false alarm** → same label appears everywhere.

### False-positive verifier

5. Run `--scenario false_alarm` for its full 150 s.
   ✓ No alert appears. The driver card still shows warning-level readings at times.
6. Set `FP_VERIFIER=off` in `backend\.env`, restart the backend, replay `false_alarm`.
   ✓ Now ~2 alerts appear — the false alarms the model removes. Set it back to `on`.

### Driver management

7. **Register driver** (web: Drivers → Register driver; APK: Dashboard → Add).
   Add front / left / right photos (camera or upload) of one person.
   ✓ Quality hints (blurry / too dark) per photo; after submit you land on the driver page with a
   reference photo and "face enrolled (3 photos)".
   ✓ Photos of two different people are rejected ("does not appear to be the same person").
   Note: the **web camera** only works on `http://localhost` (browsers block cameras on plain-HTTP
   LAN addresses) — on the phone's browser use **Upload**, or use the APK camera.
8. **Driver detail:** move a threshold slider → Save.
   ✓ "Thresholds saved"; the next readings are classified with the new value (dashed line on the
   EAR chart moves). **Verify face** with a new photo → "matches" / "does not match" + confidence.

### Location, snapshot and maps

9a. Run `--scenario episode` (the simulator now also sends a moving GPS position around Makati and,
    when an alert fires, uploads a stand-in driver photo).
    ✓ Driver card shows the speed with a pin; driver page → **Live location** shows a Google map,
    heading and speed. **Directions** opens Google Maps navigation to the driver (Maps app on the phone).
    ✓ The alert card shows the driver's photo; **Snapshot & map** opens the photo + where it happened.
    Real webcam: `GPS_SOURCE=fixed` + `GPS_FIXED=lat,lng` (or `nmea` with a USB GPS) in `driver_monitor\.env`.
9b. Register a driver with an existing driver's name in any case/spacing (e.g. `alex`).
    ✓ Rejected: "already registered — twins need distinct names". Registering the same face under a new
    name succeeds with a "looks very similar to …" warning.

### Watch, yawns and heart rate

9c. Yawn widely (mouth open ≥ 1.5 s) in front of the webcam three times within 5 minutes.
    ✓ The driver card's **Yawns** tile counts up; a **Frequent yawning** alert arrives.
9e. In front of the webcam, let your head drop forward quickly and jerk it back up, twice within 5 minutes.
    ✓ The overlay counts *Nods/5min*; the driver card shows Yawn·Nod `0·2`; a red **Head nodding** alert
    arrives and the watch/speaker alarm fires on each nod. Slowly looking down at your lap is not counted.
9d. With the dashboard radar (`VITALS=ble`) and/or the watch or any standard HR strap (`WEARABLE=ble`) in `driver_monitor\.env`:
    ✓ the driver card shows *Radar · 15 breaths/min* and HR.
    ✓ with the watch: *Watch connected*. Close your eyes for 2+ s and the watch vibrates (and `ALARM_CMD` plays),
    even with the backend stopped. Full bring-up: [docs/WEARABLE.md](WEARABLE.md) §8.

### Admin console (training)

9f. `npm run make-admin -- demo@guardiandrive.app` in `backend`, sign out/in on the web.
    ✓ **Admin** appears in the menu (not for normal parents). Datasets → **Download** "MRL Eye" →
    Training tab shows the job with a live log → succeeded. Training → **Train eye model** (tick two
    datasets) → Models tab shows a candidate with its accuracy → **Promote** → it shows *live*.
    Full guide: [docs/ADMIN.md](ADMIN.md).

### Alerts page

9. Filter by driver / type / status / time on web; chips on the APK. ✓ Lists update; acknowledging
   from the "Open" filter removes the alert from that list.

### Offline and reconnect

10. Stop the backend (Ctrl+C in terminal 1).
    ✓ Web shows "Live connection lost — reconnecting" + last-updated time and keeps cached data;
    APK shows the offline banner with cached drivers/alerts.
11. Start it again. ✓ Both reconnect automatically and refresh (no reload needed).

### PWA install (web)

12. `npm run build` then `npm run preview` in `web`, open **http://localhost:4173** in Edge/Chrome.
    ✓ Install icon in the address bar (and the custom "Install Guardian Drive" banner from the 2nd
    visit). Installed app opens in its own window; with the backend stopped it still shows the
    last cached drivers and alerts.

## 6. Test with your webcam (real detection)

Uses the real driver monitor instead of the simulator. Stop the simulator first (one feed per driver).

```powershell
cd guardian-drive\driver_monitor
venv\Scripts\activate            # already created; elsewhere: python -m venv venv; pip install -r requirements-dev.txt
python main.py                   # .env already points at the demo driver and the local backend
```

A preview window opens (press **q** to quit). The overlay shows EAR, PERCLOS, your calibrated
baseline, head pose, "Eyes closed p=…" from the image model, and the backend's classification after
each POST. Try each for ~20 s:

| Do this | EAR | PERCLOS | Dashboard / APK |
|---|---|---|---|
| Look at the screen normally | ~0.25–0.35 | near 0 % | driver card *Alert* |
| Close your eyes (head still) | drops below ~0.15 | climbs past 40 % | *Warning* → *Drowsy*, alert arrives |
| Look down at your phone | drops | rises a little | ideally **no alert** (verifier) |
| Turn away / cover the camera | — (no face) | frozen | card goes *Offline* after 30 s |

The first ~15 s calibrate your personal open-eye baseline. If nothing reaches the backend, check
`API_URL` / `INGEST_API_KEY` / `DRIVER_ID` in `driver_monitor\.env`, and try `CAMERA_INDEX=1` if you
use an external webcam.

**Eye image model check:** "Eyes closed p=" should be low (< 0.3) with eyes open and high (> 0.7)
with eyes closed. It runs in **shadow mode** (shown, not used for PERCLOS). If it's unstable for you,
collect your own eye crops and retrain (`ml\README.md` → *Image model*), then set `EYE_STATE=on` in
`driver_monitor\.env`.

**No webcam?** Any video works the same way:
`python main.py --video clip.mp4 --offline --record ..\ml\data\raw\clip.jsonl`.

## 7. Automated tests

```powershell
cd backend;        npm test                 # 120 tests (API, sockets, face, fusion, verifier parity)
cd ..\web;         npm test                 # 18 component tests
                   $env:E2E_INGEST_KEY = (Select-String '^INGEST_API_KEY=' ..\backend\.env).Line.Split('=')[1]
                   npm run e2e              # Playwright in Edge: login → live alert → acknowledge
cd ..\mobile_app;  C:\dev\flutter\bin\flutter test      # 9 widget tests
cd ..\cv-simulator; venv\Scripts\python -m pytest       # 10 tests
cd ..\ml;          venv\Scripts\python -m pytest        # 9 tests
cd ..\driver_monitor; venv\Scripts\python -m pytest   # 64 tests (EAR, PERCLOS, head pose, eye model, GPS, yawns, BLE heart rate, watch alerts)
```

## 8. Rebuilding the APK

```powershell
cd guardian-drive\mobile_app
$env:JAVA_HOME = 'C:\dev\jdk17'; $env:ANDROID_HOME = 'C:\dev\android-sdk'
C:\dev\flutter\bin\flutter build apk --release --target-platform android-arm64 `
  --dart-define=API_URL=http://<PC-IP>:3000
```

Needs ~2–3 GB free disk while building. `android\gradle.properties` caps Gradle at 2 GB RAM because
the Flutter default (8 GB) crashes this 8 GB machine, and `app\build.gradle.kts` pins the installed
NDK (28.2) so release builds strip debug symbols (21 MB APK instead of 179 MB). Keep `android\guardian-drive.jks`
and `android\key.properties` backed up — every future update must be signed with them.

## Troubleshooting

| Symptom | Fix |
|---|---|
| APK: "Cannot reach the Guardian Drive server" | Same Wi-Fi? Firewall rule added and network Private? Health URL loads in the phone browser? Server URL on the login screen correct? |
| Phone browser: web app loads but login fails | Add `http://<PC-IP>:5173` to `CORS_ORIGIN` in `backend\.env`, restart backend |
| No alerts from the simulator | Expected for `mixed`/i.i.d. scenarios with the verifier on — use `episode`, or set `FP_VERIFIER=off` |
| Alerts only while the APK is open | Background push needs Firebase (FCM), not configured yet; Socket.io + local notifications work while the app is running |
| `npm run dev` says MongoDB failed | Another MongoDB already on 27017 is fine; otherwise delete `backend\.mongo-data\mongod.lock` and retry |
| Driver card says Offline | No readings for 30 s — start the simulator or driver_monitor |
