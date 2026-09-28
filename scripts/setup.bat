@echo off
rem One-time setup on Windows: creates .venv, installs the packages, logs you in to Garmin
rem and downloads your data. Needs Python 3.11+ from python.org ("Add python.exe to PATH" ticked).
cd /d "%~dp0.."
where python >nul 2>nul || (
    echo Python not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
    pause
    exit /b 1
)
if not exist ".venv" python -m venv .venv
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt || (pause & exit /b 1)
echo.
echo === Garmin login (your password is not saved, only a login token in your user folder) ===
".venv\Scripts\python.exe" -m girlgarmin.login || (pause & exit /b 1)
echo.
echo === Downloading your Garmin data (first time can take 10+ minutes) ===
".venv\Scripts\python.exe" -m girlgarmin.sync
echo.
echo Done! Double-click scripts\dashboard.bat to open your dashboard.
pause
