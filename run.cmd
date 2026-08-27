@echo off
setlocal
cd /d "%~dp0"
title OpenResearch Launcher
call "%~dp0start_openresearch.cmd" %*
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Launcher exited with error code %ERRORLEVEL%.
    echo.
    pause
)
