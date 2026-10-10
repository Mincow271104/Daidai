@echo off
title DaiDai Local AI Server (Public 4G Mode)
cd /d "%~dp0"
echo ============================================================
echo   KHOI DONG DAIDAI SERVER CHE DO PUBLIC (DUNG CHO 4G)
echo ============================================================
python gpu_server.py --public
pause
