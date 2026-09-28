@echo off
rem Double-click to open the Garmin dashboard in your browser. Close this window to stop it.
rem First time? Double-click setup.bat once.
cd /d "%~dp0.."
if not exist ".venv\Scripts\streamlit.exe" (
    echo Not set up yet - double-click scripts\setup.bat first.
    pause
    exit /b 1
)
".venv\Scripts\streamlit.exe" run app\dashboard.py
