@echo off
rem Double-click to stop the Naukri bot and undo its Windows settings. See README.md ("Shutdown").
title Naukri bot - shutdown
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\shutdown-bot.ps1"
echo.
pause
