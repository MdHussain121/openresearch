# Project Portability & Cross-Device Audit — OpenResearch

**Date:** 2026-08-26
**Scope:** Full repository — `apps/api`, `apps/web`, `packages/*`, `infrastructure/`, root configs, docs, CI
**Method:** Static inspection of every manifest/config/script + **runtime verification executed on the audited machine** (results labeled accordingly). Docker was **not installed** on the audit machine, so all Docker findings are **static analysis only**.
**Companion report:** `CODEBASE_AUDIT.md` (2026-08-25) covers functional/auth integrity; this report covers portability, reproducibility, and cross-device readiness.

---

## Verification Log (runtime-verified on this machine)

| Check | Command | Result |
|---|---|---|
| Toolchain | `node -v` / `npm -v` / venv python | v24.14.0 / 11.9.0 / Python 3.11.15 |
| TS typecheck | `npm run typecheck` | ✅ PASS (all 8 workspaces) |
| Frontend tests | `npm test` (vitest) | ✅ 175/175 PASS |
| Production build | `npm run build` | ✅ PASS (Next.js 16.3.2 Turbopack, static export of 10 routes) |
| Backend lint | `ruff check .` | ✅ PASS |
| Backend types | `mypy app` | ✅ PASS (75 files) |
| Backend tests | `pytest` (as CI/README run it) | ❌ **FAIL** — 442/442 tests passed, but coverage gate failed: `91.47% < 94%`, non-zero exit |
| Backend tests | `pytest --no-cov` | ✅ 442/444… 442 passed, exit 0 |
| API boot smoke | `uvicorn app.main:app --port 8765` | ✅ boots, `/api/v1/health` → 200 (`redis: degraded`, served anyway) |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | ✅ 0 vulnerabilities |
| Git state | `git log`, `git remote -v` | ❌ **zero commits, no remote** |
| Docker | `docker info` | ⚠️ Not installed here → Dockerfile/compose findings are **not runtime-verified** |

---

## Executive Summary

**Can another developer currently clone this repo and run it? No — literally, they cannot even clone it.**

1. The git repository contains **zero commits and no remote**. Every file is untracked. A "clone" by another person yields an empty repository, and a disk failure loses the entire project.
2. Even if the tree were committed today, the two flagship "fresh start" paths are broken out of the box:
   - The **Docker self-host installer fails immediately**: `docker-compose.selfhost.yml` hard-requires `REDIS_PASSWORD` (`${REDIS_PASSWORD:?...}`), which is absent from *both* `.env.example` and `.env.selfhost.example`. Additionally, the API container runs with `ENVIRONMENT=production` while receiving the example `SECRET_KEY`, which `app/core/config.py:90-110` deliberately rejects → crash loop.
   - The **documented backend test command fails**: plain `pytest` exits non-zero because the coverage gate (`--cov-fail-under=94`) measures 91.47% in a clean environment (verified). CI's backend job will be red on the first push.
3. The backend **never reads `.env` files** despite README instructions to create them — no `python-dotenv`, no `env_file=` in `SettingsConfigDict`, no `--env-file` flag. Local dev works only because defaults happen to be correct. Any user who edits `apps/api/.env` (e.g., to point at Ollama) will observe **zero effect**.
4. The pure local-dev path (Node ≥20, Python 3.11, SQLite, no Redis/GROBID/Ollama) is genuinely solid once committed: install, typecheck, vitest, next build, ruff, mypy, and API boot were all verified green on Windows.

**Bottom line:** excellent local-dev hygiene undermined by four systemic portability defects: (a) nothing is committed, (b) required self-host secrets missing from templates, (c) `.env` mechanism inert, (d) environment-dependent coverage gate.

---

## Critical Issues

### C-1. Repository has zero commits and no remote — nothing is cloneable
- **Where:** `.git/` (HEAD = `ref: refs/heads/master`, no refs); `git status` shows every project file untracked; `git remote -v` empty.
- **Impact:** The premise "another person clones the repo" is unsatisfiable. No history, no backup, no CI trigger possible (CI workflow exists but can never run).
- **Also affected:** un-committable hygiene — `.gitignore` lacks `.mypy_cache/` and `.ruff_cache/`; stray junk file `Starting` (contains one line of accidental console output) would be committed by `git add .`.

