@echo off
rem Manual launcher. The scheduled task calls keepawake-run.ps1 directly.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0keepawake-run.ps1"
