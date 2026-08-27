# ==============================================================================
# OpenResearch — Near-One-Command Self-Hosting Installer for Windows (PowerShell)
# Self-hosting installer (roadmap 9.4)
# ==============================================================================

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "      OpenResearch — Windows Self-Hosting Automated Installer   " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Prerequisite Checks
Write-Host "[1/5] Checking system prerequisites..." -ForegroundColor Cyan

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $dockerCmd) {
    Write-Host "  ✗ Docker Desktop is not installed or not in PATH." -ForegroundColor Red
    Write-Host "  Please install Docker Desktop from https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "  ✓ Docker is available: $((docker --version))" -ForegroundColor Green
}

# 2. Environment Configuration
Write-Host "[2/5] Configuring self-hosting environment..." -ForegroundColor Cyan
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
Set-Location $ScriptDir

$EnvFile = Join-Path $ScriptDir ".env.selfhost"
$EnvExample = Join-Path $ScriptDir ".env.selfhost.example"

if (-not (Test-Path $EnvFile)) {
    Write-Host "  Generating .env.selfhost from template..." -ForegroundColor Gray
    Copy-Item $EnvExample $EnvFile
    $RandomBytes = New-Object byte[] 24
    (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($RandomBytes)
    $RandomSecret = ($RandomBytes | ForEach-Object { "{0:x2}" -f $_ }) -join ''
    (Get-Content $EnvFile) -replace "generate_a_random_32_character_secret_key_here_for_production", $RandomSecret | Set-Content $EnvFile
    $RandomRedisBytes = New-Object byte[] 18
    (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($RandomRedisBytes)
    $RandomRedisPassword = ($RandomRedisBytes | ForEach-Object { "{0:x2}" -f $_ }) -join ''
    (Get-Content $EnvFile) -replace "generate_a_random_password_here", $RandomRedisPassword | Set-Content $EnvFile
    Write-Host "  Generated unique SECRET_KEY and REDIS_PASSWORD" -ForegroundColor Green
} else {
    Write-Host "  ✓ Using existing .env.selfhost configuration" -ForegroundColor Green
}

# 3. Create Storage Directories
Write-Host "[3/5] Setting up local persistent storage..." -ForegroundColor Cyan
$StorageDir = Join-Path $RootDir "storage"
$PapersDir = Join-Path $StorageDir "papers"
$ExportsDir = Join-Path $StorageDir "exports"

New-Item -ItemType Directory -Force -Path $StorageDir | Out-Null
New-Item -ItemType Directory -Force -Path $PapersDir | Out-Null
New-Item -ItemType Directory -Force -Path $ExportsDir | Out-Null
Write-Host "  ✓ Storage directories prepared: $StorageDir" -ForegroundColor Green

# 4. Launch Docker Compose Stack
Write-Host "[4/5] Launching OpenResearch containers via Docker Compose..." -ForegroundColor Cyan
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d --build

# 5. Verification Summary
Write-Host "[5/5] Performing verification check..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

Write-Host "================================================================" -ForegroundColor Green
Write-Host "  ✓ OpenResearch is successfully installed and running!       " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  🌐 Web Application: http://localhost:3000" -ForegroundColor Cyan
Write-Host "  📡 API & Docs:      http://localhost:8000/api/v1/docs" -ForegroundColor Cyan
Write-Host "  📚 Documentation:   docs/SELF_HOSTING.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "To view live container logs:  docker compose -f infrastructure/docker-compose.selfhost.yml logs -f" -ForegroundColor Yellow
Write-Host "To stop the stack:            docker compose -f infrastructure/docker-compose.selfhost.yml down" -ForegroundColor Yellow
Write-Host ""