### C-2. Self-host stack cannot start: `REDIS_PASSWORD` required but absent from every template
- **Where:**
  - `infrastructure/docker-compose.selfhost.yml:31` (`REDIS_URL=redis://:${REDIS_PASSWORD:?...}`), `:65` (redis command), `:73` (healthcheck env)
  - `infrastructure/.env.selfhost.example` — **no `REDIS_PASSWORD` key at all**
  - `.env.example` (root, used by README quickstart) — **no `REDIS_PASSWORD`**
  - `infrastructure/install.sh:43-52` and `infrastructure/install.ps1:32-42` generate `.env.selfhost` from that template and inject only `SECRET_KEY`
- **Impact:** Compose aborts before starting any container with `REDIS_PASSWORD must be set in your .env file`. Both "one-command" installers fail at step 4/5 on a fresh machine.

### C-3. Self-host API crash-loops: production secret validator vs. example key
- **Where:** `infrastructure/docker-compose.selfhost.yml:28` sets `ENVIRONMENT=production`; `:29` passes `SECRET_KEY` from `.env`; root `.env.example:13` ships `SECRET_KEY=openresearch_dev_secret_key_change_in_production_32bytes`, which is listed in `apps/api/app/core/config.py:9-13` `KNOWN_COMPROMISED_DEFAULT_SECRETS`; the validator at `config.py:90-104` raises at import time.
- **Impact:** A user who follows README §2 exactly (copy `.env.example` → `docker compose ... up --build`) gets an API container that dies instantly even after fixing C-2 with the example key. The failure message appears only in container logs, not in any doc.

### C-4. Documented `.env` configuration is completely inert for the backend
- **Where:**
  - `apps/api/app/core/config.py:16-112` — every setting uses `os.getenv(...)`; `SettingsConfigDict(case_sensitive=True, extra="ignore")` has **no `env_file`**
  - `requirements.txt` / `pyproject.toml` — `python-dotenv` not a dependency anywhere
  - `start_openresearch.cmd:204` starts uvicorn without `--env-file`
- **Impact:** README §"Environment Variables", `apps/api/.env.example`, and the launcher imply editing `.env` configures the app. It does not. Defaults mask this in dev (SQLite, localhost URLs), but any real customization (Ollama host, CORS origins, Postgres URL) silently doesn't apply. This also means C-3's fix "just change SECRET_KEY in .env" wouldn't work for local dev either.

### C-5. Backend test command fails on a fresh clone (coverage gate)
- **Where:** `apps/api/pyproject.toml:64-65` — `addopts = "--cov=app --cov-report=term-missing:skip-covered --cov-fail-under=94"`
- **Verified:** On this machine: 442/442 tests pass; total coverage **91.47%** → `pytest` exits 1. Biggest gap: `app/services/llm_service.py` at 56% (lines exercised only when live LLM providers respond).
- **Impact:** README §Testing (`cd apps/api && pytest`) reports failure to every new developer; `.github/workflows/ci.yml:69-72` runs the same command → permanent red CI. The author's launcher bypasses it with `--no-cov` (`start_openresearch.cmd:342`), hiding the problem locally. Coverage is environment-dependent (live Ollama/provider responses change it), so the gate is not reproducible across machines.

---

## High Priority Issues

### H-1. Duplicate React majors baked into the lockfile
- **Where (verified on disk):** root `node_modules/react` → **18.3.1**; `apps/web/node_modules/react` → **19.2.8**; `package-lock.json` persists this split. `npm ls` shows `@openresearch/editor` and `@openresearch/ui` peer-resolved against 18.3.1 while `@openresearch/web` declares `react ^19.2.8`.
- **Impact:** Currently passes (Next aliases react inside the app build; vitest runs package tests against root react 18), but any code path where editor/ui components render under the app's React 19 runtime risks hook/context mismatch errors. Deterministically reproduced by `npm ci` on every machine — a landmine, not a flake.
- **Fix:** Regenerate the lockfile with a single hoisted React (delete `node_modules` + lock, reinstall, verify `react` resolves once at 19.x), and consider adding `overrides` for react/react-dom.

