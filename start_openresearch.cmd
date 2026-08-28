@echo off
setlocal EnableDelayedExpansion
title OpenResearch - System Launcher
chcp 65001 >nul 2>&1

:: Ensure we are in the root project directory regardless of how script was invoked
cd /d "%~dp0"
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

:: Everything backend-related must run inside the project virtualenv
set "VENV_DIR=%ROOT_DIR%\apps\api\.venv"
set "PY_EXE=%VENV_DIR%\Scripts\python.exe"

if /i "%~1"=="desktop" goto DESKTOP_MODE
if /i "%~1"=="-d" goto DESKTOP_MODE
if /i "%~1"=="--desktop" goto DESKTOP_MODE
if /i "%~1"=="web" goto FULL_STACK_MODE
if /i "%~1"=="api" goto BACKEND_ONLY_MODE
if /i "%~1"=="test" goto TEST_MODE

:MENU
cls
echo ===============================================================================
echo   OPENRESEARCH - OPEN-SOURCE AI ACADEMIC RESEARCH ^& WRITING ASSISTANT
echo ===============================================================================
echo.
echo   Please select an option to launch the application:
echo.
echo   [1] Start Full Stack (Web Browser)
echo       * Auto-installs missing dependencies [npm and python]
echo       * Launches FastAPI Backend [8000] and Next.js Frontend [3000]
echo       * Opens http://localhost:3000 in your default web browser
echo.
echo   [D] Desktop App Mode (Electron Window)
echo       * Launches FastAPI Backend [8000] and Next.js Frontend [3000]
echo       * Opens standalone Electron Desktop Window with Custom Themed Title Bar
echo.
echo   [2] Backend API Only (FastAPI on port 8000)
echo       * Interactive Swagger docs at http://localhost:8000/api/v1/docs
echo.
echo   [3] Frontend Web Only (Next.js on port 3000)
echo.
echo   [4] Docker Compose Mode (Full Multi-Container Stack)
echo       * Automatically builds and spins up multi-container deployment
echo.
echo   [5] Run Full Automated Verification Suite
echo       * Vitest unit/integration tests and backend Pytest suite
echo.
echo   [6] Stop / Free Service Ports (3000, 8000)
echo.
echo   [7] Exit
echo.
echo ===============================================================================
set "CHOICE=1"
set /p "CHOICE=Enter choice [1-7 or D] (Default: 1): "

if /i "%CHOICE%"=="D" goto DESKTOP_MODE
if "%CHOICE%"=="1" goto FULL_STACK_MODE
if "%CHOICE%"=="2" goto BACKEND_ONLY_MODE
if "%CHOICE%"=="3" goto FRONTEND_ONLY_MODE
if "%CHOICE%"=="4" goto DOCKER_MODE
if "%CHOICE%"=="5" goto TEST_MODE
if "%CHOICE%"=="6" goto CLEAN_PORTS
if "%CHOICE%"=="7" goto EXIT_SCRIPT

echo.
echo [!] Invalid selection "%CHOICE%". Please enter 1, 2, 3, 4, 5, 6, 7, or D.
echo.
pause
goto MENU


:: ===============================================================================
:: SETUP: DEPENDENCY VERIFICATION
:: ===============================================================================
:CHECK_DEPS
cls
echo ===============================================================================
echo   VERIFYING ENVIRONMENT AND DEPENDENCIES
echo ===============================================================================
echo.

:: 1. Check Node.js and NPM
echo [1/4] Checking Node.js and NPM environment...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js was not found in PATH!
    echo         Please install Node.js v18+ from https://nodejs.org/
    echo.
    pause
    goto MENU
)
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] NPM was not found in PATH!
    echo         Please install Node.js and NPM.
    echo.
    pause
    goto MENU
)
for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo   [OK] Node.js !NODE_VER! and NPM detected.

:: 2. Ensure the project virtualenv exists (auto-create if missing)
echo [2/4] Checking Python virtual environment...
if exist "!PY_EXE!" (
    echo   [OK] Project virtualenv detected: apps\api\.venv
) else (
    where python >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Python was not found in PATH!
        echo         Please install Python 3.11+ from https://www.python.org/
        echo.
        pause
        goto MENU
    )
    for /f "tokens=*" %%v in ('python --version') do echo   -> Creating virtualenv apps\api\.venv using %%v...
    python -m venv "!VENV_DIR!"
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Failed to create virtual environment!
        echo.
        pause
        goto MENU
    )
    echo   [OK] Virtual environment created: apps\api\.venv
)
for /f "tokens=*" %%v in ('"%PY_EXE%" --version') do set "PY_VER=%%v"
if "!PY_VER!"=="" (
    echo [ERROR] Virtualenv Python is broken or missing: !PY_EXE!
    echo         Delete apps\api\.venv and re-run the launcher to rebuild it.
    echo.
    pause
    goto MENU
)
echo   [OK] Using !PY_VER! from apps\api\.venv.

:: 3. Free lingering ports before launching
echo [3/4] Cleaning up previous service instances on ports 3000, 8000...
call :FREE_PORTS
echo   [OK] Ports cleared.

