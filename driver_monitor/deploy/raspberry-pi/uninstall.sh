#!/usr/bin/env bash
# Stop and remove the auto-start service. Leaves the code, .env and venv-pi in place.
set -euo pipefail
SERVICE=guardian-drive-monitor
[[ $EUID -eq 0 ]] || { echo "Run with sudo"; exit 1; }
systemctl disable --now "$SERVICE" 2>/dev/null || true
rm -f "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
echo "Removed $SERVICE. Delete venv-pi/ too if you want the disk space back."