### H-2. `NEXT_PUBLIC_API_URL` is applied at the wrong lifecycle stage in Docker
- **Where:** `infrastructure/Dockerfile.web:22-30` runs `npm run build` **without** `NEXT_PUBLIC_API_URL` (no ARG/ENV); `docker-compose.selfhost.yml:14` passes it only as a **runtime** env var. Next.js inlines `NEXT_PUBLIC_*` into client bundles at build time; `apps/web/src/lib/api/client.ts:1` falls back to `http://localhost:8000/api/v1`.
- **Impact:** Self-host deployments accessed from other machines/LAN names silently call `localhost:8000` in the browser → broken app. Works by coincidence only when browsing on the host itself.
- **Fix:** Add `ARG NEXT_PUBLIC_API_URL=...` + `ENV` before `npm run build` and pass it as a compose `build.args`.

### H-3. Wrong Node engine floor; `npm test` crashes on the documented minimum
- **Where:** root `package.json:11-14` declares `"node": ">=18.0.0"`; README §Prerequisites repeats "v18.0.0 or higher"; `vitest.config.ts:49-55` uses `import.meta.dirname` (**Node ≥20.11**); Next 16 requires modern Node; `.nvmrc` pins 20.
- **Impact:** A user on Node 18 (permitted by engines/README) gets a crash running `npm test` and possibly dev/build.
- **Fix:** Set `"node": ">=20.11.0"` (and npm ≥10) in engines + README.

### H-4. Machine-specific LAN IP hardcoded
- **Where:** `apps/web/next.config.js:5` — `allowedDevOrigins: ['192.168.1.6']` (the author's LAN IP; confirmed as the author's machine address in `web.log`).
- **Impact:** Meaningless on any other network; other users testing from phones/other devices hit dev-origin blocks.
- **Fix:** Read from env (`process.env.ALLOWED_DEV_ORIGINS?.split(',') ?? []`) or remove.

### H-5. Undeclared dependency breaks documented diagnostics script
- **Where:** `infrastructure/healthcheck.py:6` — `import requests`. `requests` appears in **neither** `apps/api/requirements.txt`, `requirements.lock`, nor `pyproject.toml` (it is present in the local venv only as a transitive artifact). It is also absent from `Dockerfile.api`'s image.
- **Impact:** `python infrastructure/healthcheck.py` — instructed by `docs/SELF_HOSTING.md:114` — raises `ModuleNotFoundError` in any clean environment/container.
- **Fix:** Rewrite with `httpx` (already a dependency) or stdlib `urllib.request`, or declare `requests`.

### H-6. README describes a different frontend than what ships
- **Where:** `README.md:11` — "Next.js 14 App Router, React 18"; actual: `next ^16.3.2`, `react ^19.2.8` (`apps/web/package.json:20-22`). Clone URLs also disagree between docs: `github.com/openresearch/openresearch` (README:35, SELF_HOSTING:36) vs `github.com/openresearch-org/openresearch` (CONTRIBUTING.md).
- **Impact:** New developers misjudge the framework version; clone instructions point to (at best) an inconsistent org name.
- **Fix:** Update README stack block; standardize the canonical repo URL.

---

## Medium Priority Issues

### M-1. `pip install ./apps/api` fails: pyproject references a nonexistent README
- **Where:** `apps/api/pyproject.toml:5` — `readme = "README.md"`, but `apps/api/` contains no README.md (directory listing verified).
- **Impact:** Any packaging flow (`pip install apps/api`, `-e .`, build tools honoring `[project]`) errors out. The documented `pip install -r requirements.txt` path is unaffected.

### M-2. Root `.env.example` mixes container paths into local-dev template
- **Where:** `.env.example:25` — `UPLOAD_DIR=/app/storage` (container path) while `apps/api/.env.example:24` correctly uses `./storage/uploads`. Combined with C-4 (env not loaded) this mostly confuses rather than breaks, but if C-4 is fixed naively, local dev would try to write `/app/storage` (fails on Windows, pollutes root on Linux/macOS).

### M-3. Config-name drift: Tabby port and Ollama model variables
- **Where:**
  - `TABBY_BASE_URL`: root `.env.example:35` says `9090`; `apps/api/.env.example:38` and `config.py:77` say `8080`.
  - `OLLAMA_DEFAULT_MODEL`: documented in `.env.selfhost.example:29` and `docs/SELF_HOSTING.md:86`; the code reads **`OLLAMA_MODEL`** (`config.py:73`). Setting the documented variable does nothing.

