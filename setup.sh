#!/usr/bin/env bash
# One-time setup on macOS / Linux: creates .venv, installs the packages, logs you in to Garmin
# and downloads your data. Needs Python 3.11+.   Run:  bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
echo
echo "=== Garmin login (your password is not saved, only a login token in ~/.garminconnect) ==="
.venv/bin/python garmin_login.py
echo
echo "=== Downloading your Garmin data (first time can take 10+ minutes) ==="
.venv/bin/python garmin_sync.py
echo
echo "Done! Start the dashboard with:  .venv/bin/streamlit run dashboard.py"
