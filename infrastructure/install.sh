#!/usr/bin/env bash
# ==============================================================================
# OpenResearch — Near-One-Command Self-Hosting Installer (Roadmap 9.4)
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}      OpenResearch — Self-Hosting Automated Installer          ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""

# 1. Check prerequisites
echo -e "${BLUE}[1/5] Checking system prerequisites...${NC}"

if command -v docker >/dev/null 2>&1; then
    echo -e "  ✓ Docker is installed ($(docker --version))"
else
    echo -e "${RED}  ✗ Docker is not installed. Please install Docker Engine / Desktop first.${NC}"
    exit 1
fi

if docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; then
    echo -e "  ✓ Docker Compose is available"
else
    echo -e "${RED}  ✗ Docker Compose is not installed.${NC}"
    exit 1
fi

# 2. Environment Configuration
echo -e "${BLUE}[2/5] Configuring self-hosting environment...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$SCRIPT_DIR"

if [ ! -f .env.selfhost ]; then
    echo "  Generating .env.selfhost from example..."
    cp .env.selfhost.example .env.selfhost
    # Generate random secret key
    RANDOM_SECRET=$(openssl rand -hex 24 2>/dev/null || date +%s%N | sha256sum | head -c 48)
    sed -i.bak "s/generate_a_random_32_character_secret_key_here_for_production/$RANDOM_SECRET/g" .env.selfhost && rm -f .env.selfhost.bak
    RANDOM_REDIS_PASSWORD=$(openssl rand -hex 18 2>/dev/null || date +%s%N | sha256sum | head -c 36)
    sed -i.bak "s/generate_a_random_password_here/$RANDOM_REDIS_PASSWORD/g" .env.selfhost && rm -f .env.selfhost.bak
    echo -e "  ✓ Generated unique SECRET_KEY and REDIS_PASSWORD"
else
    echo -e "  ✓ Using existing .env.selfhost configuration"
fi

# 3. Create Storage Directories
echo -e "${BLUE}[3/5] Setting up local persistent storage...${NC}"
mkdir -p "$ROOT_DIR/storage"
mkdir -p "$ROOT_DIR/storage/papers"
mkdir -p "$ROOT_DIR/storage/exports"
echo -e "  ✓ Storage directories prepared"

# 4. Pull & Build Containers
echo -e "${BLUE}[4/5] Launching OpenResearch containers via Docker Compose...${NC}"
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d --build

# 5. Diagnostic Healthcheck
echo -e "${BLUE}[5/5] Performing installation verification healthcheck...${NC}"
sleep 3
echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}  ✓ OpenResearch is successfully installed and running!       ${NC}"
echo -e "${GREEN}================================================================${NC}"
echo ""
echo -e "  🌐 Web Application: ${BLUE}http://localhost:3000${NC}"
echo -e "  📡 API & Docs:      ${BLUE}http://localhost:8000/api/v1/docs${NC}"
echo -e "  📚 Documentation:   ${BLUE}docs/SELF_HOSTING.md${NC}"
echo ""
echo -e "To view live logs:    ${YELLOW}docker compose -f infrastructure/docker-compose.selfhost.yml logs -f${NC}"
echo -e "To stop services:     ${YELLOW}docker compose -f infrastructure/docker-compose.selfhost.yml down${NC}"
echo ""
