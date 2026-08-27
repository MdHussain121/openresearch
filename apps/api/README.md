# OpenResearch API

FastAPI backend for OpenResearch: an open-source, privacy-first AI academic
research & writing assistant.

## Setup

Requires Python 3.11+.

```bash
cd apps/api
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

Configuration is read from `apps/api/.env` (see `.env.example`) plus the
process environment. A `.env` file at this directory is loaded automatically
on startup via pydantic-settings; OS environment variables take precedence.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

API docs: <http://localhost:8000/api/v1/docs>.

## Test

```bash
pytest
ruff check .
mypy app
```

Migrations run automatically on startup (see `app/main.py`); `alembic.ini`
configures Alembic for manual migration work.
