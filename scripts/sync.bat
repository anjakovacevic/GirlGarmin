@echo off
rem Double-click to download new Garmin data into .\data (same as the dashboard's Sync button).
cd /d "%~dp0.."
".venv\Scripts\python.exe" -m girlgarmin.sync
pause
