@echo off
title DaiDai All-in-One Launcher
cd /d "%~dp0"
echo ============================================================
echo   KHOI DONG TOAN BO HE THONG DAIDAI (GPU AI + APP EXPO)
echo ============================================================
echo.
echo 1. Dang mo Server AI GPU (Faster-Whisper RTX 3050)...
start "DaiDai AI GPU Server" cmd /k "cd /d %~dp0server && python gpu_server.py"

echo 2. Dang mo Expo App Dev Server...
start "DaiDai Expo App" cmd /k "cd /d %~dp0 && npm start"

echo.
echo ============================================================
echo   DA KHOI DONG XONG! TOC DO SIEU TOC ~1.5S SAN SANG.
echo ============================================================
timeout /t 3 >nul
exit
