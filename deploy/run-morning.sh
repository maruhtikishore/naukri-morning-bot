#!/usr/bin/env bash
# Linux / Raspberry Pi entry point (used by the systemd timer or cron).
# Runs the bot inside a virtual display (xvfb) so Chrome has a window without a monitor.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/logs
export TZ="${TZ:-Asia/Kolkata}"
export NAUKRI_BROWSER_CHANNEL="${NAUKRI_BROWSER_CHANNEL:-chromium}"
echo "[$(date '+%F %T')] scheduled run starting" >> data/logs/scheduler.log
xvfb-run -a --server-args="-screen 0 1366x850x24" npm run run >> data/logs/scheduler.log 2>&1
