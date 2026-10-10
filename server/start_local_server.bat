@echo off
title DaiDai Local AI Server (Local Wi-Fi Mode)
cd /d "%~dp0"
echo ============================================================
echo   KHOI DONG DAIDAI SERVER CHE DO NOI BO (LAN WI-FI)
echo ============================================================
python gpu_server.py
pause
