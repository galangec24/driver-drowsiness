# Driver monitor on a Raspberry Pi (auto-start)

After setup the Pi runs the driver monitor as a **systemd service**: it starts on every boot, needs
no screen or keyboard, and restarts itself if it crashes, the camera is unplugged, or the network drops.

## What you need

- Raspberry Pi 4 (4 GB+) or Pi 5, official power supply (or a good 5 V / 3 A car USB-C adapter)
- 32 GB+ microSD card with **Raspberry Pi OS (64-bit) Bookworm**. 64-bit is required (MediaPipe).
- Camera: a **USB webcam** or the **Raspberry Pi Camera Module** (ribbon cable). Both are detected automatically.
- Internet in the car: a phone hotspot is the usual choice
- Optional: USB GPS receiver (for the parent's live map)

## 1. Prepare the SD card (on your PC)

In **Raspberry Pi Imager** choose *Raspberry Pi OS (64-bit)*, then open the settings (⚙ / *Edit settings*):

- hostname `guardian-pi`, username + password
- **Wi-Fi: your phone hotspot's name and password** (add your home Wi-Fi later, see below)
- **Enable SSH**

Flash, put the card in the Pi, power it on, wait ~2 minutes.

## 2. Copy the driver monitor to the Pi (from Windows PowerShell)

```powershell
cd "C:\Users\<you>\OneDrive\Desktop\CAPSTONE\guardian-drive"
tar --exclude=venv --exclude=venv-pi --exclude=__pycache__ --exclude=data --exclude=.env -czf driver_monitor.tgz driver_monitor
scp driver_monitor.tgz <user>@guardian-pi.local:~
ssh <user>@guardian-pi.local
```

On the Pi:

```bash
mkdir -p ~/guardian-drive && tar -xzf ~/driver_monitor.tgz -C ~/guardian-drive
cd ~/guardian-drive/driver_monitor
```

(If the project is on GitHub: `git clone <repo> ~/guardian-drive` instead.)

## 3. Install (one command)

```bash
sudo bash deploy/raspberry-pi/install.sh
```

If there is no `.env` yet it asks for three values:

| Prompt | Where to find it |
|---|---|
| Backend URL | `https://<your-app>.onrender.com`, or `http://<PC-IP>:3000` while testing on home Wi-Fi |
| INGEST_API_KEY | `backend/.env` locally, or the Render dashboard → Environment |
| FAMILY_EMAIL | the parent's Guardian Drive account e-mail. Whoever sits down is recognised from the face photos taken when each driver was registered, so one Pi serves every driver in the family. (Instead, a fixed `DRIVER_ID` from the driver's page URL `/drivers/<id>` also works.) |

The script installs packages, creates `venv-pi/`, downloads the face models, detects the camera,
and installs and starts the service. The first run takes 5–15 minutes. Re-running it is safe.

## 4. Check it

```bash
journalctl -u guardian-drive-monitor -f     # live log: "POST ok -> classification=alert ..."
systemctl status guardian-drive-monitor
```

On the web dashboard / APK the driver card turns **Alert** (live) within a few seconds.
Then reboot to confirm auto-start: `sudo reboot`. After ~1 minute the driver is live again with nothing typed.

## Settings (`~/guardian-drive/driver_monitor/.env`)

| Key | Use |
|---|---|
| `CAMERA_BACKEND` | `opencv` (USB webcam) or `picamera2` (camera module); set by the installer |
| `CAMERA_INDEX` | `0`; try `1` if the Pi has more than one camera |
| `GPS_SOURCE` | `nmea` + `GPS_PORT=/dev/ttyACM0` (or `/dev/ttyUSB0`) for a USB GPS; `fixed` + `GPS_FIXED=lat,lng` for a parked demo |
| `SEND_SNAPSHOTS` | `1` = send the driver's photo to the parent when an alert fires, `0` = never send images |
| `EYE_STATE` | `shadow` (default) / `on` / `off`, see `ml/README.md` |
| `VITALS` | `ble` for the dashboard radar (contactless heart rate + breathing), see [docs/WEARABLE.md](../../../docs/WEARABLE.md) |
| `WEARABLE` | `ble` for the optional Bluetooth watch (heart rate + vibration alert) |
| `ALARM_CMD` | sound on a high alert, e.g. `paplay /home/pi/alarm.wav` through a paired car stereo / speaker |
| `WEARABLE_NAME` / `WEARABLE_ADDRESS` | which watch to connect to (default name `GuardianWatch`) |

After editing: `sudo systemctl restart guardian-drive-monitor`.

## Everyday operations

| Task | Command |
|---|---|
| Update to a new version | copy the new files as in step 2 (keep `.env`), then `sudo bash deploy/raspberry-pi/install.sh` |
| Temporarily stop | `sudo systemctl stop guardian-drive-monitor` |
| Disable auto-start | `sudo systemctl disable --now guardian-drive-monitor` |
| Remove the service | `sudo bash deploy/raspberry-pi/uninstall.sh` |
| Add another Wi-Fi (e.g. home) | `sudo nmcli dev wifi connect "<SSID>" password "<password>"` (remembered and used automatically) |

## Good to know

- **No network?** The monitor keeps analysing and retries every second. Readings taken while offline are
  not queued (alerts are only useful in real time).
- **Clock:** the Pi has no battery-backed clock and may boot with the wrong time until it reaches the
  internet. The backend ignores device timestamps more than 5 minutes off and uses its own time instead.
- **Power cuts:** cars cut power abruptly, which can corrupt an SD card over time. Once everything works,
  you can enable *Overlay file system* in `sudo raspi-config` → Performance (makes the card read-only;
  turn it off again before editing `.env` or updating).
- **Heat:** use a case with a fan or a heatsink; a Pi in a parked car gets hot.
- **Performance:** the monitor analyses about 10 frames per second at 640x480, which a Pi 4 handles. On a
  Pi 5 it runs with headroom.
