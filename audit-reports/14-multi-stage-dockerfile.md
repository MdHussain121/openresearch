# Infrastructure Audit: Multi-Stage Dockerfile & Containerization Review

**Audit ID:** 14-multi-stage-dockerfile
**Scope:** OpenResearch monorepo (`C:\Users\moham\Pictures\OpenResearch`) — read-only assessment
**Method framework:** `multi-stage-dockerfile` skill (stage separation, base images, layer optimization, security practices, performance)
**Date:** 2026-08-26
**Auditor mode:** READ-ONLY — no repository files were modified during this audit.

---

## Scope & Methodology

### Files reviewed (exhaustive)

| Area | Files |
|---|---|
| Container images | `infrastructure/Dockerfile.api`, `infrastructure/Dockerfile.web` |
| Orchestration | `infrastructure/docker-compose.yml`, `infrastructure/docker-compose.selfhost.yml` |
| Env templates | `infrastructure/.env.selfhost.example`, `apps/api/.env`, `apps/api/.env.example` |
| Build context | `.dockerignore` |
| Dev environment | `.devcontainer/devcontainer.json` |
| CI/CD | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| App config consumed by containers | `apps/web/next.config.js`, `apps/web/package.json`, root `package.json`, `apps/api/pyproject.toml`, `apps/api/requirements.txt`, `apps/api/requirements.lock` |
| Runtime behavior | `apps/api/app/main.py`, `apps/api/app/core/config.py`, `apps/api/alembic/env.py`, `apps/api/app/api/v1/endpoints/health.py`, `apps/web/src/lib/api/client.ts` |
| Launchers / installers | `start_openresearch.cmd`, `run.cmd`, `infrastructure/install.sh`, `infrastructure/install.ps1`, `infrastructure/healthcheck.py` |
| Documentation | `docs/SELF_HOSTING.md` |
| Persistence layout | `storage/uploads/`, `apps/api/openresearch_dev.db*`, gitignore / git-tracking status |

### Methodology

1. Full enumeration of `infrastructure/` (confirmed: **no k8s manifests, no nginx configs, no helm charts, no scripts/ subdirectory exist** — the directory contains exactly 8 files plus `__pycache__`).
2. Line-by-line evaluation of both Dockerfiles against the skill checklist: stage separation, base image choice/pinning, layer caching order, non-root USER, multi-arch, HEALTHCHECK, secret handling, image bloat.
3. Cross-validation of Compose env-var plumbing against actual code consumption points (`config.py`, `client.ts`, `alembic/env.py`) rather than trusting variable names.
4. Verification of Next.js `output: 'standalone'` alignment with `Dockerfile.web` artifact paths (standalone dir, static dir, public dir).
5. Build-context simulation: matched every pattern in `.dockerignore` against files actually present in the tree (`apps/api/.env`, `*.db-wal`, `*.db-shm`, `web.log`, `coverage/`, `audit-reports/`, `Starting`) to detect leaks/bloat.
6. Launcher scripts traced control-flow-by-control-flow for error handling and path assumptions; installer scripts diffed against each other for parity.
7. Documentation claims in `docs/SELF_HOSTING.md` checked against compose volumes, container names, service count, and filesystem reality.
8. Git tracking status verified for sensitive artifacts (`git ls-files`: none tracked — good), and dependency-lock composition inspected for dev/prod separation.

---

## Containerization Inventory

### What EXISTS

| Artifact | Status | Notes |
|---|---|---|
| `Dockerfile.api` (FastAPI) | Present | **Single-stage**; slim base; non-root; HEALTHCHECK; lockfile-first caching |
| `Dockerfile.web` (Next.js) | Present | True 3-stage (deps → builder → runner); alpine; standalone output; non-root; **no HEALTHCHECK; missing public/ copy** |
| `docker-compose.yml` (dev) | Present | Infra-only: postgres(pgvector)/redis/grobid — **contains NO app services** |
| `docker-compose.selfhost.yml` | Present | 6 services: web, api, db, redis, grobid, ollama; required-secrets via `:?err`; named volumes; loopback binding for stateful services |
| `.env.selfhost.example` | Present | Ports/secrets/db/AI/GROBID/storage coverage |
| Installers | Present | `install.sh` (bash, `set -e`) + `install.ps1` (PS 5.1-compatible); auto-generate SECRET_KEY |
| Diagnostic script | Present | `healthcheck.py`; GROBID/Ollama soft-pass by design |
| CI docker job | Present | Builds both images on every push/PR via buildx (no push, no scan, single-platform) |
| Devcontainer | Present | TS-node bullseye + Python 3.11 feature + docker-in-docker; 6 forwarded ports |
| `.dockerignore` | Present | 57 lines; covers `.git`, node_modules, caches, root `.env`, `*.db` |
| Standalone Next.js output | Configured | `next.config.js:4` `output: 'standalone'` — aligns with runner COPY paths |
| Startup DB migrations | Implemented | `app/main.py:56` runs Alembic upgrade/stamp in FastAPI lifespan |
| Production SQLite guard | Implemented | `config.py:105-109` hard-fails on production+sqlite |
| Compromised-secret denylist | Implemented | `config.py:9-13` rejects known default keys |

### What is MISSING

| Missing item | Impact |
|---|---|
| Multi-stage `Dockerfile.api` | Build tools (`build-essential`, `libpq-dev`, `curl`) ship in production runtime |
| `public/` copy in `Dockerfile.web` runner | `apps/web/public/logo.svg` exists but is absent from runtime image → 404 |
| Build-time `ARG NEXT_PUBLIC_API_URL` | Runtime-only injection of `NEXT_PUBLIC_*` is inert for client bundle (H-3) |
| HEALTHCHECK for web (image + compose) | Web readiness never gated |
| One-shot migration step/service | Migrations run per-worker lifespan → race when `WEB_CONCURRENCY > 1` (M-2) |
| Resource limits in all compose files | GROBID `-Xmx4g` unbounded vs docs' 4 GB minimum hosts |
| Log rotation (`max-size`) in compose | Unbounded json-file growth on long-running hosts |
| Image scanning (trivy/grype), multi-arch builds, registry push, layer cache in CI | Supply-chain / release gaps |
| k8s / nginx / helm / scripts directories | Do not exist anywhere in repo — deployment story is Compose-only |
| Digest-pinned base images | All `FROM` lines tag-only; `ollama/ollama:latest` fully floating |
| Dependabot `docker` ecosystem entry | Dockerfiles/compose images never auto-updated |
| Prod/dev split of Python lock | Dev/test toolchain ships in prod image (H-6) |
| `init: true` / tini in compose services | Signal hygiene left to app defaults (compounds M-1) |

