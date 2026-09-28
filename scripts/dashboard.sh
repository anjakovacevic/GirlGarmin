#!/usr/bin/env bash
# Open the Garmin dashboard in your browser (macOS / Linux). Ctrl+C to stop.
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/streamlit run app/dashboard.py
