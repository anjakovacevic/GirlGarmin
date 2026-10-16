#!/usr/bin/env bash
# One-time setup on macOS / Linux: creates .venv, installs the packages, logs you in to Garmin
# and downloads your data. Needs Python 3.12+.   Run:  bash scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' || {
    echo "Python 3.12 or newer is required. Install it and make sure python3 uses it." >&2
    exit 1
}
python3 -m venv .venv
if ! .venv/bin/python -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)'; then
    echo "The existing .venv uses Python older than 3.12. Delete .venv and rerun setup." >&2
    exit 1
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
echo
echo "=== Garmin login (your password is not saved, only a login token in ~/.garminconnect) ==="
.venv/bin/python -m girlgarmin.login
echo
echo "=== Downloading your Garmin data (first time can take 10+ minutes) ==="
.venv/bin/python -m girlgarmin.sync
echo
echo "Done! Start the dashboard with:  bash scripts/dashboard.sh"