:: 4. Install missing dependencies
echo [4/4] Verifying project dependencies...

if not exist "%ROOT_DIR%\node_modules" (
    echo   -> Installing workspace dependencies [root npm install]...
    cd /d "%ROOT_DIR%"
    call npm install
    if !ERRORLEVEL! neq 0 (
        echo   [WARNING] npm install encountered an issue, attempting to proceed...
    ) else (
        echo   [OK] Workspace dependencies installed.
    )
) else (
    echo   [OK] Root node_modules present.
)

"%PY_EXE%" -c "import fastapi, uvicorn, pydantic, sqlalchemy, alembic, jwt, bcrypt, httpx" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   -> Installing backend dependencies from apps\api\requirements.txt...
    cd /d "%ROOT_DIR%\apps\api"
    "%PY_EXE%" -m pip install -q -r requirements.txt
    if !ERRORLEVEL! neq 0 (
        echo   [WARNING] pip install encountered an issue, attempting to proceed...
    ) else (
        echo   [OK] Backend Python dependencies installed.
    )
    cd /d "%ROOT_DIR%"
) else (
    echo   [OK] Backend Python dependencies verified.
)
echo.
goto :eof


:: ===============================================================================
:: OPTION D: DESKTOP APP MODE (ELECTRON)
:: ===============================================================================
:DESKTOP_MODE
call :CHECK_DEPS
call :START_BACKEND
call :START_FRONTEND
call :START_DESKTOP
goto SERVICE_DASHBOARD

:: ===============================================================================
:: OPTION 1: FULL STACK MODE
:: ===============================================================================
:FULL_STACK_MODE
call :CHECK_DEPS
call :START_BACKEND
call :START_FRONTEND
goto SERVICE_DASHBOARD

:: ===============================================================================
:: OPTION 2: BACKEND ONLY
:: ===============================================================================
:BACKEND_ONLY_MODE
call :CHECK_DEPS
call :START_BACKEND
echo.
echo   - FastAPI API Docs: http://localhost:8000/api/v1/docs
echo.
pause
goto SERVICE_DASHBOARD

:: ===============================================================================
:: OPTION 3: FRONTEND ONLY
:: ===============================================================================
:FRONTEND_ONLY_MODE
call :CHECK_DEPS
call :START_FRONTEND
echo.
echo Opening default web browser in 2 seconds...
ping -n 3 127.0.0.1 >nul 2>&1
start http://localhost:3000
goto SERVICE_DASHBOARD


:: ===============================================================================
:: SUBROUTINES: LAUNCH SERVICES IN DEDICATED WINDOWS
:: ===============================================================================
:START_BACKEND
echo   -> Starting FastAPI Backend on http://localhost:8000 ...
start "OpenResearch - FastAPI API (:8000)" /D "%ROOT_DIR%\apps\api" cmd /k "title OpenResearch - FastAPI API (:8000) && "%PY_EXE%" -m uvicorn app.main:app --reload --port 8000"
ping -n 3 127.0.0.1 >nul 2>&1
goto :eof

:START_FRONTEND
echo   -> Starting Next.js Web App on http://localhost:3000 ...
start "OpenResearch - Next.js Web (:3000)" /D "%ROOT_DIR%\apps\web" cmd /k "title OpenResearch - Next.js Web (:3000) && npm run dev"
ping -n 3 127.0.0.1 >nul 2>&1
goto :eof

:START_DESKTOP
echo   -> Launching Electron Desktop Window...
start "OpenResearch - Electron Desktop" /D "%ROOT_DIR%" cmd /k "title OpenResearch - Desktop && npm run dev:desktop"
ping -n 3 127.0.0.1 >nul 2>&1
goto :eof


:: ===============================================================================
:: SERVICE DASHBOARD (ACTIVE)
:: ===============================================================================
:SERVICE_DASHBOARD
cls
echo ===============================================================================
echo   OPENRESEARCH - SERVICE MANAGER (ACTIVE)
echo ===============================================================================
echo.
echo   Services are running in their dedicated background windows:
echo     [1] Next.js Web App      : http://localhost:3000
echo     [2] FastAPI Backend      : http://localhost:8000/api/v1/docs
echo     [3] API Health Endpoint  : http://localhost:8000/api/v1/health
echo.
echo ===============================================================================
echo   CONTROLS:
echo     [O] Open Web App in Browser
echo     [D] Open API Docs in Browser
echo     [T] Run Full Verification Suite
echo     [R] Restart All Services
echo     [K] Stop All Services and Return to Main Menu
echo     [X] Exit (Close Launcher Window)
echo ===============================================================================
set "ACT="
set /p "ACT=Enter command [O/D/T/R/K/X]: "

if /i "%ACT%"=="O" goto DO_OPEN_UI
if /i "%ACT%"=="D" goto DO_OPEN_DOCS
if /i "%ACT%"=="T" goto TEST_MODE
if /i "%ACT%"=="R" goto DO_RESTART
if /i "%ACT%"=="K" goto DO_STOP
if /i "%ACT%"=="X" goto EXIT_SCRIPT

