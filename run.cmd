@echo off
setlocal
cd /d "%~dp0"
title OpenResearch Desktop Launcher

echo ===============================================================================
echo   OPENRESEARCH - LAUNCHING DESKTOP APPLICATION (ELECTRON)
echo ===============================================================================
echo.

call "%~dp0start_openresearch.cmd" desktop
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Desktop launcher exited with error code %ERRORLEVEL%.
    echo.
    pause
)
