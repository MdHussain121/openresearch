# Production Code Audit — OpenResearch Monorepo

**Audit date:** 2026-08-26
**Auditor:** Read-only production-readiness deep scan (`production-code-audit` methodology, AUDIT ONLY — no files modified)
**Repo:** `C:\Users\moham\Pictures\OpenResearch`
**Stack:** FastAPI + SQLAlchemy 2 + Alembic (apps/api), Next.js 15 App Router standalone (apps/web), TS packages/*, Docker Compose self-host stack (infrastructure/)
**Note:** The repository currently has **zero git commits** ("your current branch 'master' does not have any commits yet") — everything below refers to the working tree as the de-facto initial release candidate.

---

## Scope & Methodology

### What was scanned
- **Backend (apps/api/app/**):** every module read line-by-line for critical paths: `main.py`, `core/` (config, database, middleware, rate_limit, http_client), `services/auth.py`, `services/rag_service.py` (900 lines), `services/llm_service.py` (593 lines), `services/pdf_extractor.py`, `services/provider_settings.py`, `services/provider_cache_service.py`, `services/plugin_runtime.py`, `services/tabby_setup_service.py`, `services/ai_writing_service.py`, `services/graph_service.py`, all 19 API endpoint routers under `api/v1/endpoints/`, all 12 models, `schemas/models.py`.
- **Migrations:** `alembic/env.py` and all four revisions in `alembic/versions/` chain-verified (`ec9eb70fcc96` → `180baac94a46` → `a1f2c3d4e5f6` → `c4d9f2b8a7e1`).
- **Frontend (apps/web/src/**):** `lib/api/client.ts`, `context/AuthContext.tsx`, `context/DocumentContext.tsx`, `components/shell/WorkspaceLayout.tsx`, `lib/api/chat.ts`, `next.config.js`; repo-wide greps for error boundaries, WebSocket usage, env-var inlining.
- **Infrastructure:** `docker-compose.selfhost.yml`, `Dockerfile.api`, `Dockerfile.web`, `.env.selfhost.example`, `install.ps1` (and cross-checked `install.sh` behavior), healthcheck.
- **Config/secrets:** root `.env`, `.env.example`, `.gitignore`, `requirements.lock`, CI workflow.
- **Docs:** `SELF_HOSTING.md`, `SECURITY.md`, docs inventory.
- **Tests:** conftest strategy + inventory of ~40 test files / ~500 test functions; targeted reads of auth-enforcement and local-mode tests.

### Method
Skill's four phases applied audit-only: (1) autonomous codebase discovery & architecture mapping; (2) line-by-line issue detection across security, reliability, observability, data safety, scalability, production readiness; (3) verification of every claimed known-critical against source (all confirmed, with exact file:line evidence); (4) this report. Explicitly out of scope per instructions: node_modules, .venv, .next, __pycache__, coverage, caches, storage contents, logs.

### Known criticals from the brief — verification status
| Claim | Verdict | Primary evidence |
|---|---|---|
| Auth fallback auto-creates ADMIN on invalid JWT | **CONFIRMED (+worse: also on *missing* token, and via WS empty-token path)** | `services/auth.py:108-129`, `endpoints/collaboration.py:187-198` |
| Hard-coded local admin password = email string | **CONFIRMED** | `services/auth.py:86` |
| Committed default JWT secret in .env/.env.example | **CONFIRMED (+hardcoded twin in config.py)** | `.env:13`, `.env.example:13`, `core/config.py:7,26` |
| Alembic chain never creates base tables → fresh installs crash | **CONFIRMED** | `alembic/versions/ec9eb70fcc96_initial_schema.py:21-27` (base revision only ALTERs `documents`) |
| pgvector declared but embeddings stored in JSON with Python-side cosine scan | **CONFIRMED** | `models/chunk.py:29-30`, `services/rag_service.py:380-396`, `requirements.lock` (`pgvector==0.5.0`, zero imports in app code) |
| Optimistic-lock bypass in version restore | **CONFIRMED (+frontend never sends version at all)** | `endpoints/version_history.py:132-172`, `web/src/context/DocumentContext.tsx:10-18` |

---

## Production-Readiness Verdict

## 🔴 NO-GO for any networked or multi-user deployment
## 🟠 CONDITIONAL GO only for strictly-local, single-operator use — and even that is blocked today by two install/fresh-start failures

### Justification

1. **The API has no effective authentication.** Any request with no token, an expired token, a tampered token, or a token signed with any other key resolves to an auto-provisioned **admin** user (`get_current_user` → `get_or_create_local_user`). This single design decision converts every downstream control — admin-only plugin registration, role checks on projects/documents/teams, WS room authorization — into decoration. A "local-first" product may accept this on 127.0.0.1; the shipped artifact binds `0.0.0.0:8000` and is documented for "lab server or institutional infrastructure" (SELF_HOSTING.md §1). That combination is a full account/data takeover by anyone who can reach the port.
2. **Fresh installs crash at startup.** On an empty database, lifespan runs `alembic upgrade head`, whose base revision executes `batch_alter_table('documents')` against a table that does not exist → immediate boot failure of the API container. The product cannot be installed by a new user, period.
3. **The advertised one-command installer fails.** `docker-compose.selfhost.yml` hard-requires `REDIS_PASSWORD` (`${REDIS_PASSWORD:?...}` in three places), but `.env.selfhost.example` does not define it and `install.ps1` only injects `SECRET_KEY`. Compose aborts before any container starts.
4. **The web tier is mis-wired for anything but localhost-by-coincidence.** `NEXT_PUBLIC_API_URL` is build-time-inlined (`client.ts:1`), but the Docker build never receives it as an ARG and compose only sets it at runtime — client bundles compiled without it fall back to `http://localhost:8000/api/v1`, which breaks every browser not on the host machine.

Items 2–4 mean that **even the benign single-user story is broken out of the box**, which forces CONDITIONAL rather than GO. Items under "Deployment Blockers" P0 are mandatory before any real deployment; none are large engineering efforts except real vector search and true authn, but all are non-negotiable.

---

## Executive Summary

| Severity | Count | Summary |
|---|---|---|
| 🔴 CRITICAL | **6** | No-auth fallback w/ admin auto-provisioning; hard-coded admin password; committed/default JWT secret (+weak gating); fresh-install migration crash; broken self-host quickstart (REDIS_PASSWORD); frontend API URL build/runtime mismatch |
| 🟠 HIGH | **11** | Multi-worker migration race; stamp-without-migrate data risk; optimistic-lock bypass (restore + WS + frontend); spoofable/unbounded/per-process rate limiting; plaintext non-atomic API-key store; unauthenticated server-side package install/process spawn; DB-session-per-WebSocket pool exhaustion; Python-loop cosine over all chunks (pgvector unused); no metrics/tracing/error tracking; no graceful-shutdown semantics for streams/WS; no backup automation or restore testing |
| 🟡 MEDIUM | **14** | Thread-unsafe LRU cache; XML billion-laughs surface; team-member email enumeration; long-lived tokens (7-day access in example), no revocation/logout/jti; unpaginated endpoints; export fallback loads entire project; orphaned-file risks; doc drift (OLLAMA_DEFAULT_MODEL, "Redis queue", unused OPENAI_* envs); private IP leaked in next.config; public/ assets missing from web image; no Next.js error boundaries; upload lacks per-project quota; silent exception swallowing in WS broadcast; tests never exercise Alembic (root cause of blocker #4) |
| 🔵 LOW | **10** | Blocking `open()`/`write()` inside async upload loop; sync DB calls inside async graph/discover endpoints; CORS default origins list; health probe hits Redis via private method; delete ordering (DB-before-file); `Starting`/`web.log` junk files in tree; allowedDevOrigins dev leftover; missing security headers middleware; no request body size limit global; login limiter moot given no-auth design |
| ℹ️ INFO | **6** | Local-first design intent documented; honest LLM fallbacks; bounded caches; strong CI; extensive test suite; good docs set |

**Overall grade: D+** (engineering hygiene in services/tests is B/B+; deployment posture and auth architecture are F).

**Recommendation timeline**
- **Week 1 (P0):** Fix migration baseline, REDIS_PASSWORD template/installer gap, NEXT_PUBLIC_API_URL ARG plumbing, decide and enforce the auth model (kill admin fallback outside explicit local mode), purge default secret path.
- **Weeks 2–3 (P1):** Migration locking, rate-limit hardening, secrets-at-rest, WS/pool lifecycle, observability baseline (structured JSON logs + /metrics + error tracking), backup/restore automation.
- **Weeks 4–6 (P2):** Real vector search (pgvector) or documented scale ceiling; pagination sweep; token lifecycle; frontend error boundaries.

---

## Deployment Blockers

Each entry: file:line → evidence → why blocking → fix.

### B-1 · CRITICAL · Unauthenticated requests resolve to an auto-created ADMIN user
- **Where:** `apps/api/app/services/auth.py:108-129` (`get_current_user`), `auth.py:71-105` (`get_or_create_local_user`, `is_admin=True`), plus WS twin at `apps/api/app/api/v1/endpoints/collaboration.py:187-198` (empty-token auth frame joins as local admin).
- **Evidence:**
  ```python
  # auth.py:116-129
  if auth and auth.credentials:
      try:
          payload = decode_token(...)
          ...
      except jwt.InvalidTokenError:
          pass            # ← falls through
  return get_or_create_local_user(db)   # ← creates ADMIN if absent
  ```
  A test codifies the bypass: `tests/test_phase7_auth_enforcement.py:78` `test_invalid_token_falls_back_to_local_user`.
  Consequence cascade: `get_current_admin_user` (`auth.py:132-138`) always passes → `/plugins/register` (`endpoints/plugins.py:68-78`) is open to the network; every ownership check (`verify_user_access_to_owner`) succeeds for the shared local admin; all users' data is one namespace.
- **Why blocking:** Anyone who can reach the published port (`0.0.0.0:8000` per `Dockerfile.api:36`, compose publishes `8000:8000`) owns the instance. SELF_HOSTING.md markets multi-user team workspaces; SECURITY.md promises tenant isolation — both are false under this code path.
- **Fix:** Introduce an explicit `AUTH_MODE` (`local_single_user` | `required`). In `required`, replace the fallback with `HTTPException(401)`; keep auto-provision only when mode=local AND bind check/ENVIRONMENT guard (e.g., refuse local mode when `ENVIRONMENT=production` unless `ALLOW_LOCAL_MODE=true`). Remove the empty-token WS branch in production mode. Migrate the two tests asserting the fallback to assert 401 instead.

### B-2 · CRITICAL · Hard-coded local admin password equals the email string
- **Where:** `apps/api/app/services/auth.py:86` — `hashed_password=get_password_hash(LOCAL_USER_EMAIL)` with `LOCAL_USER_EMAIL = "local@openresearch.dev"` (`auth.py:19`).
- **Evidence:** Anyone who reads the open-source repo knows credentials `local@openresearch.dev` / `local@openresearch.dev` and can log in through the fully functional `/auth/login` (`endpoints/auth.py:70-84`) from anywhere the API is reachable.
- **Why blocking:** Even if B-1's HTTP fallback were gated off, the documented login route grants admin with publicly-known credentials.
- **Fix:** Generate a random secret at first provisioning, print once / write to a root-only file; or disable password login for the local account entirely (it exists only so FK/owner rows resolve).

### B-3 · CRITICAL · Default JWT secret ships in code and both env templates; production gate is opt-in
- **Where:** `apps/api/app/core/config.py:7` (`DEFAULT_DEV_SECRET_KEY = "openresearch_dev_secret_key_change_in_production_32bytes"`), `config.py:26` (fallback to it), `.env:13`, `.env.example:13` (same string), allow-list at `config.py:9-13`; validator `config.py:90-110` only fires when `ENVIRONMENT == "production"`.
- **Evidence:** `ENVIRONMENT` defaults to `"development"` (`config.py:20`). Any deployment that forgets the variable — the common failure mode — silently signs tokens with a public constant. HS256 + known secret ⇒ arbitrary token forgery ⇒ instant admin (tokens carry only `sub`; `get_current_user` trusts them).
- **Why blocking:** Secrets rotation is impossible without a code change (the compromised value is compiled in); the safe path requires operators to know an undocumented invariant (`ENVIRONMENT` must be exactly `production`).
- **Fix:** Fail fast at import time when `SECRET_KEY` is unset (no code default); keep the compromised-value deny-list as belt-and-braces; treat any non-production value explicitly (e.g., require `ENVIRONMENT ∈ {development,test,production}` and warn loudly on development with a public interface). Rotate the string in git history once commits exist.

### B-4 · CRITICAL · Alembic chain cannot create a fresh schema — new installs crash at boot
- **Where:** `apps/api/main.py:21-39` (`_run_migrations`: empty DB → `command.upgrade(cfg, "head")`); `apps/api/alembic/versions/ec9eb70fcc96_initial_schema.py:21-27`:
  ```python
  def upgrade() -> None:
      with op.batch_alter_table('documents', schema=None) as batch_op:
          batch_op.add_column(sa.Column('version', sa.Integer(), nullable=False))
  ```
  Chain verified: `ec9eb70fcc96` (down_revision=None) → `180baac94a46` (ALTER users) → `a1f2c3d4e5f6` (ALTER plugin_configs) → `c4d9f2b8a7e1` (ALTER document_versions). **No revision contains a single CREATE TABLE.**
- **Evidence path:** Fresh volume → `inspect(engine)` returns `set()` → branch `else: command.upgrade(head)` (main.py:38-39) → first migration targets nonexistent `documents` → `sqlalchemy.exc.NoSuchTableError`/OperationalError → lifespan raises → uvicorn worker dies → container restart-loop (restart: unless-stopped masks it as flapping).
- **Why blocking:** The product cannot be installed. Also untested by construction: `apps/api/tests/conftest.py:55` uses `Base.metadata.create_all(bind=test_engine)` on SQLite — the Alembic chain has zero coverage, which is how this regressed.
- **Fix:** Generate a true baseline `CREATE TABLE` migration for all 13 models (autogenerate against empty PG) as the new root, re-parent the existing four onto it; add a CI job that boots Postgres, runs `upgrade head` from empty, and smoke-tests `/health` + one CRUD round-trip; add a unit test asserting `alembic upgrade head` succeeds on a scratch DB.

### B-5 · CRITICAL · Self-host quickstart is broken: required REDIS_PASSWORD is absent from template and installer
- **Where:** `infrastructure/docker-compose.selfhost.yml:29-31,65,71-73` (`${REDIS_PASSWORD:?REDIS_PASSWORD must be set in your .env file}` ×3); `infrastructure/.env.selfhost.example` (43 lines — **no REDIS_PASSWORD key**); `infrastructure/install.ps1:32-42` (copies example, regex-replaces only SECRET_KEY); same gap in install flow for Linux/macOS.
- **Evidence:** Compose interpolation errors out before creating containers: `REDIS_PASSWORD must be set in your .env file`. The "Near-One-Command Quickstart" (SELF_HOSTING.md §3) therefore fails at step one for every new user.
- **Why blocking:** First-run experience of the primary distribution channel is DOA; support burden and abandoned installs guaranteed.
- **Fix:** Add `REDIS_PASSWORD=` placeholder to `.env.selfhost.example`; have both installers generate a crypto-random value exactly like they do for SECRET_KEY (ps1 already demonstrates the RNG pattern at install.ps1:35-38); mirror in `install.sh`.

### B-6 · CRITICAL · Frontend API base URL is baked at build time but supplied only at runtime
- **Where:** `apps/web/src/lib/api/client.ts:1` — `export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';` evaluated at module scope of client bundle; `infrastructure/Dockerfile.web:22-30` builder stage runs `npm run build` with **no ARG/ENV for NEXT_PUBLIC_API_URL**; `docker-compose.selfhost.yml:12-14` sets it only as runtime `environment`.
- **Evidence:** Next.js inlines `NEXT_PUBLIC_*` into the JS bundle during `next build`. Runtime env affects SSR/server paths only; every `'use client'` fetch in this app uses the inlined constant. Result: browsers on machines other than the Docker host attempt `http://localhost:8000` (their own loopback) → total client-server disconnect for LAN/institutional deployments. It "works" on the developer's machine purely via the hardcoded fallback coinciding with reality.
- **Related:** runner stage omits `COPY --from=builder /app/apps/web/public ./apps/web/public` (Dockerfile.web:44-45) while `apps/web/public/logo.svg` exists → broken asset in production image.
- **Why blocking:** The documented deployment topologies ("lab server", institutional host) are exactly the ones this breaks.
- **Fix:** Declare `ARG NEXT_PUBLIC_API_URL` + `ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL` in the builder stage, pass `args:` from compose; document that changing the URL requires rebuild (or switch the client to a relative-path + reverse-proxy model, which also removes the CORS dependency); add the missing public/ COPY.

---

## Reliability & Failure-Mode Findings

### R-1 · HIGH · Multi-worker startup races on migrations and seeding
`Dockerfile.api:36` defaults `--workers ${WEB_CONCURRENCY:-1}` but permits N>1. Each worker independently executes `_run_migrations()` (`main.py:56`) with no Postgres advisory lock / leader election. Concurrent `upgrade head` can deadlock, double-apply DDL guarded only by luck, or interleave with `stamp` (main.py:37). Similarly `init_http_client` and Tabby autostart thread run per worker (benign) but migrations are not. **Fix:** run migrations as a separate compose init service (`depends_on: service_completed_successfully`) or take `pg_advisory_lock` around the upgrade block; document WEB_CONCURRENCY=1 until then.

### R-2 · HIGH · Pre-Alembic databases are stamped `head` without migrating
`main.py:33-37`: if tables exist but `alembic_version` doesn't, the code stamps head immediately. Any pre-Alembic database created from older models (missing `documents.version`, `users.is_admin`, `plugin_configs.entrypoints`, or the `document_versions` unique constraint) is declared fully migrated and those columns/constraints are **never added** — later ORM writes then fail intermittently (e.g., INSERT omitting NOT NULL column with server_default=false is fine, but code reading `document.version` on a row-less schema breaks; the unique-constraint dedup pass in c4d9f2b8a7e1 is skipped entirely, so pre-existing duplicate version numbers survive into a schema that assumes uniqueness). **Fix:** stamp only after verifying information_schema matches expected baseline columns; else run a real baseline+upgrade sequence.

### R-3 · HIGH · Long-lived WebSocket sessions hold a DB connection for their entire life
`collaboration.py:226-231`: the route takes `db: Session = Depends(get_db)`; the session (and its pooled connection) is checked out for the whole socket lifetime — minutes to hours. SQLAlchemy defaults here are `pool_size=5, max_overflow=10` (nothing tuned in `core/database.py:9`), so ~15 concurrent collaboration sockets exhaust the pool and every REST request begins failing with `TimeoutError: QueuePool limit`. Under load this presents as a full-site outage triggered by one feature. **Fix:** scoped short-lived sessions per message (the code already opens its own `SessionLocal()` in `_persist_doc_edit`), or engine `pool_size` sized to socket budget + a hard cap on concurrent sockets per worker.

### R-4 · HIGH · Rate limiting is spoofable, unbounded, and process-local
`core/rate_limit.py:18-22` trusts the first `X-Forwarded-For` entry blindly — trivially spoofable when the API port is exposed directly (which compose does). `_hits: defaultdict(deque)` (line 29) grows one entry per unique attacker IP forever (pruned per-key only on that key's own traffic) — a slow memory-leak usable to OOM the worker. Docstring admits per-worker counting: effective limit multiplies by worker count. Login/register limits are additionally moot while B-1 stands. **Fix:** derive client IP from the immediate peer or a trusted-proxy hop count; evict stale keys periodically (single janitor pass per window); move to shared store (Redis already in stack) before enabling >1 worker.

### R-5 · HIGH · Graceful shutdown is incomplete for streams/sockets/background work
Lifespan closes only the httpx pools (`main.py:60-62`). SIGTERM mid-deploy cuts SSE generators (`chat.py:98-114`) and WS handlers abruptly; the Tabby child process spawned detached (`tabby_setup_service.py:115-129`, `start_new_session=True`) is deliberately orphaned and never tracked/killed on shutdown — repeated enable/disable cycles leak GPU/CPU processes on the host. In-flight `upload_paper` writes are cleaned only on handled exceptions, not on process death (partial files remain, though DB rows aren't written — acceptable but should be swept). **Fix:** shutdown hooks: cancel relay task (`collaboration.py:87-118` never cancelled), drain/close WS rooms with a go-away frame, track and terminate the Tabby PID, sweep orphan uploads at boot.

### R-6 · MEDIUM · Silent exception swallowing in the collaboration broadcast path
`collaboration.py:141-154,110-114`: every `send_json` failure is `except Exception: pass`. Dead peers persist in `active_connections` until their next inbound receive raises; presence lists rot; Redis publish failures vanish without a log line. Combined with R-3's held sessions, a room of zombie sockets holds resources invisibly. **Fix:** log-and-prune on send failure; add per-room send timeouts.

### R-7 · MEDIUM · Blocking I/O inside async contexts (inventory)
Discipline is mostly good (papers/citations/ai_writing correctly use `anyio.to_thread`). Remaining offenders:
- `papers.py:105-122` — synchronous `open()`/`out.write(chunk)` of up-to-1MB chunks directly on the event loop inside `upload_paper` (async). Use `anyio.open_file` or offload.
- `graphs.py:35,47` + `graph_service.py:188-194` — `async def discover_related_papers` performs sync ORM queries (`db.query(Paper)...all()`) on the event loop before/inside the async service.
- `pdf_extractor.py:146` — sync `open(file_path,'rb')` for the GROBID multipart inside async `_extract_with_grobid` (small; header read only, but the file handle feeds an async upload — acceptable; flagging the pattern).
- `provider_settings.py` — every LLM call re-reads `provider_keys.json` from disk synchronously (see D-2).
Impact at expected scale is latency spikes under concurrency rather than outage; still worth fixing before WEB_CONCURRENCY>1 tuning.

### R-8 · MEDIUM · Non-atomic state mutations
- `provider_settings.py:130-133` — `path.write_text(...)` truncates-then-writes; crash/power-loss mid-write corrupts the credential store (silently reset to empty on next load, losing provider keys).
- `version_history.py:149-171` — restore commits document content (153) and only afterwards allocates/commits the checkpoint; a crash between leaves a restored doc with no audit trail, and two concurrent restores interleave allocations (retries mask, but final content depends on commit order).
- `papers.py:331-340` — paper row deleted and committed before PDF removal; removal failure strands files forever (logged only).
**Fix:** temp-file + atomic rename for JSON stores; single-transaction restore (write checkpoint + content together); best-effort file GC job.

### R-9 · LOW · Health/readiness depth
`endpoints/health.py` checks DB (503 on fail — correct) and Redis ping (degraded, still 200). It does not reflect GROBID/Ollama availability (arguably optional), nor migration currency (a stamped-but-drifted DB reports healthy, see R-2), nor pool saturation (R-3 precursor). Docker HEALTHCHECK (`Dockerfile.api:33-34`) consumes it appropriately. Adequate for liveness; insufficient as a readiness signal for orchestration that routes on it.

---

## Observability Findings

### O-1 · HIGH · No metrics, no tracing, no error-tracking integration anywhere
Zero Prometheus/OpenTelemetry/Sentry surface in backend or frontend (`rg` across apps/api + apps/web/src finds no metrics endpoint, no trace exporter, no DSN). The only signals are: f-string logs, `X-Request-ID` response header, `X-Response-Time-MS`, and the quota counters in `provider_cache_service.get_quota_status`. You cannot answer basic operational questions (p95 latency? error rate by route? queue depth? pool saturation?) in production. **Fix (minimum viable):** structured JSON logging (O-2), `/metrics` with request-count/latency-histogram/pool-gauges, Sentry-or-equivalent wired into `GlobalErrorEnvelopeMiddleware`'s handler (`middleware.py:52-67` is the natural single hook point).

### O-2 · MEDIUM · Logging is human-format f-strings without structure or levels discipline
`middleware.py:40-43` logs `f"[{request_id}] {method} {path} status=... latency=..."` — fine locally, hostile to aggregation (no JSON, no route template, no user/tenant dimension, query strings unfiltered — potential accidental PII/token leakage via logged URLs since `request.url.path` excludes query but other log sites don't consistently). Log injection is defended for the ID itself (`middleware.py:18,30` sanitizes to safe charset — good), but free-form fields elsewhere (`logger.info(f"GROBID ... ({e})")` pdf_extractor.py:131) interpolate raw external text. **Fix:** stdlib `logging` with JSON formatter + `request_id` contextvar; central redaction filter.

### O-3 · MEDIUM · Request-ID correlation exists but isn't propagated outbound or to logs
`X-Request-ID` is generated/honored/sanitized and echoed (`middleware.py:28-38`) — good foundation. But: loggers outside middleware don't include it (no contextvar); outbound calls to GROBID/Ollama/cloud providers don't forward it, so a slow-generation complaint cannot be correlated end-to-end; the error envelope includes it (good, `middleware.py:58-66`) yet nothing documents where an operator searches for it.

### O-4 · LOW · Frontend has zero client-side error reporting and no error boundaries
No `error.tsx`/`global-error.tsx` anywhere under `apps/web/src/app/**` (glob-verified) and no `ErrorBoundary` component (grep-verified). An unhandled render exception in any view white-screens the workspace with the framework default; combined with the persistent shell (`WorkspaceLayout` mounts once per session) a single bad modal payload can take down navigation until reload. **Fix:** add `app/global-error.tsx` + route-level `error.tsx`, wrap `ModalContainer` contents, wire the same error tracker as O-1.

### O-5 · INFO · Positive observability seeds worth keeping
Request tracing middleware, latency header, error envelope with stable codes, honest component statuses in `/health`, quota hit-rate surfacing (`provider_cache_service.py:139-187`), and per-request timing logs give a decent local-dev experience — the gap is purely production-grade aggregation.

---

## Data-Safety Findings

### D-1 · HIGH · Backup story is manual, untested, and misses Redis/uploads nuances
SELF_HOSTING.md §6 documents `pg_dump` + `tar czf storage/` as the entirety of the plan: no scheduling, no retention, no verification/restore drill, no encryption of the backup archive (contains unpublished research + plaintext API keys — see D-2), no guidance for the SQLite dev-mode database (`*.db` at repo root is gitignored but is live data for local runs), and Redis (pubsub/cache only — correctly excluded, though the doc's architecture diagram calling it a "Queue" invites operator confusion). Uploads volume and pgdata are separate volumes backed up by different commands with no consistency between them (a paper row can point to a PDF that the tarball predates/postdates). **Fix:** provide `backup.sh`/`restore.sh` performing `pg_dump --serializable-deferrable` + fsync'd tar with manifest + optional age/openssl encryption; add a restore test to CI.

### D-2 · HIGH · Cloud API keys stored plaintext, non-atomically, in a volume adjacent to backups
`provider_settings.py:110-133` — keys live in `storage/provider_keys.json` (plaintext JSON, indent=2), written via truncating `write_text` under a threading lock only (not atomic across processes; multiple workers race read-modify-write and lose updates). SECURITY.md §3.4 claims "Sensitive credentials ... stored securely" — inaccurate. Any storage-volume reader (backup archive, container escape, mischowned mount) yields OpenAI/Anthropic keys. **Fix:** encrypt at rest with a key from env/keyring, atomic rename, file chmod 600, and exclude from default backup command; correct the SECURITY.md claim.

### D-3 · HIGH · Optimistic locking is decorative: three independent bypasses
Backend PATCH enforces §3.3 (`documents.py:109-123`, increments `version`, 409 on mismatch). But:
1. **Restore endpoint** `version_history.py:149-153` overwrites `title/content_json/plain_text` without accepting an expected version and without incrementing `Document.version` — a concurrent editor's autosave lands on top of a restore with zero conflict signal, or vice versa.
2. **WS persistence** `collaboration.py:40-61` bumps `version` on every `doc_edit` frame while writing full content — every keystroke-batch invalidates whatever version the REST clients hold, guaranteeing spurious 409s for mixed-mode editing (or silent loss if clients ignore version — which they do).
3. **Frontend** `DocumentContext.tsx:10-18` defines `DocumentItem` with no `version` field and `updateActiveDocument` sends none — the 409 path can never legitimately fire from the shipped client; last-write-wins is the actual semantic.
Net effect: concurrent-edit data loss is reachable in the flagship collaboration feature. **Fix:** single writer path (route WS edits through the same service function as PATCH), restore accepts `expected_version`, client tracks and sends `version`, and 409 triggers reload-and-merge UX.

### D-4 · MEDIUM · Version-number allocation relies on retry-on-collision
`version_history.py:26-49`: MAX+1 read then insert, IntegrityError → rollback → re-allocate (max 3 tries). Correct-ish under the unique constraint (migration c4d9f2b8a7e1), but on SQLite the busy_timeout pragma (database.py:18) plus WAL makes the collision window wider; three-way contention yields a 500. Acceptable now; switch to `INSERT ... SELECT COALESCE(MAX..)+1` inside the transaction or a per-document counter row.

### D-5 · MEDIUM · Migration safety net missing (downgrades, backups-before-migrate)
No migration runs a pre-upgrade backup; `downgrade()` functions exist but c4d9f2b8a7e1's downgrade drops a constraint that may not exist on stamped-pre-Alembic DBs (fails). Combined with R-1/R-2, schema changes are the least-tested destructive operation in the system.

### D-6 · LOW · Embedding/chunk data model forecloses cheap reindexing
Chunks embed full metadata copies (`rag_service.py:124-129` etc.) and embeddings are 128-dim hashing vectors stored per-row as JSON — reindexing after any change to the embedding scheme means rewriting and re-serializing every row (already the case in `chunk_paper` delete-all-then-insert, `rag_service.py:301`). Not a correctness bug; a data-safety liability because there is no version marker on embeddings — mixing schemes post-upgrade silently degrades retrieval. Add `embedding_model_version` column before any real model change.

### D-7 · LOW · Account enumeration via team invite
`teams.py:206-208` returns 404 "User with email {email} not found" — confirms whether an email is registered. Low impact while auth is bypassed anyway (B-1), becomes relevant the moment real authn lands. Return 204-style generic acceptance or require known-member invitation flows.

---

## Scalability Ceiling Analysis

### S-1 · HIGH · Retrieval is O(all chunks in scope) Python work per query — pgvector is installed and unused
`rag_service.hybrid_search` (`rag_service.py:332-433`): selects **every** chunk row for the project (`yield_per(500)` bounds memory, not CPU), JSON-deserializes each 128-float embedding, computes cosine in pure Python (`EmbeddingService.cosine_similarity`, zip/sum per pair), lowercases full chunk text per row for lexical scoring, and maintains a size-`limit` heap. Cost per chat message ≈ `N_chunks × (JSON parse + 128 mul-adds + substring scans)`. With a 200-paper library (~40k chunks) that is seconds of pure CPU **per query per worker**, executed synchronously in the request thread — throughput collapses long before memory does, and concurrent chats serialize on CPU. The infrastructure irony: `pgvector/pgvector:pg16` image + `pgvector==0.5.0` pin ship in the stack while `models/chunk.py:30` candidly comments *"Embedding vector stored as JSON array of floats for cross-engine compatibility"*; zero imports of pgvector anywhere in app code. **Fix path:** `vector(128)` column + HNSW index + `<=>` ordering pushes ranking into Postgres (lexical half can use `tsvector` + `ts_rank_cd`); keep the hybrid blend in SQL. Until then, document the ceiling honestly (≈ small personal libraries) in SELF_HOSTING hardware table.

### S-2 · MEDIUM · The "embeddings" are feature-hashing bags-of-words, not semantic vectors
`rag_service.py:33-89`: BLAKE2b word/char-trigram hashing into 128 dims with position weighting — deterministic and cheap (good instincts: avoids salted `hash()`), but semantically shallow: synonyms paraphrase to near-orthogonal vectors; the 0.68 semantic-confidence gate (`rag_service.py:403-407`) will therefore randomly refuse legitimate paraphrase queries and pass unrelated ones sharing trigrams. Quality ceiling, not just performance. If grounding quality matters to the product, swap to a real local embedder via Ollama (`/api/embeddings`) behind the same interface.

### S-3 · MEDIUM · Unpaginated collection endpoints (full-table materialization)
Verified call sites returning `.all()` without limit: `projects.py:54,63-65` (all projects per owner-set); `version_history.py:73-79` (all versions — grows unboundedly with autosave snapshots); `papers.py:362-368` annotations; `teams.py:174-179` members; `export.py:37-43,91-96` (all citations + **entire project library** loaded as bibliography fallback per export call); `intelligence_service.py:338,405,610` (whole corpora per analysis). Each is a per-user DoSAble memory spike and a p99 killer. Counter-examples done right: `documents.py:49-74`, `papers.py:213-245`, `comments.py:75` (skip/limit enforced) — the pattern exists, apply it uniformly.

### S-4 · MEDIUM · Per-request recomputation hot spots
- `get_or_create_local_user` runs a SELECT (plus potential create) on **every unauthenticated request** including static-ish GETs — under the no-auth regime this is the hottest query in the system; cache the resolved user per-process.
- `provider_settings._load_store()` re-reads+parses `provider_keys.json` on every LLM call and every provider-status poll (`get_active_provider_name` → called per generation) — disk I/O on the hot path; memoize with mtime check.
- `get_paper_status` COUNTs chunks per UI poll (`papers.py:288`).
- Graph building materializes the whole citation graph in Python per request (`graph_service.build_project_graph`) — fine at tens of papers, quadratic at hundreds.

### S-5 · LOW · Connection-pool sizing untuned for stated topologies
`database.py:9` uses SQLAlchemy defaults (pool_size 5 / overflow 10) while the product advertises team workspaces; combined with R-3 the practical concurrency ceiling is ~15 in-flight DB-touching operations per worker regardless of CPU headroom. Set explicit sizes aligned with WEB_CONCURRENCY guidance and document the arithmetic.

### S-6 · INFO · What scales fine today
Streaming upload (chunked, size-capped, header-checked), thread-offloaded extraction/indexing, heap-bounded top-k selection, batched paper hydration after search (`rag_service.py:440-445` — explicitly avoids N+1), aggregated team counts (`teams.py:67-73`), LRU-bounded provider cache, and pooled httpx clients (`http_client.py:10-14`). The single-node personal-use case is comfortably within every ceiling above.

---

## Detailed Findings

Legend: severity · category · location · description (+fix where non-obvious).

### CRITICAL

1. **CRITICAL · Security · `services/auth.py:108-129`** — Auth fallback: missing/expired/invalid/malformed bearer token all degrade to auto-provisioned **admin** local user. Includes WS variant accepting an auth frame with *empty* token (`endpoints/collaboration.py:189-198`). Full API + plugin-admin + cross-owner access to any network peer. See B-1.
2. **CRITICAL · Security · `services/auth.py:86,19`** — Local admin account's password hash is derived from its publicly-documented email constant. Known-credential admin login via `/auth/login`. See B-2.
3. **CRITICAL · Security · `core/config.py:7,26`, `.env:13`, `.env.example:13`** — Public default JWT signing key compiled into code and duplicated in both env templates; production hardening gated behind `ENVIRONMENT=production` string equality, default is development. Enables offline token forgery wherever the default applies. See B-3.
4. **CRITICAL · Reliability · `alembic/versions/ec9eb70fcc96_initial_schema.py:21-27` (+ main.py:31-39)** — Base revision alters a nonexistent table; fresh databases crash the app at startup; migration chain has no test coverage (conftest uses `create_all`). See B-4, R-2.
5. **CRITICAL · Operations · `infrastructure/docker-compose.selfhost.yml:31,65,73` vs `.env.selfhost.example` + `install.ps1:32-42`** — Required `REDIS_PASSWORD` absent from template and installer-generated env; one-command quickstart aborts in compose interpolation. See B-5.
6. **CRITICAL · Deployment · `lib/api/client.ts:1` + `Dockerfile.web:22-30` + `docker-compose.selfhost.yml:12-14`** — Build-time-inlined `NEXT_PUBLIC_API_URL` never provided at build; runtime-only value cannot affect client bundles; non-localhost deployments get a browser pointing at its own loopback. Runner image also drops `public/` assets (logo.svg 404). See B-6.

### HIGH

7. **HIGH · Reliability · `Dockerfile.api:36` + `main.py:21-39`** — Multi-worker concurrent Alembic execution without advisory locking; startup race/deadlock/DDL interleaving. See R-1.
8. **HIGH · Data safety · `main.py:33-37`** — Pre-Alembic DBs stamped head without schema verification or applying pending revisions; silent permanent drift incl. skipped duplicate-version cleanup. See R-2.
9. **HIGH · Data safety · `version_history.py:149-172`, `collaboration.py:40-61`, `DocumentContext.tsx:10-18`** — Three stacked bypasses of document optimistic locking; concurrent-edit data loss in core editing flows. See D-3.
10. **HIGH · Security/Reliability · `rate_limit.py:18-22,29-45`** — XFF-spoofable client identity, unbounded per-IP dict (memory-growth DoS), per-process counters multiply with workers. See R-4.
11. **HIGH · Data safety · `provider_settings.py:110-133`** — Plaintext, non-atomic, multi-process-racy credential file inside the backup volume; contradicts SECURITY.md. See D-2.
12. **HIGH · Security · `endpoints/provider_settings.py:151-158` + `tabby_setup_service.py:85-101,167-218,249-258`** — Any caller (i.e., anyone, given #1) can trigger package-manager installation (`winget`/`brew`, 600 s blocking subprocess) and detached process spawning on the API host. Server-side software-install primitive keyed to an unauthenticated endpoint. Fix: admin+local-mode-only, never expose in server images, run with timeout + consent.
13. **HIGH · Reliability · `collaboration.py:226-231` + `database.py:9`** — DB session pinned per WebSocket for socket lifetime; ~15 sockets exhaust default pool → site-wide 500s. See R-3, S-5.
14. **HIGH · Scalability · `rag_service.py:332-433`, `models/chunk.py:29-30`, `requirements.lock`** — O(N) pure-Python cosine + JSON parse + substring scans over all project chunks per query; pgvector provisioned but unused; 128-dim hashed features masquerade as embeddings (also quality ceiling). See S-1, S-2.
15. **HIGH · Observability · repo-wide** — No metrics endpoint, no tracing, no error tracking; production incidents would be undiagnosable beyond grep-through-stdout. See O-1.
16. **HIGH · Reliability · `main.py:53-62` + `tabby_setup_service.py`** — Shutdown drains nothing but httpx: SSE/WS severed mid-flight, detached Tabby child never terminated/reaped, relay pub/sub task uncancellable leak on reload. See R-5.
17. **HIGH · Operations · SELF_HOSTING.md §6** — Manual, unverified, unencrypted, non-atomic-across-volumes backup instructions only; no automated jobs, no restore testing. See D-1.

### MEDIUM

18. **MEDIUM · Reliability · `provider_cache_service.py:68-121`** — `OrderedDict` LRU mutated from multiple threadpool threads without a lock (`move_to_end`/`popitem` races → rare KeyError/corruption). Wrap ops in a lock (service already single-instance).
19. **MEDIUM · Security · `pdf_extractor.py:163-165`** — GROBID TEI parsed with stdlib `xml.etree` (vulnerable to billion-laughs/quadratic entity blowup per Python docs). Source is the internal GROBID container (trust boundary thin in a self-host stack where GROBID parses attacker-supplied PDFs). Switch to `defusedxml`.
20. **MEDIUM · Security · `teams.py:206-208`** — Email-existence oracle via 404 detail. See D-7.
21. **MEDIUM · Security · `core/config.py:28-29` + `.env.selfhost.example:15`** — 24 h default access tokens, 30 d refresh, self-host example stretches access to **7 days**; no `jti`, no revocation list, no logout endpoint, no audience/issuer validation. Token theft windows are enormous. Add short access TTL + refresh rotation with reuse detection.
22. **MEDIUM · Scalability · multiple (see S-3)** — Unpaginated: projects list, version history, annotations, team members, export bibliography fallback, intelligence analyses.
23. **MEDIUM · Reliability · `export/service.py` via `export.py:42-43`** — Export with zero document citations loads every project paper to build references; 500-paper project → heavy DOCX/PDF render per click, no format-specific caching.
24. **MEDIUM · Reliability · `papers.py:331-340`, `provider_settings.py:130-133`, `version_history.py:149-171`** — Non-atomic write/delete sequences (DB-commit-then-FS-delete; truncate-write; two-phase restore). See R-8.
25. **MEDIUM · Docs/Config · `docs/SELF_HOSTING.md:86` vs `core/config.py:72-73`** — Doc instructs setting `OLLAMA_DEFAULT_MODEL`; the application reads `OLLAMA_MODEL` (silent no-op → default `llama3.2:3b`). Same file: diagram labels Redis "Queue" (it's cache/pubsub); `.env.selfhost.example:32-33` ships `OPENAI_API_KEY`/`OPENAI_API_BASE` that no code reads (providers configured via UI store). Operator-follows-docs deployments silently misconfigure the LLM.
26. **MEDIUM · Config · `next.config.js:5`** — `allowedDevOrigins: ['192.168.1.6']` hardcodes someone's LAN IP into the shipped config (dev leftover; leaks infra detail, breaks other networks' expectations).
27. **MEDIUM · Frontend resilience · `apps/web/src/app/**`** — No `error.tsx`/`global-error.tsx` boundaries anywhere; persistent shell means one bad payload blanks the whole workspace. See O-4.
28. **MEDIUM · Testing · `tests/conftest.py:55`** — Test harness bypasses Alembic entirely (`create_all` on SQLite); no CI exercise of the migration chain on PostgreSQL — the exact hole that produced blocker B-4. Add an alembic-boot CI leg.
29. **MEDIUM · Security · upload path** — Size caps and header magic checks are solid, but there is no per-project/per-user quota (a user can fill the volume with ≤50 MB files), no page-count sanity before pdfplumber (crafted PDFs can burn CPU in the threadpool), no malware posture statement. Document limits or add quotas.
30. **MEDIUM · Reliability · `collaboration.py:148-154`** — Broadcast failures swallowed without pruning/logging; zombie presence entries. See R-6.
31. **MEDIUM · Security · `plugins.py:68-78` + `plugin_runtime.py:51-66`** — Plugin registration is "admin-only" behind an auth layer that grants admin to everyone (#1); entrypoints restricted to `app.plugins.*` (bundled code only — good containment), but combined with arbitrary `config_json` and the public `execute_hook` endpoint (`plugins.py:37-57`) any peer can invoke bundled plugin functions with crafted payloads. Re-assess after real authn; consider capability-scoped hooks.
32. **MEDIUM · Reliability · `health.py:30-43`** — Redis reachability gates overall status to "degraded" but returns HTTP 200; orchestrators that only inspect status codes can't distinguish healthy/degraded; redis client accessed via private `_get_redis` (fragile coupling).

### LOW

33. **LOW · Performance · `papers.py:105-122`** — Sync `open/write` per 1 MiB chunk on the event loop in async upload. Use async file IO.
34. **LOW · Performance · `graphs.py:35,47` + `graph_service.py:188-194`** — Sync ORM queries inside async endpoint/service on the event loop. Offload or make endpoint sync (threadpool) like sibling routes.
35. **LOW · Security headers · `main.py:77-88`** — No HSTS/X-Content-Type-Options/CSP middleware; TLS is assumed external (compose publishes plain HTTP 8000/3000; SECURITY.md mandates TLS but no proxy is shipped — expectation gap for self-hosters).
36. **LOW · CORS · `config.py:36-55`** — Sensible explicit origin list (no wildcard+credentials anti-pattern — good), but defaults lack any non-localhost origin and there's no docs example for LAN deployments; combined with B-6 most operators must edit both anyway.
37. **LOW · Hygiene · repo root** — `Starting` (empty?), `web.log`, `tsconfig.tsbuildinfo` present in tree; ensure junk excluded from initial commit (repo has none yet — first-commit hygiene matters).
38. **LOW · Data safety · `papers.py:117-121`** — Oversize upload deletes partial file (good) but relies on exception propagation through Starlette; a client disconnect mid-stream surfaces differently — verify cleanup on `ClientDisconnect` path specifically.
39. **LOW · Auth UX · `schemas/models.py:14-23`** — Password complexity enforced only at registration (lower+upper+digit); login path fine; consider zxcvbn-style length guidance; bcrypt 72-byte truncation handled explicitly (auth.py:24,30 — nice).
40. **LOW · Reliability · `chat.py:98-108`** — SSE generator holds request-scoped `db` across stream lifetime (same pool math as R-3 but bounded by generation time; acceptable, note for consistency).
41. **LOW · Observability · `http_client.py:14`** — Outbound User-Agent includes mailto contact — fine; consider forwarding inbound X-Request-ID to GROBID/Ollama for tracing continuity (see O-3).
42. **LOW · Frontend · `client.ts:59-79`** — No fetch timeout/AbortSignal default on non-stream requests; a hung API pins UI states indefinitely. Add default AbortController + retry policy idempotent verbs.

### INFO

43. **INFO · Design** — "Local-first, no-login" is an explicit, documented product decision (auth.py docstring; SELF_HOSTING.md §1) — the finding is the *deployment-context mismatch*, not intent.
44. **INFO · Honesty patterns** — LLM fallbacks refuse to fabricate (`rag_service.py:564-582, llm_service.py:12-15`); extraction failures store `unverified` with filename-derived title only (`papers.py:143-161`); trust legend/grounding states throughout schemas. Genuinely good AI-safety UX.
45. **INFO · Tests** — ~40 files / ~500 test functions incl. subprocess-injectable tabby tests, provider-path matrices, identifier-resolver fixtures. Coverage breadth is a real asset; depth gaps: migrations (see #28), concurrency, and the auth-fallback tests enshrine the vulnerability (#1).
46. **INFO · CI** — `.github/workflows/ci.yml`: typecheck+lint+vitest+build+`npm audit --omit=dev` frontend; ruff+pytest+pip-audit-style backend legs with pinned `requirements.lock`. Solid baseline; add docker-build + alembic-leg.
47. **INFO · Packaging** — Both Dockerfiles drop to non-root users, pinned lockfile install, standalone Next output, healthchecks wired; `.dockerignore` exists. Above-average hygiene.
48. **INFO · Docs set** — SECURITY policy with response SLAs, DATA_RETENTION_POLICY, LEGAL_REVIEW_CHECKLIST, VPAT accessibility statement, COPYRIGHT posture — rare and commendable for this project size (accuracy fixes needed per #25/D-2).

---

## Positive Observations

Worth protecting during remediation:

1. **Threadpool discipline** — async endpoints consistently push blocking work to `anyio.to_thread` (`papers.py:86,190`, `citations.py:269,307`, `ai_writing_service.py:172-174`); the blocking-I/O inventory (R-7) is short because of this culture.
2. **Shared, loop-safe HTTP pooling** — `http_client.py` handles event-loop rebinding, stale-client detection, bounded limits, and clean shutdown.
3. **Honest-AI contract** — grounded answers cite bracketed sources, refuse on insufficient evidence, label inference vs. source (`rag_service.py:473-493,770-896`); deterministic fallbacks when providers die.
4. **Upload safety** — streamed-to-disk with declared+streamed double size enforcement, `%PDF-` header sniffing within first KiB, traversal-proof filenames, partial-file cleanup (`papers.py:88-137`, `pdf_extractor.py:104-111`).
5. **Team-model correctness details** — last-owner demote/remove guards (`teams.py:245-254,283-292`), aggregated member counts avoiding N+1 (`teams.py:67-73`).
6. **Production settings tripwire** — the `validate_production_security` model validator concept (config.py:90-110) is right; it just needs to stop being opt-in (see B-3 fix).
7. **Log-injection defense** — request-ID sanitization regex before echoing/logging (middleware.py:18,30).
8. **Bounded caches everywhere** — LRU caps, availability-TTL probes, sliding-window counters: the memory-leak class of bug is visibly designed against (even where individual implementations need locks/eviction).
9. **Accessible, well-structured frontend architecture** — persistent workspace shell, context partitioning, monorepo package boundaries, i18n scaffold.
10. **Exceptional docs breadth** for the project stage (retention policy, legal checklist, VPAT) — accuracy patches will make it trustworthy.

---

## Pre-Launch Checklist (ordered P0 → P3)

### P0 — must land before ANY distribution (order matters)
1. ☐ **Migration baseline:** generate true CREATE-TABLES root revision re-parenting the existing chain; boot-test on empty Postgres; add CI leg running `alembic upgrade head` from scratch (fixes B-4, covers #28).
2. ☐ **Auth model decision & enforcement:** add `AUTH_MODE`; return 401 instead of local-admin fallback when auth required; remove WS empty-token branch in that mode; refuse `local` mode in production images unless explicitly overridden; rewrite the tests that bless the fallback (B-1).
3. ☐ **Kill known-credential admin:** random-provisioned or login-disabled local account (B-2).
4. ☐ **Secret hygiene:** no code-default `SECRET_KEY` (fail fast); rotate the compromised literal out of templates; document ENVIRONMENT invariants; keep deny-list (B-3).
5. ☐ **Quickstart repair:** `REDIS_PASSWORD` placeholder + installer RNG injection in `install.ps1`/`install.sh`; end-to-end test of the documented quickstart on clean VMs (B-5).
6. ☐ **Web/API wiring:** `ARG NEXT_PUBLIC_API_URL` in Dockerfile.web builder + compose args; copy `public/` in runner; document rebuild-on-change; decide reverse-proxy/relative-URL strategy (B-6).
7. ☐ **Single-worker guarantee:** pin `WEB_CONCURRENCY=1` in compose until R-1 fixed; add advisory-lock or init-container migrations.

### P1 — before first multi-user/exposed deployment
8. ☐ Restore endpoint accepts expected version + increments `Document.version`; WS edits route through shared write path; client sends `version` (D-3/#9).
9. ☐ Rate limiter: trusted-IP resolution, periodic eviction, Redis-backed counters when workers > 1 (R-4/#10).
10. ☐ Encrypt provider-keys store at rest; atomic writes; chmod 600; exclude from backups; correct SECURITY.md claim (D-2/#11).
11. ☐ Gate/remove Tabby setup endpoint for server builds; admin-only + local-mode-only otherwise (#12).
12. ☐ WS/session lifecycle: per-message DB sessions, socket caps, relay-task cancellation, Tabby child termination on shutdown (R-3, R-5, #13, #16).
13. ☐ Observability floor: JSON logs w/ request-id contextvar, `/metrics` (latency histograms, pool gauges, cache stats), error tracker hooked in error-envelope middleware (O-1..O-3).
14. ☐ Automated encrypted backups + tested restore script; consistency manifest across pgdata/storage volumes (D-1).
15. ☐ Token lifecycle: 15–60 min access TTL, refresh rotation + reuse detection, logout/jti denylist; shrink selfhost example TTL (#21).

### P2 — scale & robustness hardening
16. ☐ pgvector column + HNSW index + SQL-side hybrid ranking; OR publish measured chunk-count ceilings in docs (S-1/S-2).
17. ☐ Pagination sweep across projects/versions/annotations/members/export-fallback/intelligence (S-3, #22).
18. ☐ Cache local-user resolution & provider-store reads (mtime-memoized) (S-4).
19. ☐ Pool sizing + documented concurrency arithmetic; per-project upload quotas (S-5, #29).
20. ☐ Lock the provider-cache OrderedDict; defusedxml for TEI (#18, #19).
21. ☐ Atomic JSON-store writes; single-txn restores; orphan-file sweeper (#24).
22. ☐ Next.js `global-error.tsx` + route `error.tsx` + ModalContainer boundary; client fetch timeouts (#27, #42).

### P3 — polish
23. ☐ Docs accuracy pass: `OLLAMA_MODEL` vs phantom var, Redis role, unused env keys, LAN deployment walkthrough (incl. CORS + API URL) (#25, #36).
24. ☐ Strip `allowedDevOrigins` LAN IP; repo-root junk exclusion at first commit (#26, #37).
25. ☐ Security-header middleware + documented TLS-termination reference compose (nginx/Caddy) closing the SECURITY.md HTTPS promise (#35).
26. ☐ Team-invite enumeration fix; outbound request-ID propagation; embedding-schema version column (#20, #41, D-6).
27. ☐ Async file IO in upload; async-endpoint sync-DB cleanups (#33, #34).

---

*End of report. Audit performed read-only; no repository files were created, modified, or deleted apart from this report.*
