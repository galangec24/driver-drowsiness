#!/usr/bin/env bash
# Guardian Drive driver monitor: one-shot Raspberry Pi setup with auto-start on boot.
#
#   cd ~/guardian-drive/driver_monitor
#   sudo bash deploy/raspberry-pi/install.sh
#
# Safe to re-run (e.g. after copying a new version): it updates packages and restarts the service.
# Needs Raspberry Pi OS 64-bit (Bookworm or later) on a Pi 4 / Pi 5, plus a USB webcam or Pi camera module.
set -euo pipefail

SERVICE=guardian-drive-monitor
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="$APP_DIR/venv-pi"
ENV_FILE="$APP_DIR/.env"
RUN_USER="${SUDO_USER:-}"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }
as_user() { sudo -u "$RUN_USER" -H "$@"; }

# Replace KEY=... in .env, or append it.
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# ---------------------------------------------------------------- checks
[[ $EUID -eq 0 ]] || die "Run with sudo:  sudo bash deploy/raspberry-pi/install.sh"
[[ -n "$RUN_USER" && "$RUN_USER" != root ]] || die "Run via sudo from your normal user (not as root directly)."
[[ -f "$APP_DIR/main.py" ]] || die "main.py not found in $APP_DIR"
[[ "$(uname -m)" == aarch64 ]] || die "64-bit Raspberry Pi OS required (MediaPipe has no 32-bit ARM build). Found: $(uname -m)"

# ---------------------------------------------------------------- system packages
say "Installing system packages"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip libgl1 libglib2.0-0 v4l-utils curl bluez >/dev/null
if apt-cache show python3-picamera2 >/dev/null 2>&1; then
  apt-get install -y -qq python3-picamera2 >/dev/null || warn "python3-picamera2 not installed (only needed for the ribbon-cable camera)"
fi
# Camera, USB GPS and Bluetooth access for the service user.
usermod -aG video,dialout,bluetooth "$RUN_USER"
# Bluetooth LE wearable (docs/WEARABLE.md): radio on and the BlueZ daemon running at boot.
rfkill unblock bluetooth 2>/dev/null || true
systemctl enable --now bluetooth >/dev/null 2>&1 || warn "bluetooth service not available (only needed for the watch)"

# ---------------------------------------------------------------- .env
cd "$APP_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  say "Creating .env"
  cp .env.example "$ENV_FILE"
  if [[ -t 0 ]]; then
    read -rp "Backend URL (e.g. https://guardian-drive-api.onrender.com): " api_url
    read -rp "INGEST_API_KEY (from backend/.env or the Render dashboard): " api_key
    read -rp "DRIVER_ID (24-char id shown on the driver's page / npm run seed): " driver_id
    set_env API_URL "${api_url%/}"
    set_env INGEST_API_KEY "$api_key"
    set_env DRIVER_ID "$driver_id"
  else
    warn "Edit $ENV_FILE (API_URL, INGEST_API_KEY, DRIVER_ID), then re-run this script."
  fi
fi
sed -i 's/\r$//' "$ENV_FILE"   # files copied from Windows may have CRLF line endings
chown "$RUN_USER:$RUN_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"          # holds the ingest API key

# Camera: USB webcam → OpenCV/V4L2; otherwise a ribbon-cable camera module → picamera2.
if [[ -z "$(get_env CAMERA_BACKEND)" ]]; then
  if ls /dev/v4l/by-id/*usb* >/dev/null 2>&1; then
    set_env CAMERA_BACKEND opencv
  elif command -v rpicam-hello >/dev/null && rpicam-hello --list-cameras 2>&1 | grep -q '^[0-9] :'; then
    set_env CAMERA_BACKEND picamera2
  else
    set_env CAMERA_BACKEND opencv
    warn "No camera detected right now. Plug one in; the service keeps retrying every 5 s."
  fi
fi
say "Camera backend: $(get_env CAMERA_BACKEND)"

for key in API_URL INGEST_API_KEY DRIVER_ID; do
  [[ -n "$(get_env $key)" ]] || die "$key is empty in $ENV_FILE. Fill it in and re-run."
done

case "$(get_env API_URL)" in
  *localhost*|*127.0.0.1*) die "API_URL in $ENV_FILE is $(get_env API_URL), which on the Pi means the Pi itself. Use the backend's real address (https://...onrender.com or http://<PC-IP>:3000) and re-run." ;;
esac

# ---------------------------------------------------------------- python
say "Creating Python environment (first run takes several minutes)"
# --system-site-packages: lets the venv import apt's picamera2/libcamera bindings.
[[ -d "$VENV" ]] || as_user python3 -m venv --system-site-packages "$VENV"
as_user "$VENV/bin/pip" install -q --upgrade pip
if ! as_user "$VENV/bin/pip" install -q -r requirements.txt pyserial; then
  die "pip install failed. MediaPipe needs Python 3.9–3.12 wheels for aarch64; this OS has $(python3 -V). \
Use Raspberry Pi OS (64-bit) Bookworm, or install Python 3.11 and recreate $VENV."
fi
as_user "$VENV/bin/python" -c "import config; config.ensure_models()" || die "Could not download the MediaPipe models (internet needed once)."

# ---------------------------------------------------------------- checks against the backend
API_URL="$(get_env API_URL)"
if curl -fsS -m 8 "$API_URL/api/health" >/dev/null; then
  say "Backend reachable: $API_URL"
else
  warn "Backend not reachable at $API_URL right now. The monitor keeps running and retries every second."
fi

# ---------------------------------------------------------------- systemd service
say "Installing systemd service '$SERVICE' (starts on every boot)"
cat >"/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=Guardian Drive driver monitor (camera -> drowsiness signals -> backend)
Wants=network-online.target bluetooth.target
After=network-online.target bluetooth.target
# Never give up restarting (camera unplugged, no network yet, power glitches...).
StartLimitIntervalSec=0

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
SupplementaryGroups=video dialout bluetooth
WorkingDirectory=$APP_DIR
ExecStart=$VENV/bin/python main.py --no-window
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 8
if systemctl is-active --quiet "$SERVICE"; then
  say "Running. It will start automatically on every boot."
else
  warn "Service is not running yet. See: journalctl -u $SERVICE -n 50"
fi
journalctl -u "$SERVICE" -n 8 --no-pager || true

cat <<DONE

  Live log:   journalctl -u $SERVICE -f
  Status:     systemctl status $SERVICE
  Restart:    sudo systemctl restart $SERVICE   (after editing .env)
  Stop/off:   sudo systemctl disable --now $SERVICE
  Remove:     sudo bash deploy/raspberry-pi/uninstall.sh
DONE