### M-4. Installers create host storage dirs that are never used
- **Where:** `install.sh:56-59` / `install.ps1:46-53` create `<root>/storage/{papers,exports}`; `docker-compose.selfhost.yml:36` mounts a **named volume** (`openresearch_storage:/app/storage`), not a bind mount. Users looking for their uploaded files on the host won't find them there; backup instructions in SELF_HOSTING.md §6 (`tar storage/`) back up an empty directory.

### M-5. `.gitignore` gaps allow cache/junk commits
- **Where:** `.gitignore` has no entries for `.mypy_cache/` or `.ruff_cache/` (both exist on disk under `apps/api/` and root); junk file `Starting` at root matches no rule.
- **Impact:** First `git add .` commits caches and garbage.

### M-6. Browser extension assumes default API port/host
- **Where:** `packages/browser-extension/manifest.json:9-11` — `host_permissions: ["http://localhost:8000/*"]`. Other ports/hosts require the user to approve optional host permissions interactively; not documented anywhere.

### M-7. Divergent duplicate CONTRIBUTING docs
- **Where:** root `CONTRIBUTING.md` (workflow-focused) vs `docs/CONTRIBUTING.md` (licensing/conduct) share a title/intro but differ in content and links — easy to update one and forget the other.

### M-8. Offline/air-gapped builds fail (Google Fonts at build time)
- **Where:** `apps/web/src/app/layout.tsx:2-24` — `next/font/google` (Inter, Source Serif 4, JetBrains Mono) fetched during `next build`.
- **Impact:** For a "local-first, fully sovereign" product (SELF_HOSTING.md positioning), building behind a firewall fails with a font-fetch error. Consider vendoring fonts or documenting the requirement.