goto SERVICE_DASHBOARD

:DO_OPEN_UI
start http://localhost:3000
goto SERVICE_DASHBOARD

:DO_OPEN_DOCS
start http://localhost:8000/api/v1/docs
goto SERVICE_DASHBOARD

:DO_RESTART
echo.
echo Restarting services...
call :FREE_PORTS
goto FULL_STACK_MODE

:DO_STOP
echo.
echo Stopping services...
call :FREE_PORTS
echo Services stopped.
ping -n 3 127.0.0.1 >nul 2>&1
goto MENU


:: ===============================================================================
:: OPTION 4: DOCKER COMPOSE
:: ===============================================================================
:DOCKER_MODE
cls
echo ===============================================================================
echo   LAUNCHING OPTION: DOCKER COMPOSE
echo ===============================================================================
echo.
echo [1/3] Checking Docker installation...
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Docker command was not found in your system PATH!
    echo         Please ensure Docker Desktop is installed and added to PATH,
    echo         or choose Options 1-3 for Local Development Mode.
    echo.
    pause
    goto MENU
)

echo [2/3] Checking Docker daemon status...
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Docker Desktop is installed, but the Docker daemon is not running!
    echo         Please start Docker Desktop and try again, or use Options 1-3.
    echo.
    pause
    goto MENU
)

echo [3/3] Building and starting all multi-service containers...
echo.
echo -> Starting full self-host stack: web (:3000), api (:8000), db, redis, grobid, ollama
echo.

:: Generate .env.selfhost from template if missing
set "ENVFILE=%ROOT_DIR%\infrastructure\.env.selfhost"
if not exist "%ENVFILE%" (
    echo -> Generating .env.selfhost from template...
    copy /Y "%ROOT_DIR%\infrastructure\.env.selfhost.example" "%ENVFILE%" >nul
    for /f "tokens=*" %%k in ('powershell -NoProfile -Command "$b=New-Object byte[] 24;(New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b);($b|ForEach-Object('{0:x2}'-f $_))-join''"') do set "RANDSECRET=%%k"
    powershell -NoProfile -Command "(Get-Content '%ENVFILE%') -replace 'generate_a_random_32_character_secret_key_here_for_production', '%RANDSECRET%' | Set-Content '%ENVFILE%'"
    echo   [OK] .env.selfhost created with auto-generated SECRET_KEY.
) else (
    echo   [OK] Using existing .env.selfhost.
)

cd /d "%ROOT_DIR%\infrastructure"
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up --build
if %ERRORLEVEL% neq 0 (
    echo.
    echo -> Retrying with docker-compose syntax...
    docker-compose -f docker-compose.selfhost.yml --env-file .env.selfhost up --build
)

echo.
echo Docker containers stopped.
pause
goto MENU


:: ===============================================================================
:: OPTION 5: VERIFICATION SUITE
:: ===============================================================================
:TEST_MODE
cls
echo ===============================================================================
echo   RUNNING FULL AUTOMATED VERIFICATION SUITE
echo ===============================================================================
echo.

echo [1/2] Running Vitest Unit ^& Integration Test Suite...
cd /d "%ROOT_DIR%"
call npm run test
if %ERRORLEVEL% neq 0 goto TEST_FAIL
cd /d "%ROOT_DIR%"
echo.

echo [2/2] Running Backend Pytest Suite...
cd /d "%ROOT_DIR%\apps\api"
"%PY_EXE%" -m pytest tests -v --no-cov
if %ERRORLEVEL% neq 0 goto TEST_FAIL
cd /d "%ROOT_DIR%"

echo.
echo ===============================================================================
echo   ALL VERIFICATION TESTS COMPLETED WITH 100%% SUCCESS!
echo ===============================================================================
echo.
pause
goto MENU

:TEST_FAIL
cd /d "%ROOT_DIR%"
echo.
echo [!] Verification encountered an error.
echo.
pause
goto SERVICE_DASHBOARD


:: ===============================================================================
:: OPTION 6: CLEAN PORTS
:: ===============================================================================
:CLEAN_PORTS
cls
echo ===============================================================================
echo   STOPPING AND CLEANING BACKGROUND SERVICES
echo ===============================================================================
echo.
echo Freeing ports 3000, 8000...
call :FREE_PORTS
echo [OK] Any lingering service processes have been terminated and ports freed.
echo.
pause
goto MENU


:: ===============================================================================
:: SUBROUTINE: FREE PORTS
:: ===============================================================================
:FREE_PORTS
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 :8000"') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$pids = @(Get-NetTCPConnection -LocalPort 3000,8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($p in $pids) { if ($p -gt 0) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } }" >nul 2>&1
goto :eof


:: ===============================================================================
:: EXIT
:: ===============================================================================
:EXIT_SCRIPT
cls
echo.
echo ===============================================================================
echo   Thank you for using OpenResearch!
echo ===============================================================================
echo.
echo Services will continue running in background if not explicitly stopped.
echo You can run this launcher at any time to manage or stop them.
echo.
pause
exit /b 0