---

## Executive Summary

The containerization story is materially better than typical hobby-scale monorepos: the web image is a genuine, mostly-correct 3-stage build aligned with `output: 'standalone'`; both images drop privileges to UID/GID 1001; self-host compose requires strong secrets at up-time (`${SECRET_KEY:?…}`), binds stateful services to loopback, persists uploads in a named volume, and the API self-migrates at boot with a production SQLite ban. However, the API image is the weak sibling — it is **single-stage**, ships its compiler toolchain *and* the entire dev/test toolchain from an undivided lock file, and its shell-form CMD breaks signal delivery. Several cross-cutting wiring defects mean the stack only works in the exact default configuration: `NEXT_PUBLIC_API_URL` is injected at the wrong lifecycle phase, CORS origins are frozen to port 3000, the web image loses its `public/` directory, the Windows launcher's "Docker mode" launches the wrong compose file, and the official backup procedure archives a directory that no container reads.

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 7 |
| MEDIUM | 15 |
| LOW | 12 |
| INFO | 7 |

**Deployment readiness verdict:** Self-hostable today on localhost with defaults; not yet robust for LAN/domain deployment, size-sensitive hosting, or long-running operational use until H-1…H-7 and M-1…M-5 are addressed.

---

## Detailed Findings

Severity scale: CRITICAL (data loss/security breach/deployment impossible) › HIGH (broken functionality, significant bloat/attack surface, misleading guarantees) › MEDIUM (degrades ops, latent race/portability/reproducibility issues) › LOW (hygiene, polish, doc nits) › INFO (observation).

### HIGH

---

#### H-1 · Dockerfile.api is single-stage; compiler toolchain and libpq-dev persist in the production image

- **File:** `infrastructure/Dockerfile.api:1-10`
- **Excerpt:**
  ```dockerfile
  FROM python:3.11-slim
  ...
  RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libpq-dev \
      curl \
      && rm -rf /var/lib/apt/lists/*
  ```
