#!/usr/bin/env bash
# Download new Garmin data into ./data (macOS / Linux).
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python -m girlgarmin.sync "$@"