### M-9. Windows-only primary launcher
- **Where:** `run.cmd` / `start_openresearch.cmd` are cmd/batch with PowerShell escapes; no equivalent `.sh` launcher. Linux/macOS users must hand-run each service per README §3 (which works — commands are portable — but there's parity gap: e.g., the automated verification suite option exists only on Windows).

---

## Low Priority Issues

- **L-1.** `.dockerignore:56-57` excludes `report/` and `docs/audits/` which don't exist; actual `audit-reports/` is *not* excluded.
- **L-2.** Mojibake artifacts (`�?"`) in several UTF-8 files: `packages/browser-extension/package.json` description, `apps/web/src/app/layout.tsx` metadata title, root/docs CONTRIBUTING intro, `infrastructure/healthcheck.py` output glyphs. Cosmetic; suggests a bad encoding round-trip.
- **L-3.** Root `package.json:15-18` overrides for `sharp`/`postcss`; `npm ls` shows leftover extraneous `@img/sharp-wasm32`/`@emnapi/runtime` — harmless but indicates override churn.
- **L-4.** `vitest.config.ts:22-27` demands **100%** lines/branches/functions/statements for packages — `npm run test:coverage` is brittle for contributors (not part of main flows).
- **L-5.** README Testing section doesn't mention the coverage gate at all; the only working invocation on a clean machine is `pytest --no-cov` or fixing coverage.
- **L-6.** `docs/OpenResearch_Spec.md`, roadmap etc. reference phase numbers without a map to the repo layout; minor onboarding friction.
- **L-7.** `web.log`, `tsconfig.tsbuildinfo`, `coverage/`, `.pytest_cache/` present locally (ignored, fine) — but confirm they're never force-added.

---

## Missing Dependencies

| File | Import/Usage | Missing Dependency | Required Version | Fix |
|---|---|---|---|---|
| `infrastructure/healthcheck.py:6` | `import requests` | `requests` (declared nowhere; absent from `Dockerfile.api` image) | any current 2.x | Rewrite with `httpx` (already declared) or add to a new `infrastructure` extra |
| `apps/api/app/services/*` (runtime import path) | `anyio`, `starlette` imported directly in app code | Declared only transitively (via fastapi/httpx) | — (resolved today) | Declare explicitly if imported directly; low risk while pinned by `requirements.lock` |
| `apps/web/src/components/modals/AiOutlineModal.tsx`, `apps/web/src/lib/api/documents.ts`, `versions.ts` | `from '@tiptap/core'` (phantom dependency — works only via npm hoisting through `@openresearch/editor`) | `@tiptap/core` not in `apps/web/package.json` | match editor's `^2.3.1` | Add explicit dependency or re-export through `@openresearch/editor` |
| `apps/web/src/lib/api/*.test.ts` | `vitest` imports | Provided by root devDep (hoisting) | — | Acceptable for workspace-local tests; optionally declare in web devDeps |
| `apps/api/pyproject.toml:5` | packaging metadata | `apps/api/README.md` (referenced file missing) | — | Add the file or drop the field |

No circular dependencies found (TS workspace graph is acyclic: citations ← ai/research ← ui/editor ← web). No case-sensitivity mismatches detected (`forceConsistentCasingInFileNames: true` in `tsconfig.base.json:8`, typecheck passes). Python import scan found no module missing from `requirements.txt`/lock for the app itself.

## Unused / Stale Declarations

- `OPENAI_API_KEY` / `OPENAI_API_BASE` documented in `infrastructure/.env.selfhost.example:32-33` are **never read by backend code** — provider keys are managed at runtime via the Settings UI and stored in `provider_keys.json` (`apps/api/app/services/provider_settings.py:110-133`). Documented-but-dead config.
- `REDIS_URL` is consumed, but Redis is strictly optional (in-memory fallbacks in `provider_cache_service.py`, `collaboration.py`; health reports "degraded" and keeps serving — verified).

---

## Environment Variables

Legend: Doc = documented in README/env examples. **Backend loads none of these from `.env` files (see C-4)** — OS env only.

| Variable | Where Used | Required? | Documentation Status | Recommended Fix |
|---|---|---|---|---|
| `ENVIRONMENT` | `config.py:20`, validators, rate limiter, docs gating | No (default `development`) | Documented | Load via dotenv/env_file |
| `SECRET_KEY` | JWT signing `config.py:26` | Prod: yes (≥32 chars, non-default) | Documented; **example value is rejected in prod mode** (C-3) | Generate in templates/installers |
| `DATABASE_URL` | `config.py:23`, `database.py` | No (SQLite default) | Documented | — |
| `REDIS_URL` | cache/collab/health | No (graceful fallback) | Documented | — |
| `CORS_ORIGINS` | `config.py:36-55` | No | Documented | — |
| `UPLOAD_DIR` | papers upload, provider-keys store parent dir | No | Documented; root example uses container path (M-2) | Align templates |
| `MAX_UPLOAD_SIZE_MB` | uploads | No | Documented | — |
| `GROBID_URL` / `GROBID_HOST` | pdf extraction | No (pdfplumber fallback) | Documented | — |
| `DEFAULT_LLM_PROVIDER` | LLM routing | No | Documented | — |
| `OLLAMA_BASE_URL` / `OLLAMA_HOST` | LLM service | No | Documented | — |
| `OLLAMA_MODEL` | LLM service `config.py:73` | No | **Undocumented** (docs mention nonexistent `OLLAMA_DEFAULT_MODEL`, M-3) | Fix docs |
| `TABBY_BASE_URL`, `TABBY_MODEL`, `TABBY_AUTOCOMPLETE_ENABLED` | tabby_setup_service | No (off by default) | Partially documented; port inconsistency (M-3) | Align |
| `LLM_TIMEOUT_SECONDS`, `LLM_MAX_CONTEXT_CHARS`, `LLM_MAX_TOKENS` | llm_service | No | **Not documented** | Add to README table |
| `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_MINUTES`, `LOGIN_RATE_LIMIT_*`, `REGISTER_RATE_LIMIT_*`, `PLUGIN_ALLOWED_MODULE_PREFIXES` | auth/plugins | No | **Not documented** | Add to README/apps/api example |
| `NEXT_PUBLIC_API_URL` | `client.ts:1` (build-time inline!) | No (localhost fallback) | Documented but Docker wiring broken (H-2) | Build ARG |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose db service | Docker: yes | Documented | — |
| `WEB_PORT`, `API_PORT` | compose ports | No | Documented | — |
| `REDIS_PASSWORD` | `docker-compose.selfhost.yml:31,65,73` | **Yes for selfhost** | ❌ **Missing from all templates** (C-2) | Add + auto-generate |
| `OPENAI_API_KEY`, `OPENAI_API_BASE` | **nothing** (dead) | No | Documented but unused | Remove or wire up |

**Secrets status:** `.env` (local) contains only local-service credentials (Postgres password, dev SECRET_KEY) — gitignored, not committed (and nothing is committed at all). No third-party API keys found in the tree. Provider keys entered via UI are stored **plaintext** in `provider_keys.json` under the upload-dir parent (`provider_settings.py:110-133`) — flagged in CODEBASE_AUDIT.md C-4; relevant to any multi-user deployment.

---

## Machine-Specific Dependencies

| Location | Item | Replacement |
|---|---|---|
| `apps/web/next.config.js:5` | Hardcoded LAN IP `192.168.1.6` in `allowedDevOrigins` | Env var (`ALLOWED_DEV_ORIGINS`) or remove |
| `start_openresearch.cmd` (entire) | Windows cmd/PowerShell-only interactive launcher; kills processes on ports 3000/8000 via `netstat`/`Get-NetTCPConnection` | Provide `scripts/dev.sh` equivalent; keep cmd as optional |
| `apps/api/app/services/tabby_setup_service.py:37-51,87+` | Windows winget/`LOCALAPPDATA` lookup for Tabby binary | Already platform-guarded (`os.name != "nt"` → None) — OK; just document feature is Windows-assisted |
| `infrastructure/Dockerfile.api` / compose files | Ports pinned to localhost-bound mappings `127.0.0.1:*` | Fine for local-first; make bind address configurable if remote access desired |
| `.env` (local, gitignored) | Author's Postgres password / keys | N/A — correctly excluded |

No absolute filesystem paths (`C:\Users\...`, `/home/...`, `/Users/...`) were found in tracked source/config — grep across all source/config extensions returned only the LAN IP above.

---

## Cross-Platform Issues

**Windows (primary, verified):** Everything green except plain `pytest` (C-5). Launcher is Windows-only. `chcp 65001`, `ping -n`, `taskkill` used appropriately inside cmd scripts.

**Linux/macOS (static analysis):**
- Backend: portable (paths via `pathlib`, no OS-specific calls outside guarded Tabby code; SQLite WAL pragmas fine). Uvicorn/pip flow in README includes correct POSIX activate variant.
- Frontend/build: portable; requires internet for Google Fonts at build time (M-8).
- `infrastructure/install.sh`: GNU/BSD-compatible (`sed -i.bak` works on both); `openssl rand` fallback present.
- Vitest config: `import.meta.dirname` needs Node ≥20.11 everywhere (H-3).
- Case sensitivity: mitigated by TS `forceConsistentCasingInFileNames`; alembic/import names consistent lowercase. Residual risk: none identified in reviewed files.
- File permissions: `install.sh` documents `chmod +x` (SELF_HOSTING:38). Good.
- No GPU/CUDA requirements anywhere — LLM inference is delegated to Ollama; hardware guidance lives in `docs/SELF_HOSTING.md:20-28` (RAM 4→32 GB, optional RTX-class GPU). Good.

**Docker (static):** Images pin `python:3.11-slim` and `node:20-alpine`; `pgvector/pgvector:pg16`, `redis:7-alpine`, `grobid 0.8.0`, `ollama:latest` (mutable tag — consider pinning). GROBID needs ~4 GB heap (`JAVA_OPTS=-Xmx4g`) — worth stating in hardware docs. Builds themselves **not runtime-verified** (no Docker on audit machine).

---

## Fresh-Clone Failure Points (simulated walkthrough)

Assuming C-1 is fixed (repo actually pushed):

1. **Clone** — ❌ impossible today (C-1). After push: clone URL inconsistent across docs (H-6).
2. **Install runtime** — ⚠️ README/engines admit Node 18, which breaks `npm test` (H-3). Python 3.11 requirement clear.
3. **Install deps** — ✅ `npm ci` reproduces lockfile (with the React 18/19 split, H-1); `pip install -r requirements.txt` complete for the app.
4. **Configure env** — ❌ copying either `.env*example` has **no effect on the backend** (C-4); selfhost templates miss required `REDIS_PASSWORD` (C-2); example `SECRET_KEY` is fatal in the production-mode container (C-3).
5. **Init DB/services** — ✅ automatic (Alembic migrations run in-app on startup, `main.py:21-39`; SQLite created on first boot — verified). Redis optional. Postgres/pgvector only needed for prod/selfhost.
6. **Download models/assets** — ✅ none required at rest; AI features degrade honestly until Ollama/model pulled (SELF_HOSTING §5 covers `ollama pull`; model name doc bug M-3). Tabby download is opt-in from Settings.
7. **Build** — ✅ `npm run build` verified (needs internet, M-8). Docker image builds not verified here.
8. **Start dev servers** — ✅ `uvicorn app.main:app` + `npm run dev:web` verified pattern (boot smoke test returned healthy response). Windows launcher also works.
9. **Production/selfhost server** — ❌ blocked by C-2/C-3; then H-2 (client bakes localhost API URL).
10. **Main functionality** — ✅ CRUD/uploads/citations/export/chat operate against SQLite without external services; AI features need Ollama or a key set via Settings UI (not env).

Also failing: `pytest` (C-5), `python infrastructure/healthcheck.py` (H-5), `pip install ./apps/api` (M-1).

---

## Recommended Project Structure (portability-driven suggestions only)

Minimal, targeted changes — no architectural rework:

```
├── scripts/
│   ├── dev.sh                  # NEW: POSIX twin of start_openresearch.cmd
│   └── healthcheck.py          # MOVE from infrastructure/ (uses httpx, no new dep)
├── apps/api/
│   ├── README.md               # NEW: satisfies pyproject readme + backend-specific docs
│   └── .env.example            # keep as the single source of truth
├── .env.example                # align with apps/api/.env.example (relative UPLOAD_DIR, add REDIS_PASSWORD)
├── infrastructure/
│   └── .env.selfhost.example   # add REDIS_PASSWORD; remove dead OPENAI_* keys
```

Plus: delete `Starting`; add `.mypy_cache/`, `.ruff_cache/`, `Starting`, `audit-reports/` handling to `.gitignore`; consolidate CONTRIBUTING docs.

---

## Reproducibility Score

| Dimension | Score | Rationale |
|---|---|---|
| Dependency reproducibility | **72** | Pinned `requirements.lock` (172 pkgs) + `package-lock.json`; marred by React 18/19 split (H-1), undeclared `requests`/`@tiptap/core` |
| Environment configuration | **35** | `.env` mechanism inert (C-4); required selfhost secret missing (C-2); prod trap on example key (C-3); several undocumented vars |
| Cross-platform compatibility | **74** | Core is cleanly cross-platform; Windows-only launcher; Node-floor lie; offline build gap |
| Documentation | **58** | Good structure/prereqs/hardware docs; stale stack versions, broken quickstart, wrong test guidance, dead vars |
| Build reliability | **82** | `next build`, typecheck, ruff, mypy, vitest all verified green; internet-dependent fonts; Docker builds unverified |
| Runtime reliability | **78** | Boots and serves with graceful degradation (verified); migrations automatic |
| Security | **50** | Good: no committed secrets, prod-secret validator, rate limits, npm audit clean. Bad: auth-bypass design (CODEBASE_AUDIT C-1), plaintext provider keys, default creds in templates |
| Deployment readiness | **30** | Selfhost path cannot start from shipped templates (C-2/C-3/H-2); no committed history |

### **Overall Cross-Device Readiness Score: 48 / 100**

(For the narrow "local dev on a normal machine" path after committing: ~75. For the advertised Docker self-host path: ~15.)

---

## Action Plan

| Priority | Issue | File(s) | Fix | Why It Matters |
|---|---|---|---|---|
| P0 | Zero commits/no remote | `.git/` | Clean junk (`Starting`), extend `.gitignore`, `git add .`, initial commit, add remote | Nothing else matters until the repo exists |
| P0 | Missing `REDIS_PASSWORD` | `.env.example`, `infrastructure/.env.selfhost.example`, `install.sh`, `install.ps1` | Add variable (auto-generate in installers like SECRET_KEY) | Selfhost stack aborts instantly |
| P0 | Prod secret trap | `.env.example`, `docker-compose.selfhost.yml` | Generate real SECRET_KEY in templates, or set `ENVIRONMENT=development` until user opts in, or document the validator behavior | API crash-loops following official instructions |
| P0 | Inert `.env` loading | `apps/api/app/core/config.py`, `requirements.txt` | Add `python-dotenv`; `SettingsConfigDict(env_file=".env")` (or uvicorn `--env-file`) | Makes ALL documented configuration real |
| P0 | Coverage gate fails fresh | `apps/api/pyproject.toml:65`, `ci.yml` | Drop `--cov-fail-under` from `addopts` (enforce in CI at realistic ~85–90%, excluding env-dependent modules) or raise covered paths | Every new dev + CI sees red on first run |
| P1 | React duplication | `package-lock.json` | Regenerate lockfile with single hoisted react@19; verify build/tests | Latent runtime breakage, deterministic |
| P1 | `NEXT_PUBLIC_API_URL` lifecycle | `Dockerfile.web`, `docker-compose.selfhost.yml` | Pass as build ARG/ENV before `next build` | Non-localhost self-host clients break |
| P1 | Node floor wrong | `package.json`, `README.md` | `engines.node >= 20.11.0` | Documented minimum crashes |
| P1 | Hardcoded LAN IP | `apps/web/next.config.js:5` | Env-driven or removed | Machine-specific config in source |
| P1 | `requests` undeclared | `infrastructure/healthcheck.py` | Port to `httpx` | Documented diagnostic crashes in clean envs |
| P2 | README stale/mismatched | `README.md` | Next 16/React 19; canonical clone URL; pytest caveat; document `LLM_TIMEOUT_SECONDS` etc. | Trust + correctness for newcomers |
| P2 | pyproject readme missing | `apps/api/` | Add README.md or drop field | Packaging flow broken |
| P2 | Template drift (Tabby/Ollama vars, UPLOAD_DIR) | both `.env*example`s, `SELF_HOSTING.md` | Single source of truth | Silent no-op configuration |
| P2 | Dead OPENAI_* env docs | `infrastructure/.env.selfhost.example` | Remove or implement | Misleading setup steps |
| P3 | gitignore caches/junk; `Starting` | `.gitignore` | Add `.mypy_cache/`, `.ruff_cache/`, `Starting` | Repo hygiene on first commit |
| P3 | Offline font fetch | `apps/web/src/app/layout.tsx` | Vendor fonts or document connectivity requirement | Air-gapped builds |
| P3 | Installer storage dirs misleading | `install.sh`/`install.ps1`, `SELF_HOSTING.md` | Bind-mount `./storage` or stop creating dirs | Backup docs match reality |
| P3 | Mojibake glyphs | multiple files | Re-save corrupted strings | Polish |

---

## Minimum Changes Required to Make This Portable

The genuinely necessary set for *clone → install → configure → build → run* on another machine:

1. **Commit and push the repository** (after adding `.mypy_cache/`, `.ruff_cache/` to `.gitignore` and deleting `Starting`). *(C-1)*
2. **Add `REDIS_PASSWORD`** to `.env.example` and `infrastructure/.env.selfhost.example`; have both installers generate it alongside `SECRET_KEY`. *(C-2)*
3. **Ensure a valid production `SECRET_KEY` path**: either auto-generate it wherever `ENVIRONMENT=production` is templated (compose/installers), or stop hardcoding `ENVIRONMENT=production` in `docker-compose.selfhost.yml`. *(C-3)*
4. **Make `.env` actually load**: add `python-dotenv` and `env_file=".env"` to `SettingsConfigDict` (or pass `--env-file` in all launch paths). *(C-4)*
5. **Unblock `pytest`**: remove `--cov-fail-under=94` from `[tool.pytest.ini_options].addopts` (keep coverage reporting; enforce a realistic threshold in CI only). *(C-5)*
6. **Regenerate `package-lock.json`** so a single React (19.x) resolves tree-wide. *(H-1)*
7. **Pass `NEXT_PUBLIC_API_URL` as a Docker build arg** in `Dockerfile.web`/compose. *(H-2)*
8. **Bump `engines.node` to `>=20.11.0`** (and README). *(H-3)*
9. **Remove `192.168.1.6`** from `apps/web/next.config.js`. *(H-4)*
10. **Replace `requests` with `httpx`** in `infrastructure/healthcheck.py`. *(H-5)*

Items 1–5 are prerequisites for *any* external user; items 6–10 prevent the first week of predictable breakage. Everything else in this report is hardening.

---

*Findings above were verified against the working tree on 2026-08-26. Commands marked "verified" were executed on Windows 11 / Node 24.14 / Python 3.11.15. Docker-based findings are static-analysis only (Docker unavailable on the audit machine).*
