# OpenResearch

> **Open-Source AI Academic Research & Writing Assistant**  
> A privacy-first, local-first platform for literature discovery, grounded research analysis, and academic writing.

---

## Architecture & Tech Stack

- **Backend API**: FastAPI (Python 3.11+), SQLAlchemy, Pydantic v2, PostgreSQL + pgvector (or SQLite for local dev), Redis, GROBID, Ollama.
- **Frontend App**: Next.js 16 App Router, React 19, TipTap Editor, Tailwind CSS, Lucide icons.
- **Packages**: Monorepo managed with npm workspaces:
  - `@openresearch/editor`: TipTap academic editor with citation inline nodes and ghost-text extensions.
  - `@openresearch/citations`: CSL-style formatting, BibTeX parsing, and citation serializers.
  - `@openresearch/ai`: LLM integration, prompt templates, and streaming clients.
  - `@openresearch/research`: Academic provider adapters (OpenAlex, Semantic Scholar, ArXiv, Crossref).
  - `@openresearch/tokens`: Design tokens and theming primitives.
  - `@openresearch/plugins`: AGPL-3.0 boundary plugin management system.

---

## Prerequisites

- **Node.js**: `v20.11.0` or higher (see `.nvmrc`)
- **Python**: `3.11` or higher
- **Docker & Docker Compose**: (Optional, for full-stack self-hosted containerization)

---

## Quickstart Guide

### 1. Clone & Set Up Environment

```bash
git clone https://github.com/openresearch-org/openresearch.git
cd OpenResearch

# Copy environment templates
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

### 2. Run with Docker Compose (Self-Host)

To start the complete stack (Web, API, PostgreSQL with pgvector, Redis, GROBID, Ollama)
use the provided near-one-command installer, which generates a `.env.selfhost`
with random `SECRET_KEY` and `REDIS_PASSWORD` and verifies the stack:

```bash
# Linux/macOS:
./infrastructure/install.sh
# Windows (PowerShell):
powershell -ExecutionPolicy Bypass -File infrastructure\install.ps1
```

For a manual run you must first create `infrastructure/.env.selfhost` from
`infrastructure/.env.selfhost.example` and set a unique `SECRET_KEY` (>= 32 chars)
and `REDIS_PASSWORD`, then:

```bash
docker compose -f infrastructure/docker-compose.selfhost.yml --env-file infrastructure/.env.selfhost up -d --build
```

- Web App: `http://localhost:3000`
- API & Interactive Docs: `http://localhost:8000/api/v1/docs`

---

### 3. Local Development Setup

#### Backend (FastAPI)

```bash
cd apps/api

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start API dev server
uvicorn app.main:app --reload --port 8000
```

#### Frontend (Next.js)

```bash
# From repository root
npm install

# Start Next.js development server
npm run dev:web
```

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `development` | `development`, `production`, or `test`. |
| `SECRET_KEY` | *(dev key)* | JWT secret key. Must be ≥32 characters in production. |
| `DATABASE_URL` | `sqlite:///./openresearch_dev.db` | SQLAlchemy database URL. |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis instance URL. |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed CORS origins. |
| `UPLOAD_DIR` | `./storage/uploads` | Path to store uploaded PDFs. |
| `MAX_UPLOAD_SIZE_MB` | `50` | Maximum uploaded file size in MB. |
| `GROBID_URL` / `GROBID_HOST` | `http://localhost:8070` | GROBID full-text extraction service. |
| `OLLAMA_BASE_URL` / `OLLAMA_HOST` | `http://localhost:11434` | Ollama LLM endpoint. |
| `OLLAMA_MODEL` | `llama3.2:3b` | Default Ollama model used for completions. |
| `TABBY_BASE_URL` / `TABBY_MODEL` / `TABBY_AUTOCOMPLETE_ENABLED` | `http://localhost:8080` / `Qwen2.5-Coder-1.5B` / `false` | Inline autocomplete server (off by default). |
| `LLM_TIMEOUT_SECONDS` | `20` | LLM request timeout in seconds. |
| `LLM_MAX_CONTEXT_CHARS` / `LLM_MAX_TOKENS` | `12000` / `1200` | LLM context size / max output tokens. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_MINUTES` | `1440` / `43200` | JWT token lifetimes in minutes. |
| `LOGIN_RATE_LIMIT_MAX_REQUESTS` / `REGISTER_RATE_LIMIT_MAX_REQUESTS` | `10` / `20` | Auth rate limits per window. |
| `ALLOWED_DEV_ORIGINS` | *(empty)* | Comma-separated extra origins allowed by the Next.js dev server. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api/v1` | Public API endpoint for Web client. |

---

## Testing & Quality Gates

### Backend Test Suite
```bash
cd apps/api
pytest
```

### TypeScript Validation
```bash
npm run typecheck --workspaces --if-present
```

### Linting
```bash
npm run lint --workspaces --if-present
```

---

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)](LICENSE).