- **Evidence of unnecessary weight:** `apps/api/requirements.lock:97` pins `psycopg2-binary==2.9.12`. The `-binary` distribution ships manylinux wheels with libpq bundled — no compilation and no system libpq are required. Every other runtime dependency in the lock (fastapi, sqlalchemy, pdfminer.six via pdfplumber, python-docx, reportlab, pypdf, bcrypt ≥4, pyjwt, redis, httpx) also publishes CPython 3.11 bookworm wheels. Nothing in the lock requires gcc.
- **Consequence:** `build-essential` alone drags gcc/g++/make (~250–320 MB installed) into every deployed container. Combined with dev tooling from H-6, the final image is roughly 2–2.5× larger than necessary (est. ~600 MB vs ~250–300 MB achievable). More surface = more CVE scanner noise and slower pulls on the "lab server" targets the self-hosting guide advertises.
- **Skill violations:** "Remove build tools and unnecessary packages from the final image"; "Use a separate runtime stage that only includes what's needed to run."
- **Fix:** Adopt the two-stage reference design in [Reference Dockerfiles](#reference-dockerfiles): build wheels in a builder stage, install into a pristine slim runtime. Drop `curl` by switching HEALTHCHECK to a stdlib-python probe.

---

#### H-2 · Dockerfile.web runner never copies `public/` — static assets silently 404 in production

- **Files:** `infrastructure/Dockerfile.web:44-45`; `apps/web/public/logo.svg` (exists on disk)
- **Excerpt:**
  ```dockerfile
  COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
  COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
  ```
- **Problem:** With `output: 'standalone'` (`apps/web/next.config.js:4`), Next.js intentionally excludes `public/` from the standalone bundle; canonical production Dockerfiles copy it explicitly. The repo has a public asset (`logo.svg`), the builder context contains it (`COPY . .`, line 25), and the runner throws it away. Any UI reference to `/logo.svg` returns 404 from the container while working in dev.
- **Fix:** Add between the existing COPYs:
  ```dockerfile
  COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
  ```

---

#### H-3 · `NEXT_PUBLIC_API_URL` is plumbed at RUNTIME but Next.js inlines it at BUILD time — non-localhost deployments break

- **Files:** `infrastructure/docker-compose.selfhost.yml:12-14`; `infrastructure/Dockerfile.web:22-30`; `apps/web/src/lib/api/client.ts:1`
- **Excerpts:**
  ```yaml
  environment:
    - NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:8000/api/v1}
  ```
  ```ts
  export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
  ```
- **Problem:** `NEXT_PUBLIC_*` variables are textually inlined into client JS during `next build`. The Docker builder stage runs the build **without the variable set**, so the shipped bundle permanently bakes the fallback `http://localhost:8000/api/v1`. Setting it on the runner container affects only server-side reads (none found for this constant) and does nothing for browsers. Any user browsing from another machine (LAN IP, Tailscale hostname, reverse-proxy domain) gets a browser calling *its own* localhost:8000 — the classic Next.js containerization failure.
- **Compounding factor:** M-9 (CORS origins likewise frozen).
- **Fix:**
  1. In `Dockerfile.web` **builder** stage add:
     ```dockerfile
     ARG NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
     ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
     ```
  2. Wire through Compose `build.args`.
  3. Document rebuild-on-change, or serve runtime config via a Next route handler.

---

#### H-4 · Windows launcher "Docker Compose Mode" starts the WRONG compose project

- **File:** `start_openresearch.cmd:305-315`
- **Excerpt:**
  ```bat
  echo -> Starting: web (:3000), api (:8000)
  cd /d "%ROOT_DIR%"
  docker compose -f infrastructure\docker-compose.yml up --build
  ```
- **Problem:** `infrastructure/docker-compose.yml` defines ONLY postgres/redis/grobid — no `web` or `api` services exist in it (those live solely in `docker-compose.selfhost.yml`). The menu promises "Automatically builds and spins up multi-container deployment" (lines 33-35) and the banner prints `Starting: web (:3000), api (:8000)` immediately before launching a stack that cannot contain them. Users selecting option 4 get three idle infra containers, no application, and a foreground-blocking attach.
- **Fix:** Target `infrastructure\docker-compose.selfhost.yml`, generate `.env.selfhost` first (reuse installer logic), correct the banner, and label the two modes distinctly ("infra deps only" vs "full self-host stack").

---

#### H-5 · Self-hosting backup/restore instructions archive a directory the containers never use

- **File:** `docs/SELF_HOSTING.md:90-106`
- **Excerpt:**
  ```
  All user data, papers, and embeddings reside in persistent Docker volumes:
  - openresearch_storage: Uploaded PDF files, extracted metadata...
  tar -czvf storage_backup_$(date +%F).tar.gz storage/
  ```
- **Problem:** Uploads live in the named volume `openresearch_storage` mounted at `/app/storage` (`docker-compose.selfhost.yml:35-36`). The host-side `storage/` directory created by both installers (`install.sh:56-58`, `install.ps1:46-52`) is mounted by nothing and stays empty forever. Following the documented procedure "restores" an empty folder while real user PDFs would be lost with the volume — directly undermining the doc's §34a data-sovereignty claim.
- **Fix:** Document volume-based backup:
  ```bash
  docker run --rm -v openresearch-selfhost_openresearch_storage:/src -v "$PWD":/dst alpine \
    tar -czf /dst/storage_backup_$(date +%F).tar.gz -C /src .
  ```
  (note compose-project prefix on the volume name), and either drop the host mkdir steps or bind-mount that directory so host/container agree.

---

#### H-6 · `requirements.lock` bundles dev/test tooling into the production API image

- **Files:** `apps/api/requirements.lock:38,75,118,125,141`; consumer `infrastructure/Dockerfile.api:13-14`
- **Evidence:** lock contains `coverage==7.15.4`, `mypy==2.3.1`, `pytest==9.1.1`, `pytest-cov==7.1.0`, `ruff==0.16.4` plus transitive dev deps (pytest-asyncio, pluggy, mypy_extensions...). `pyproject.toml:31-38` correctly models these as optional `[dev]` extras, but there is only ONE lock and it feeds the prod image.
- **Consequence:** pytest/mypy/ruff/coverage binaries installed in every deployed container — ~60–100 MB dead weight and widened attack surface. CI masks this because it *wants* dev tools (`ci.yml:53-78` installs the same lock then runs ruff/mypy/pytest).
- **Fix:** Split into `requirements.lock` (runtime only) + `requirements-dev.lock` (CI/devcontainer); regenerate with `uv pip compile` / `pip-compile` per group. Dockerfile keeps installing only the prod lock; CI installs both.

---

#### H-7 · `apps/api/.env` enters the Docker build context and is baked into the production image

- **Files:** `.dockerignore:42-47`; `infrastructure/Dockerfile.api:17` (`COPY apps/api /app/apps/api`); artifact `apps/api/.env`
- **Excerpt (.dockerignore):**
  ```
  # Environment and Secrets
  .env
  .env.local
  .env.*.local
  *.pem
  *.key
  ```
- **Problem:** Dockerignore patterns are context-root-relative: `.env` matches ONLY `<root>/.env`. The nested `apps/api/.env` (present on disk, untracked by git — verified) is NOT excluded and is copied verbatim into every image. Today its contents are benign placeholders (`SECRET_KEY=openresearch_dev_secret_key_change_in_production_32bytes`, sqlite DSN), but this is the *live* config file developers edit — the first real credential placed there ships silently into published images. It also injects sqlite guidance into a container whose production validator bans sqlite (`config.py:105-109`) — confusion payload with zero upside.
- **Adjacent leak (same root cause):** `openresearch_dev.db-wal` / `-shm` do not match `*.db` (suffix differs), so partial local-DB artifacts ride along in context/image while the main `.db` is correctly excluded — inconsistent hygiene.
- **Fix (defense in depth):** add to `.dockerignore`:
  ```
  **/.env
  !**/.env.example
  *.db-wal
  *.db-shm
  *.log
  coverage
  audit-reports
  Starting
  ```
  And switch `Dockerfile.api` from directory-wide `COPY apps/api` to explicit allowlisting (`app/`, `alembic/`, `alembic.ini`) — which also stops shipping `tests/`, `api.log`, `.coverage`, `.pytest_cache` residue (see M-8).

### MEDIUM

---

#### M-1 · Shell-wrapped CMD prevents SIGTERM from reaching uvicorn (10 s forced kills, no graceful drain)

- **File:** `infrastructure/Dockerfile.api:36`
- **Excerpt:**
  ```dockerfile
  CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-1}"]
  ```
- **Problem:** Despite JSON-list form, the payload runs via `sh -c`, making `sh` PID 1 and uvicorn its child. POSIX `sh` does not forward signals, so `docker stop` burns the full grace period then SIGKILLs mid-request — defeating uvicorn's graceful shutdown and the lifespan cleanup at `main.py:62` (`close_http_client`).
- **Fix:** `CMD ["sh", "-c", "exec uvicorn ..."]` (`exec` replaces the shell), or resolve the env default in an ENTRYPOINT script and use a pure exec form. Optionally add `init: true` in compose.

---

#### M-2 · Alembic migrations run once per worker — race condition when `WEB_CONCURRENCY > 1`

- **Files:** `apps/api/app/main.py:53-62` + `21-39`; `infrastructure/Dockerfile.api:36`
- **Problem:** `_run_migrations()` is invoked inside FastAPI's lifespan, which executes in **every** uvicorn worker process. With `--workers N > 1` on a fresh database, N workers concurrently run `alembic upgrade head`; alembic takes no distributed lock, so workers can collide on DDL/`alembic_version` writes (intermittent "table already exists" / duplicate-version crashes depending on timing). Default `WEB_CONCURRENCY=1` masks it; scaling exposes it.
- **Also note:** the pre-Alembic fallback stamps an unknown-schema DB to `head` without running anything (`main.py:36-37`) — safe only if legacy schemas exactly match head.
- **Fix:** Run migrations exactly once per deployment: a dedicated compose one-shot (`api-migrate`) before `api` with `restart: "no"` and `depends_on: api: condition: service_completed_successfully`, or an ENTRYPOINT guard using a Postgres advisory lock (`pg_advisory_lock`). Keep lifespan free of DDL.

---

#### M-3 · No resource limits anywhere; GROBID's `-Xmx4g` can OOM hosts meeting only the documented minimum

- **Files:** `infrastructure/docker-compose.selfhost.yml` (all services), `infrastructure/docker-compose.yml`; docs minimum RAM 4 GB (`docs/SELF_HOSTING.md:25`)
- **Problem:** Neither compose file sets `mem_limit`/`cpus` (or `deploy.resources.limits`). GROBID alone is configured to allow a 4 GB JVM heap; combined with Postgres, Redis, Ollama (which loads multi-GB model weights), API, and web, a 4 GB host will be OOM-killed under load — with the kernel picking victims unpredictably.
- **Fix:** Add per-service limits, e.g.:
  ```yaml
  grobid: { mem_limit: 5g, cpus: '2.0' }
  ollama: { mem_limit: 8g }   # document GPU alternative
  db:     { mem_limit: 1g }
  redis:  { mem_limit: 256m }
  api/web:{ mem_limit: 1g }
  ```

---

#### M-4 · Floating/unpinned base images; no digest pinning; `ollama:latest` worst offender

- **Files:** `Dockerfile.api:1` (`python:3.11-slim`), `Dockerfile.web:1` (`node:20-alpine`), compose images `pgvector/pgvector:pg16`, `redis:7-alpine`, `lfoppiano/grobid:0.8.0`, `ollama/ollama:latest`
- **Problem:** Skill guidance: "Specify exact version tags to ensure reproducible builds." Tags here are mutable ranges or floating latest; two builds weeks apart can produce materially different runtime behavior/CVE profiles. `ollama:latest` can change inference behavior overnight for self-hosters who re-pull.
- **Fix:** Pin minor tags as a floor (`python:3.11.9-slim-bookworm`, `node:20.18-alpine3.20`, `ollama/ollama:0.5.x`) and ideally add digest pinning (`image@sha256:...`) maintained by Dependabot (add the `docker` ecosystem — see L-7). Grobid's `0.8.0` is the only properly pinned tag.

---

#### M-5 · `install.ps1` omits `--build`, silently serving stale images on upgrade

- **Files:** `infrastructure/install.ps1:57` vs `infrastructure/install.sh:63`
- **Excerpt:**
  ```powershell
  docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d      # ps1: NO --build
  docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d --build   # sh: has it
  ```
- **Problem:** First run builds because no image exists; every subsequent run after pulling code updates reuses the old cached `openresearch-selfhost-web/api` images with zero indication. Windows self-hosters (a first-class audience given the launcher investment) get stale apps.
- **Fix:** Add `--build` to the PS1 invocation (parity), or use `up -d --build` in both plus a version stamp/log line showing built image digests.

---

#### M-6 · Web service has no HEALTHCHECK (neither in image nor compose); nothing gates web readiness

- **Files:** `infrastructure/Dockerfile.web` (absent), `docker-compose.selfhost.yml:4-17`
- **Problem:** The API image defines HEALTHCHECK and `web.depends_on.api.condition: service_healthy` works off it — but the web container itself reports healthy from the instant it starts. Reverse proxies, restart orchestration, and `docker compose ps` all treat a crashed-looping Next server identically to a healthy one until connections fail.
- **Fix:** Node 20 ships global `fetch`; add to runner stage:
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node","-e","fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  ```

---

#### M-7 · Redis password exposed via container command line

- **File:** `infrastructure/docker-compose.selfhost.yml:65`
- **Excerpt:**
  ```yaml
  command: ["redis-server", "--requirepass", "${REDIS_PASSWORD:?...}"]
  ```
- **Problem:** The secret becomes part of the container config visible to anyone with Docker API access via `docker inspect` / `docker ps --no-trunc`, and appears in some process listings inside the container. On single-user self-hosts the blast radius is modest, but this is the repo's flagship "secure by default" file and the pattern teaches badly.
- **Fix (progressive):** least effort — pass via env + `REDISCLI_AUTH` healthcheck already present, start server passwordless and rely on network isolation; better — mount an ACL file from a secret; best — Compose secrets (`secrets: redis_pass: file: ./secrets/redispass` + `--requirepass $(cat /run/secrets/redis_pass)` entrypoint).

---

#### M-8 · Production image ships tests, logs, coverage residue and dev artifacts via directory-wide COPY

- **Files:** `infrastructure/Dockerfile.api:17`; artifacts observed: `apps/api/tests/**`, `apps/api/api.log`, `apps/api/.coverage`, `apps/api/.env.example`, `apps/api/openresearch_dev.db-*`
- **Problem:** `COPY apps/api /app/apps/api` is unfiltered beyond `.dockerignore`. Combined with H-6/H-7, the deployed image contains the full pytest suite, local logs, coverage data, WAL fragments. Beyond bloat, `tests/` in prod images invites accidental execution against production data and leaks internal route names.
- **Fix:** Allowlist copies:
  ```dockerfile
  COPY apps/api/app ./app
  COPY apps/api/alembic ./alembic
  COPY apps/api/alembic.ini .
  ```

---

#### M-9 · CORS origins frozen to localhost:3000 — custom ports/LAN break browser↔API calls

- **Files:** `apps/api/app/core/config.py:36-39`; `docker-compose.selfhost.yml:27-34` (no CORS_ORIGINS passed)
- **Problem:** `CORS_ORIGINS` defaults to `[http://localhost:3000, http://127.0.0.1:3000]` and the self-host compose never overrides it. A user setting `WEB_PORT=8080` (explicitly supported via `${WEB_PORT:-3000}`) gets a web origin of `http://localhost:8080` that the API rejects for credentialed requests — while H-3 has already broken the API URL itself.
- **Fix:** Pass `CORS_ORIGINS=http://localhost:${WEB_PORT:-3000},http://127.0.0.1:${WEB_PORT:-3000}` (plus optional extra origins var) into the api service environment.

---

#### M-10 · CI docker job builds but does not scan, cache, validate compose, or produce multi-arch output

- **File:** `.github/workflows/ci.yml:80-104`
- **Gaps:**
  1. No vulnerability scan of produced images (trivy-action/grype) despite npm/pip audit steps existing for deps — inconsistent supply-chain posture.
  2. No `cache-from/to: type=gha` → both images rebuild cold every push (~minutes wasted).
  3. No `platforms: linux/amd64,linux/arm64` even though both bases are multi-arch and the docs target Apple Silicon labs — nothing verifies arm64 actually builds (e.g., wheel availability).
  4. No `docker compose -f infrastructure/docker-compose.selfhost.yml config -q` sanity gate; a broken interpolation string would ship unnoticed.
  5. Images are never pushed/tagged immutably — every deploy rebuilds from source (acceptable for source-distribution model, but then CI should at least export/save artifacts for smoke-testing).
- **Fix:** Add trivy step with SARIF upload; enable GHA cache; add a `qemu/setup-buildx` multi-arch build job (build-only, no push); add compose-config validation step.

---

#### M-11 · `.dockerignore` gaps admit logs, coverage, audit reports, and odd root files into build context

- **File:** `.dockerignore` (whole file); offending tree items: `web.log` (480 B, root), `apps/api/api.log`, `coverage/`, `audit-reports/`, `Starting`, `tsconfig.tsbuildinfo` (covered), `web.log` pattern absent (`*.log` missing entirely)
- **Problem:** `docs/audits/` and `report/` are excluded but `audit-reports/` (this very report family!) is not — every future audit lands in the web builder context. `coverage/` (root vitest output) also enters. Individually small; collectively they bloat context transfer time and risk leaking internal paths/reports into published builder layers (builder stages aren't shipped in final images, but context contents do affect cache keys and layer metadata).
- **Fix:** Append `*.log`, `coverage`, `coverage/`, `audit-reports`, `.pytest_cache`, `htmlcov`, `Starting`.

---

#### M-12 · `FREE_PORTS` force-kills arbitrary processes on ports 3000/8000 with no identification

- **File:** `start_openresearch.cmd:383-388`
- **Excerpt:**
  ```bat
  for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 :8000"') do (
      if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
  )
  ```
- **Problem:** Any unrelated process listening on those ports (another dev server, an IDE live-reload, Discord's web services historically) is terminated without prompt or name disclosure. The netstat filter also matches remote-address columns (`findstr ":3000"` hits foreign endpoints too), so outbound connections *to* port 3000/8000 cause the PIDs of innocent clients to be harvested and killed.
- **Fix:** Filter to LISTENING state (`netstat -aon | findstr "LISTENING" | findstr ":3000 :8000"`), print `tasklist /FI "PID eq %%a"` before killing, and require confirmation unless the PID belongs to a previously launched OpenResearch window (track PIDs at spawn).

---

#### M-13 · Devcontainer installs unpinned `requirements.txt` while CI/lock pin exact versions — environment drift

- **File:** `.devcontainer/devcontainer.json:70`
- **Excerpt:** `"postCreateCommand": "npm install && pip install -r apps/api/requirements.txt"`
- **Problem:** Three different dependency resolutions coexist: CI + Dockerfile use `requirements.lock` (exact pins incl. tooling), the devcontainer uses ranged `requirements.txt`, and pyproject declares its own (slightly divergent) floors (see L-6). Contributors can hit bugs CI never sees (e.g., newer transitive httpx behavior). Also `pip install` runs against the feature-managed interpreter whose exact path the settings assume (`/usr/local/bin/python`, plausible but unverified for the features/v2 layout).
- **Fix:** `pip install -r apps/api/requirements.lock` in postCreateCommand (lock includes dev tools today, which devcontainers want), and set `python.defaultInterpreterPath` after confirming the feature's symlink location.

---

#### M-14 · Self-host compose binds WEB/API ports to all interfaces while everything else is loopback-only

- **File:** `infrastructure/docker-compose.selfhost.yml:10-11,25-26`
- **Excerpt:** `- "${WEB_PORT:-3000}:3000"`, `- "${API_PORT:-8000}:8000"`
- **Problem:** db/redis/grobid/ollama are carefully bound to `127.0.0.1:` but web/api listen on `0.0.0.0` by default. For a product whose headline is sovereignty/local-first, silently exposing the API (with bearer-token auth, rate-limited but internet-reachable if the host has a public IP) to every interface is an avoidable posture gap. Given H-3/M-9, LAN exposure is currently broken anyway — so the open binding buys nothing today.
- **Fix:** Default to `127.0.0.1:${WEB_PORT:-3000}:3000` etc., documented override `BIND_IP=0.0.0.0` for intentional LAN serving (post-fixes H-3/M-9).

---

#### M-15 · Pre-existing local state shadows first-use volume semantics; storage dir ownership depends on implicit Docker behavior

- **Files:** `Dockerfile.api:20-24` (mkdir+chown of `/app/storage`), `docker-compose.selfhost.yml:35-36` (named volume over it)
- **Problem:** The design relies on Docker's named-volume-first-use copy-up preserving `apiuser:python` ownership from the image directory. That behavior holds for empty named volumes on vanilla Docker, but breaks subtly when: (a) the volume was created earlier by a root-running variant, (b) users switch to bind mounts (installers' `storage/` hints invite this), or (c) SELinux-enabled hosts remount labels. Result: EACCES on uploads with a confusing traceback. Not broken today; fragile by construction.
- **Fix:** Make it explicit and self-healing — entrypoint runs `mkdir -p "$UPLOAD_DIR"` and checks writability, failing with actionable message; or document `user: "1001:1001"` + chowned host dir recipe for bind mounts.

### LOW

---

#### L-1 · `version: '3.8'` in both compose files triggers obsolete-attribute warnings under Compose v2

- **Files:** `docker-compose.yml:1`, `docker-compose.selfhost.yml:1`
- **Problem/fix:** The field is ignored (with a warning) by Compose v2 and only meaningful to the legacy Python binary. Delete the line; nothing in these files requires v3-only semantics.

#### L-2 · No log rotation limits — long-running self-hosts fill disk via json-file driver

- **Files:** both compose files
- **Fix:** Add a default anchor:
  ```yaml
  x-logging: &default-logging
    driver: json-file
    options: { max-size: "10m", max-file: "3" }
  services:
    api: { logging: *default-logging, ... }
  ```

#### L-3 · Installers declare success before verifying container health

- **Files:** `install.sh:66-70` (`sleep 3` then success banner), `install.ps1:60-65`
- **Problem:** Postgres alone takes longer than 3 s to initialize on first run; API migrations add more. Users see green success while containers are still crash-looping (e.g., weak REDIS_PASSWORD rejected, port conflicts). Fix: poll `docker compose ps --format json` / curl `/api/v1/health` with timeout before banner; reuse `infrastructure/healthcheck.py` logic.

#### L-4 · `install.sh` final hints use wrong relative paths after `cd "$SCRIPT_DIR"`

- **File:** `install.sh:41,76-77`
- **Problem:** Script cds into `infrastructure/`, runs compose with `-f docker-compose.selfhost.yml` (correct), but prints post-install hints referencing `infrastructure/docker-compose.selfhost.yml` which only resolves from repo root — copy-pasting them from the infrastructure cwd fails. Cosmetic but guaranteed to bite. Fix: print absolute paths or cd back to `$ROOT_DIR` before hints.

#### L-5 · SECRET_KEY entropy fallback in `install.sh` is time-derived

- **File:** `install.sh:47`
- **Excerpt:** `RANDOM_SECRET=$(openssl rand -hex 24 2>/dev/null || date +%s%N | sha256sum | head -c 48)`
- **Problem:** Fallback is predictable (second/nanosecond timestamp hashed) if openssl is missing. Primary path is fine; fallback should use `/dev/urandom`: `head -c 24 /dev/urandom | sha256sum`. (`install.ps1` uses RNGCryptoServiceProvider — correct.)

#### L-6 · Dependency floors drift across `requirements.txt`, `pyproject.toml`, and lock

- **Files:** `requirements.txt:16-18` vs `pyproject.toml:21-23`
- **Evidence:** python-docx `>=1.2.0` vs `>=1.1.0`; pypdf `>=5.0.0` vs `>=4.2.0`; psycopg2/pgvector are hard deps of requirements.txt but optional `[postgres]` extras in pyproject. Three sources of truth invite drift; the lock currently wins everywhere that matters, so treat txt/pyproject as docs and reconcile or delete one.

#### L-7 · Dependabot lacks the `docker` ecosystem

- **File:** `.github/dependabot.yml`
- **Fix:** Add `- package-ecosystem: "docker", directory: "/infrastructure"` (and compose images once digest-pinned per M-4) so base-image bumps arrive as PRs.

#### L-8 · Web runner stage lacks `libc6-compat` present in deps/builder stages

- **File:** `Dockerfile.web:1,5,33`
- **Problem:** Only the `deps` stage installs libc6-compat; builder and runner inherit bare alpine. Next/SWC ship musl binaries and sharp has musl prebuilds, so this usually works — but glibc-dependent native addons (a likely future plugin need) would fail at runtime with an opaque loader error. Cheap insurance: `RUN apk add --no-cache libc6-compat` in runner too (official Next example does).

#### L-9 · `run.cmd` forwards `%*` but child ignores arguments

- **File:** `run.cmd:5`
- **Problem:** `start_openresearch.cmd` reads only interactive input; passed args silently vanish. Either document it as arg-less or accept a choice argument to jump straight to a menu option.

#### L-10 · Launcher dependency failures degrade to warnings and proceed

- **File:** `start_openresearch.cmd:138-139,152-153`
- **Problem:** npm/pip install failures print "[WARNING] ... attempting to proceed" then continue to launch windows that immediately die, confusing users ("two black boxes flashed"). Acceptable UX trade-off for a launcher, but at minimum capture failure state and surface it on the SERVICE_DASHBOARD.

#### L-11 · `healthcheck.py` needs host-side `requests`; not stated in docs

- **Files:** `docs/SELF_HOSTING.md:110-115`, `infrastructure/healthcheck.py:9`
- **Problem:** Fresh hosts running `python infrastructure/healthcheck.py` hit ModuleNotFoundError. Use stdlib `urllib.request`, or document `pip install requests`, or invoke it inside the api container where requests exists.

#### L-12 · `next.config.js` hardcodes a personal LAN IP

- **File:** `apps/web/next.config.js:5` — `allowedDevOrigins: ['192.168.1.6']`
- **Problem:** Developer-specific address committed to shared config; meaningless to everyone else and mildly fingerprinting. Move to env-driven value.

---

### INFO

---

#### I-1 · No Kubernetes/nginx/helm assets exist anywhere

The audit brief asked to check k8s/nginx directories — verified absent (glob across repo). Deployment story is exclusively Docker Compose. If cluster deployment is roadmap-relevant, that's net-new work; otherwise no action.

#### I-2 · pgvector image selected but pgvector extension unused

`chunk.py:29` stores embeddings as JSON arrays "for cross-engine compatibility"; no migration issues `CREATE EXTENSION vector` (grep-verified) and no `Vector(...)` columns exist. `pgvector/pgvector:pg16` works fine as plain Postgres, but SELF_HOSTING.md's claim that vectors reside in pgdata oversells it. Either adopt real vector columns/indexes (HNSW) or downgrade to `postgres:16` to shrink pull size.

#### I-3 · `.env` files are never auto-loaded by the API app

`config.py` uses raw `os.getenv` defaults plus pydantic-settings **without** `env_file` (no `load_dotenv` anywhere — grep-verified), and the launcher starts uvicorn without `--env-file`. `apps/api/.env` is effectively dead documentation today; behavior equals config defaults. This makes H-7 purely a leak-hygiene issue rather than a functional one, but also means editing `.env` does nothing — worth documenting to prevent user confusion.

#### I-4 · Docs quickstart clone URL appears to be a placeholder

`docs/SELF_HOSTING.md:36` clones `github.com/openresearch/openresearch` — verify against the real canonical repo before release.

#### I-5 · Health endpoint performs DB+Redis probes — good liveness signal, slight DoS-ish cost

`app/api/v1/endpoints/health.py:12-54` returns 503 when components unhealthy, making the Dockerfile HEALTHCHECK genuinely meaningful (not just TCP-alive). Note interval=30s × retries=3 keeps probe load trivial; no change needed.

#### I-6 · Multi-arch support is implicit-only

Both bases publish arm64 manifests, so local builds on Apple Silicon succeed — but nothing tests/produces arm64 in CI (see M-10.3) and no images are published at all, so every self-host compiles locally. Consistent with source-distribution model; just be aware "supports Apple Silicon" is currently untested assumption.

#### I-7 · Root `web.log` / `Starting` artifacts indicate launcher/debug residue committed-adjacent to context

Untracked but present in build context (see M-11); harmless content-wise (verified tiny text files) — cleanup candidates.

## Reference Dockerfiles

The following are **recommended designs only** — nothing in the repo was modified. They resolve H-1, H-2, H-3, H-6, H-7, M-1, M-2 (via compose snippet), M-6, M-8.

### Recommended `infrastructure/Dockerfile.api` (multi-stage, wheel-build → slim runtime)

```dockerfile
# syntax=docker/dockerfile:1

########## Stage 1: builder — compile/download wheels ##########
# Pin minor+patch tag; optionally append @sha256:<digest> and let Dependabot bump it.
ARG PYTHON_VERSION=3.11.9
FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

# Lockfile copied FIRST for layer-cache hits on code changes (skill: caching order).
# requirements.lock must be the RUNTIME-only lock after H-6 split.
COPY apps/api/requirements.lock ./requirements.lock

# Wheels for psycopg2-binary etc. need no compiler; if a future dep does,
# add build-essential HERE ONLY — it never reaches runtime.
RUN pip wheel --wheel-dir /wheels -r requirements.lock

########## Stage 2: runtime — minimal, non-root, signal-safe ##########
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime

# No curl, no gcc, no libpq-dev. Healthcheck uses stdlib urllib.
RUN groupadd --system --gid 1001 python \
 && useradd --system --uid 1001 --gid python --home-dir /app apiuser

WORKDIR /app/apps/api

COPY --from=builder /wheels /tmp/wheels
RUN pip install --no-cache-dir --no-compile /tmp/wheels/*.whl \
 && rm -rf /tmp/wheels \
 && mkdir -p /app/storage \
 && chown -R apiuser:python /app/storage

# Allowlisted source copies — no tests/, no .env, no logs (H-7, M-8).
COPY --chown=apiuser:python apps/api/app ./app
COPY --chown=apiuser:python apps/api/alembic ./alembic
COPY --chown=apiuser:python apps/api/alembic.ini ./alembic.ini

USER 1001:1001

ENV PYTHONPATH=/app/apps/api \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000 \
    WEB_CONCURRENCY=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys;\
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health',timeout=4).status==200 else 1)"]

# `exec` promotes uvicorn to PID 1 -> SIGTERM lands directly (M-1).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY}"]
```

**Companion compose fragment for once-per-deploy migrations (fixes M-2):**

```yaml
  api-migrate:
    build:
      context: ..
      dockerfile: infrastructure/Dockerfile.api
    env_file: .env.selfhost
    environment:
      ENVIRONMENT: production
      DATABASE_URL: postgresql://...@db:5432/...
      REDIS_URL: redis://...   # health endpoint not used here; migrations only need DB
    command: ["python", "-c",
      "import os,alembic.config as c; cfg=c.Config('alembic.ini');\
cfg.set_main_option('script_location','alembic');\
import sqlalchemy as sa; e=sa.create_engine(os.environ['DATABASE_URL']);\
insp=sa.inspect(e); t=set(insp.get_table_names());\
from alembic import command;\
command.stamp(cfg,'head') if ('alembic_version' not in t and t) else command.upgrade(cfg,'head')"]
    depends_on:
      db: { condition: service_healthy }
    restart: "no"

  api:
    ...
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
      api-migrate: { condition: service_completed_successfully }
```

(With this in place, `_run_migrations()` in the lifespan can be downgraded to a no-op-in-production safety check.)

### Recommended `infrastructure/Dockerfile.web` (corrected runner + build-time public URL)

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20.18-alpine3.20 AS base
RUN apk add --no-cache libc6-compat          # present in ALL stages now (L-8)

########## deps ##########
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ai/package.json            ./packages/ai/
COPY packages/citations/package.json     ./packages/citations/
COPY packages/editor/package.json        ./packages/editor/
COPY packages/plugins/package.json       ./packages/plugins/
COPY packages/research/package.json      ./packages/research/
COPY packages/tokens/package.json        ./packages/tokens/
COPY packages/ui/package.json            ./packages/ui/
COPY packages/browser-extension/package.json ./packages/browser-extension/
RUN npm ci

########## builder ##########
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# H-3 fix: bake the client-visible API URL at BUILD time.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build --workspace=@openresearch/web

########## runner ##########
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public    ./apps/web/public   # H-2 fix

USER nextjs
EXPOSE 3000

# M-6 fix: real HTTP readiness probe using Node 20's global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/web/server.js"]
```

**Compose wiring for both images:**

```yaml
  web:
    build:
      context: ..
      dockerfile: infrastructure/Dockerfile.web
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:8000/api/v1}
    environment:
      - NODE_ENV=production
    ports:
      - "${BIND_IP:-127.0.0.1}:${WEB_PORT:-3000}:3000"   # M-14 fix
    mem_limit: 1g                                        # M-3 fix
    logging: *default-logging                            # L-2 fix
```

---

## Positive Observations

Worth preserving explicitly — these are above-baseline practices found during review:

1. **Genuine multi-stage web image** (`Dockerfile.web`) with correctly separated deps/builder/runner and workspace-package.json-only pre-copy for maximal npm cache hits (`Dockerfile.web:8-19`).
2. **`output: 'standalone'` is configured and matches the Dockerfile's artifact paths exactly** — standalone dir, nested static path, and CMD all line up (`next.config.js:4`, `Dockerfile.web:44-45,51`).
3. **Non-root enforcement in both images**, with matching UID/GID 1001 and `--chown` on COPY rather than post-hoc chown layers.
4. **Fail-fast secret policy**: `${SECRET_KEY:?…}` / `${REDIS_PASSWORD:?…}` interpolation errors abort compose before any container starts; plus a runtime denylist of known-compromised default keys and a length validator (`config.py:90-110`).
5. **Production SQLite prohibition** enforced at settings-validation time — a rare, thoughtful guard against silent data-loss foot-guns.
6. **Loopback binding of stateful services** (postgres/redis/grobid/ollama) in self-host compose.
7. **Upload persistence via named volume** mounted at `/app/storage`, consistent across Dockerfile mkdir, config default override, and compose.
8. **Automatic Alembic migration at startup** with legacy-stamp fallback logic and unit tests covering its branches — the most common self-host failure mode (empty DB) is already handled for single-worker deployments.
9. **Lockfile-first layer order** in `Dockerfile.api` (lock copied and installed before source) — correct cache discipline per the skill.
10. **Real HEALTHCHECK semantics**: `/api/v1/health` probes database AND Redis and returns 503 on component failure, so the Docker healthcheck reflects actual service health.
11. **CI builds both images on every PR** via buildx — container regressions can't merge silently; plus pip-audit/npm audit gates.
12. **`.dockerignore` already excludes `.git`, node_modules, caches, root `.env`, and dev databases** — better than most first drafts.
13. **Windows launcher is unusually robust for batch**: auto venv bootstrap, broken-venv detection, docker daemon preflight, `docker-compose` legacy-syntax fallback, port cleanup subroutine, and delayed-expansion done mostly correctly.
14. **Installer parity intent** (sh + ps1) with automatic cryptographically-random SECRET_KEY generation on first run.

---

## Prioritized Recommendations

Ordered by risk-reduction-per-effort. IDs reference findings above.

| # | Action | Fixes | Effort | Priority |
|---|---|---|---|---|
| 1 | Add `public/` COPY to web runner stage | H-2 | 1 line | P0 |
| 2 | Point launcher Option 4 at `docker-compose.selfhost.yml` (+ env generation) | H-4 | ~15 lines | P0 |
| 3 | Add `ARG/ENV NEXT_PUBLIC_API_URL` to web builder + compose `build.args` | H-3 | ~5 lines | P0 |
| 4 | Rewrite `Dockerfile.api` per reference (multi-stage, drop build tools, exec CMD, stdlib healthcheck) | H-1, M-1, M-8 | ~40 lines | P0 |
| 5 | Expand `.dockerignore` (`**/.env`, `*.db-wal/-shm`, `*.log`, `coverage`, `audit-reports`) | H-7, M-11 | ~8 lines | P0 |
| 6 | Split `requirements.lock` into prod/dev locks; repoint CI & devcontainer | H-6, M-13 | medium (regen) | P1 |
| 7 | Correct SELF_HOSTING.md backup/restore to target named volumes; remove dead host `storage/` steps or bind-mount it | H-5 | doc | P1 |
| 8 | Move migrations out of worker lifespan → one-shot compose service or advisory-lock entrypoint | M-2 | medium | P1 |
| 9 | Pass `CORS_ORIGINS` derived from `WEB_PORT` into api env; document rebuild-on-change for public URL | M-9, H-3 residue | small | P1 |
| 10 | Add `--build` parity to `install.ps1`; verify health before success banner in both installers | M-5, L-3 | small | P1 |
| 11 | Compose hardening pass: resource limits, log rotation anchor, `BIND_IP` loopback defaults, web HEALTHCHECK, pin ollama/base tags (+ digests later), delete obsolete `version:` lines | M-3, M-4, M-6, M-14, L-1, L-2 | medium | P1 |
| 12 | CI upgrade: trivy scan (SARIF), GHA layer cache, arm64 build job, `docker compose config -q` gate | M-10 | medium | P2 |
| 13 | Make `FREE_PORTS` identify processes and require confirmation; restrict to LISTENING entries | M-12 | small | P2 |
| 14 | Redis password off the CLI (ACL/secret file); keep `:?` requirement | M-7 | small | P2 |
| 15 | Dependabot `docker` ecosystem; reconcile requirements.txt vs pyproject floors; decide pgvector-vs-json direction; misc doc/L fixes (L-4..L-12) | L-4…L-12, I-2 | small each | P3 |

**Bottom line:** two focused PRs — one rewriting `Dockerfile.api` + `.dockerignore`, one fixing web build args/public copy + compose wiring — eliminate every HIGH finding. The remaining work is operational polish that converts a working localhost demo into a defensible self-hosted product.

*End of report — generated read-only; no repository files were modified.*
