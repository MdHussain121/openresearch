# Contributing to OpenResearch

Thank you for contributing to **OpenResearch** â€” the open-source, privacy-first AI academic research & writing assistant.

For licensing terms, architecture principles, and community guidelines, see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). This document focuses on the day-to-day development workflow.

---

## 1. Development Workflow

### Prerequisites

| Tool     | Version  | Notes                                  |
| -------- | -------- | -------------------------------------- |
| Node.js  | >= 20.11 | See `.nvmrc`                        |
| npm      | >= 10    | Workspaces-based monorepo           |
| Python   | >= 3.11  | See `.python-version`                  |
| Docker   | optional | For Postgres + pgvector, Redis, GROBID |

### Initial Setup

```bash
git clone https://github.com/openresearch-org/openresearch.git
cd OpenResearch

# Frontend / monorepo dependencies
npm install

# Backend dependencies
cd apps/api
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Environment configuration
cp .env.example .env             # repo root
cp apps/api/.env.example apps/api/.env
```

### Running Locally

```bash
npm run dev:web        # Next.js app on http://localhost:3000
cd apps/api && uvicorn app.main:app --reload   # FastAPI on http://localhost:8000
```

API docs are auto-generated at `http://localhost:8000/docs` (OpenAPI/Swagger).

---

## 2. Quality Gates

All pull requests must pass CI (`.github/workflows/ci.yml`):

```bash
# Frontend (monorepo root)
npm run typecheck        # tsc --noEmit in every workspace package
npm run lint             # ESLint (Next.js apps & packages)
npm test                 # Vitest unit tests (thresholds in vitest.config.ts apply to a narrow include list)

# Backend (apps/api/)
ruff check .             # Lint (zero violations allowed)
mypy app                 # Static type checking
pytest                   # Test suite (--cov-fail-under=93 enforced via pyproject.toml)
```

**Coverage policy:** backend targets >= 93% line coverage via `pytest-cov` (`pyproject.toml`).
Frontend vitest.config.ts defines thresholds (100% lines/functions/branches/statements) over
a narrow include list (citations, research, ai, plugins, UI src, editor extensions);
the broader `apps/web/src` components are NOT currently gated. Extending frontend coverage
gates to cover the full web app is a known gap.

**Note:** `npm run test:coverage` (mentioned in older docs) is not run in CI â€” only `npm test`
is. The coverage thresholds in vitest.config.ts apply only when the `--coverage` flag is
present, which CI does not currently pass.

CI also enforces: mypy type checking, npm audit, pip-audit, and Docker build verification
(see ci.yml for the full gate list).

Pre-commit hooks (`.pre-commit-config.yaml`) automatically run ruff and formatting checks on staged files.

---

## 3. Code Style Guidelines

### TypeScript / React (`apps/web`, `packages/*`)

- **Strict typing only.** Zero `any` in API client layers; prefer discriminated unions over loose object shapes.
- **Modern syntax:** ES2022 target; use `catch (error: unknown)` with a `getErrorMessage()` helper rather than `catch (err: any)`.
- Shared UI primitives live in `packages/ui` and use Radix UI + CVA variants. Do not hand-roll modals, dropdowns, popovers, tabs, or tooltips.
- Colors, spacing, and typography come from `@openresearch/tokens` design tokens â€” never hard-code hex values.
- All interactive elements must satisfy WCAG 2.1 AA: visible focus rings, keyboard navigation, min 36â€“44px touch targets.

### Python (`apps/api`)

- **Python 3.11+ style:** modern typing (`list[str]`, `X | None`), no legacy `typing.List`.
- `ruff check .` must pass with zero violations before pushing.
- Async endpoints must not perform blocking I/O or synchronous DB calls on the event loop.
- Use intention-revealing variable names; no single-letter identifiers outside trivially obvious comprehensions.
- SQLAlchemy models use 2.0-style `Mapped[]` / `mapped_column()` declarations.
- Keep files under ~500 lines and functions under ~50 lines; decompose god-functions into focused helpers.

### Commit Messages & Pull Requests

1. Create a feature branch from `develop`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. Keep commits atomic with imperative subjects (`Add pagination to citations endpoint`).
3. PRs must include: what changed, why, how it was tested, and any migration notes.
4. Ensure CI is green before requesting review; reviewers verify coverage deltas, type safety, and accessibility compliance.

---

## 4. Testing Guidance

- **Frontend:** co-locate unit tests as `*.test.ts` next to the source; add compile-time assertions in `*.test-d.ts` for public types. Tests run via Vitest (`npx vitest run`).
- **Backend:** tests live in `apps/api/tests/` using an in-memory SQLite database with dependency overrides. Name files by domain (`test_phase7_export.py`) and cover both success paths and authorization failure paths.
- When fixing a bug, always add a regression test that reproduces it first.

---

## 5. Reporting Issues

Open a GitHub issue with: expected behavior, actual behavior, minimal reproduction steps, environment details, and (for security issues) see [docs/SECURITY.md](docs/SECURITY.md) for responsible disclosure.
