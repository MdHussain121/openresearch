# FastAPI Best-Practices Audit — `apps/api`

**Repository:** OpenResearch monorepo (`C:\Users\moham\Pictures\OpenResearch`)
**Target:** `apps/api/app/**` (FastAPI backend), cross-referenced against `docs/architecture.md`, `alembic/env.py`, `tests/conftest.py`
**Audit type:** READ-ONLY. No files were modified.
**Date:** 2026-08-26

---

## Scope & Methodology

### Files reviewed (every router and service file was read end-to-end)

| Layer | Files |
|---|---|
| App core | `app/main.py`, `app/core/config.py`, `app/core/database.py`, `app/core/middleware.py`, `app/core/http_client.py`, `app/core/rate_limit.py`, `app/core/constants.py`, `app/core/text_utils.py` |
| Routers (all 20) | `app/api/v1/api.py` + endpoints: `ai_writing`, `auth`, `chat`, `citations`, `collaboration`, `comments`, `documents`, `export`, `graphs`, `health`, `intelligence`, `papers`, `plugins`, `projects`, `provider_settings`, `provider_status`, `research`, `teams`, `version_history`, `zotero` |
| Services (all) | `auth`, `rag_service`, `llm_service`, `ai_writing_service`, `graph_service`, `identifier_resolver`, `literature_search_service`, `intelligence_service`, `zotero_service`, `plugin_runtime`, `plugin_service`, `provider_cache_service`, `provider_settings`, `export_service` (+ `export/*` package), `pdf_extractor`, `tabby_setup_service` |
| Schemas | `app/schemas/models.py` (1,027 lines, all models) |
| Models | `app/models/__init__.py`, `user.py` (spot-checked; all models registered via single `Base`) |
| Infra | `alembic/env.py`, `pyproject.toml`, `requirements.txt`, `.env`, `.env.example`, `tests/conftest.py` |

### Methodology

The audit applies current FastAPI best practices (FastAPI skill: `Annotated` dependencies, lifespan resource handling, `def` vs `async def` selection, yield-dependency lifecycle, response-model filtering, Pydantic v2 idioms, router-level prefix/tags/shared deps, SSE via `EventSourceResponse`, avoidance of deprecated response classes and `RootModel`, one HTTP operation per function) as an **audit overlay** over each file. Each finding cites `file:line`, quotes the relevant snippet, and gives a concrete fix. Async-correctness claims were verified by tracing the actual call chain from endpoint → service → I/O primitive (sync `Session`, sync `httpx.Client`, sync `redis.Redis`, blocking `open()`), not assumed from naming.

---

## Executive Summary

| Severity | Count |
|---|---|
| **CRITICAL** | 2 |
| **HIGH** | 5 |
| **MEDIUM** | 13 |
| **LOW** | 17 |
| **INFO** | 10 |

The codebase is a competent, well-tested FastAPI application with several genuinely strong patterns (lifespan-managed shared HTTP pools, streamed upload hardening, consistent RBAC helper, honest AI-fallback semantics, production settings guardrails). However, it has one systemic design decision with severe deployment consequences (silent fallback to an auto-created admin identity for *any* unauthenticated request), a configuration wiring defect that silently disables its own `.env` file, a cluster of blocking-I/O-in-`async def` violations on hot paths, and a WebSocket handler that pins a pooled DB connection for the life of each socket.

---

## Detailed Findings

### CRITICAL

#### C-1. Every "authenticated" endpoint silently falls back to an auto-provisioned admin user — authentication is effectively decorative
- **File:** `apps/api/app/services/auth.py:108-129`; consumed by all routers; amplified in `apps/api/app/api/v1/endpoints/collaboration.py:186-198`
- **Snippet:**
  ```python
  def get_current_user(
      auth: Optional[HTTPAuthorizationCredentials] = Depends(security), db: Session = Depends(get_db)
  ) -> User:
      """
      Resolves the acting user. A valid bearer token still identifies its user
      (used by tests/legacy clients); everything else runs as the auto-provisioned
      local user, so the app never requires a login.
      """
      if auth and auth.credentials:
          try:
              payload = decode_token(auth.credentials, expected_type="access")
              ...
          except jwt.InvalidTokenError:
              pass                      # invalid token → fall through!
      return get_or_create_local_user(db)
  ```
  and
  ```python
  user = User(
      email=LOCAL_USER_EMAIL,
      hashed_password=get_password_hash(LOCAL_USER_EMAIL),
      name=LOCAL_USER_NAME,
      personal_owner_id=owner.id,
      is_admin=True,
  )
  ```
- **Why critical:** `docs/architecture.md` documents "local-first auth" as intentional for single-user mode, but the implementation makes the fallback unconditional and environment-independent:
  1. A **garbage or expired token does not fail** — it is swallowed (`except jwt.InvalidTokenError: pass`) and the caller is promoted to the local **admin** (`is_admin=True`, `auth.py:132-138` then passes).
  2. There is no `ENVIRONMENT == "production"` gate anywhere in this path. The moment this app is reachable beyond loopback (docker-compose self-host per repo layout, LAN, reverse proxy), every endpoint — document CRUD, exports, Zotero sync with stored API keys, plugin hook execution, team management — is writable by anonymous traffic.
  3. All ~90 routes derive authorization from this single dependency, so the blast radius is the entire API.
  4. The WebSocket path mirrors it: an empty `token` field joins the room as the local user (`collaboration.py:189-198`).
- **Fix:** Gate the fallback explicitly, e.g.
  ```python
  if settings.ENVIRONMENT.strip().lower() != "development":
      raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
  ```
  and reject invalid tokens instead of swallowing them (`raise` in the `except`). Better: introduce a first-class `LOCAL_MODE` setting (default `True` only for fresh local installs) consulted by `get_current_user`. Keep `get_current_admin_user` meaningful by ensuring the fallback identity cannot be admin outside development.

#### C-2. `.env` file is never loaded — the documented configuration mechanism is inert
- **File:** `apps/api/app/core/config.py:20-112` (esp. line 112); `.env` present at `apps/api/.env`
- **Snippet:**
  ```python
  model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")
  ```
  with fields defaulting via `os.getenv(...)` at class-definition time:
  ```python
  SECRET_KEY: str = os.getenv("SECRET_KEY", DEFAULT_DEV_SECRET_KEY)
  ```
- **Why critical:** `pydantic-settings` only reads `.env` when `env_file=".env"` is declared in `SettingsConfigDict`. It is not. Consequently the committed `apps/api/.env` (which sets `SECRET_KEY`, `DATABASE_URL`, `CORS_ORIGINS`, `UPLOAD_DIR`, GROBID/OLLAMA hosts…) is **never read by the application**. Anyone editing `.env` per the file's own instructions ("Copy this file to .env and adjust variables") will see their changes silently ignored unless the shell/container happens to export identical names. This is a correctness/security trap: e.g., changing `SECRET_KEY` in `.env` does nothing, while operators believe it did.
- **Fix:** Add `env_file=".env"` (plus `env_file_encoding="utf-8"`) to `SettingsConfigDict`, remove the per-field `os.getenv()` defaults (let pydantic-settings handle env resolution), and keep typed fields with plain Python defaults. Optionally validate `ENVIRONMENT` with `Literal["development", "test", "production"]`.

### HIGH

#### H-1. Any logged-in user can trigger host software installation and process launch
- **File:** `apps/api/app/api/v1/endpoints/provider_settings.py:151-158`; engine in `apps/api/app/services/tabby_setup_service.py`
- **Snippet:**
  ```python
  @router.post("/ai/autocomplete-settings/setup")
  def run_tabby_setup(current_user: User = Depends(get_current_user)):
      """
      Best-effort one-click Tabby setup: installs the CLI when missing
      (winget/Homebrew), starts `tabby serve --model <model> --device cpu` detached,
      ...
      """
      return tabby_setup_service.setup(health_probe=lambda: llm_service.probe_tabby(force=True))
  ```
- **Why high:** Unlike sibling mutation endpoints (`register_plugin`, `toggle_plugin`, `update_plugin_config`) which correctly use `get_current_admin_user`, this endpoint downloads and executes installers (`winget`/Homebrew) and spawns detached processes using only `get_current_user`. Under C-1 that means *anonymous* internet users can cause repeated installer executions and process launches on the host. Even in local mode it violates the codebase's own privilege convention. Mitigating note: the service uses fixed argv lists (no shell interpolation), so this is process/install abuse rather than direct command injection.
- **Fix:** Require `get_current_admin_user`; additionally disable the endpoint entirely when `ENVIRONMENT == "production"` or when bound address ≠ loopback; add a concurrency lock so concurrent calls can't double-install.

#### H-2. WebSocket handler holds a pooled DB session for the entire socket lifetime
- **File:** `apps/api/app/api/v1/endpoints/collaboration.py:226-242` with `get_db` from `app/core/database.py:29-34`
- **Snippet:**
  ```python
  @router.websocket("/ws/collaborate/{document_id}")
  async def websocket_collaboration(
      websocket: WebSocket,
      document_id: str,
      db: Session = Depends(get_db),
  ):
      await websocket.accept()
      user = await _authenticate_websocket(websocket, db, document_id)
      ...
      while True:   # hours-long receive loop
  ```
- **Why high:** `get_db` yields a `Session` whose connection stays checked out until the dependency exits — which for a WebSocket is when the socket disconnects. The pool default for PostgreSQL is `pool_size=5, max_overflow=10`: ~15 simultaneous collaboration sessions exhaust the pool and stall **every HTTP request** (they block waiting for a connection), producing an app-wide outage triggered by ordinary collaborative editing. The code even demonstrates the correct pattern elsewhere: `_persist_doc_edit` creates its own short-lived `SessionLocal()` per operation (`collaboration.py:40-61`).
- **Fix:** Use the DB only inside `_authenticate_websocket` via a locally scoped `with SessionLocal() as db:` block, close it before entering the message loop, and keep using the existing per-edit session pattern for persistence.

#### H-3. Cluster of blocking synchronous I/O executed directly inside `async def` coroutines
Multiple hot paths violate the FastAPI rule "make sure blocking code is not run inside `async` functions"; these stall the event loop for all concurrent requests:

| # | Location | Blocking operation in async context |
|---|---|---|
| a | `endpoints/graphs.py:40-47` + `services/graph_service.py:194` | `discover_related_papers` is `async def` yet runs `_check_project_access` (two sync `db.query` round-trips) and later `db.query(Paper)...all()` inline on the event loop |
| b | `services/provider_cache_service.py:83-99,116-121` called from `identifier_resolver.py:75,174,247` and `literature_search_service.py:111-121` inside `async def resolve_*` / `async def search_*` | Sync `redis.Redis.get/setex` network I/O (socket_timeout 1s each) executed in coroutines — up to ~2s event-loop stall per lookup when Redis is slow |
| c | `endpoints/papers.py:101-132` (`_stream_to_disk`) | `open(file_path, "wb")` + `out.write(chunk)` blocking disk writes interleaved with `await file.read(...)`; a 50 MB upload performs dozens of blocking writes on the loop |
| d | `endpoints/papers.py:135` | `PDFValidator.validate_pdf_file(file_path, ...)` — sync `os.path.getsize` + file read inside `async def upload_paper` |
| e | `services/pdf_extractor.py:146-147` (`_extract_with_grobid`) | Sync `open(file_path, "rb")` handed to `httpx.AsyncClient.post(files=...)`; multipart body reading of up to 50 MB happens synchronously from the file object inside the async call |
| f | `endpoints/papers.py:98` | `get_upload_dir(project_id)` → `os.makedirs(...)` (sync FS syscall) in async flow |

- **Why high:** The codebase otherwise shows clear awareness of this class of bug (deliberate `anyio.to_thread.run_sync` for access checks and saves in the same file, thread-offloaded pdfplumber), which makes these leftovers both impactful and easy to miss. Under load (concurrent uploads/discoveries with Redis hiccups), the single-threaded event loop stalls serialize the whole service.
- **Fix:** (a) wrap the access-check + paper fetch in `anyio.to_thread.run_sync`; (b) move cache reads/writes into threadpool or make the cache API async (`redis.asyncio` like `collaboration.py` already does); (c) use `await anyio.open_file(...)` or wrap the entire save routine in `run_sync`; (d/e) wrap in `run_sync` or pre-read the file bytes in a thread before posting.

#### H-4. Unbounded retrieval limit reaches the retrieval engine
- **Files:** `app/schemas/models.py:340-346` (`RAGSearchRequest`), `endpoints/chat.py:138-147`, `services/rag_service.py:332-433`
- **Snippet:**
  ```python
  class RAGSearchRequest(BaseModel):
      query: str
      ...
      limit: int = 5          # no ge/le constraint
      threshold: float = 0.2  # unvalidated range
  ```
  ```python
  passages = rag_service.hybrid_search(
      ..., limit=data.limit or 5, min_threshold=data.threshold or 0.18,
  )
  ```
  In `hybrid_search`, the top-k heap grows until `len(top_heap) < limit`:
  ```python
  if len(top_heap) < limit:
      heapq.heappush(top_heap, (hybrid_score, next(tie_breaker), candidate))
  ```
- **Why high:** `limit=100_000_000` in the request body makes the heap retain *every* candidate chunk (each holding full passage text + metadata) — O(library) memory amplification per request, trivially repeatable. Other list endpoints carefully clamp with `Query(ge=1, le=500)`; this one body-driven parameter was missed. `threshold` likewise accepts NaN-ish/negative values unchecked.
- **Fix:** `limit: int = Field(5, ge=1, le=50)`, `threshold: float = Field(0.2, ge=0.0, le=1.0)`; belt-and-braces `limit = min(limit, 50)` inside `hybrid_search`.

#### H-5. Startup migrations run in-process without coordination — unsafe with multiple workers/replicas
- **File:** `apps/api/app/main.py:21-39,53-62`
- **Snippet:**
  ```python
  @asynccontextmanager
  async def lifespan(app: FastAPI):
      _run_migrations()
      ...
  ```
  plus the heuristic:
  ```python
  elif tables:
      logger.info("Existing pre-Alembic database detected (%d tables); stamping baseline revision", len(tables))
      command.stamp(alembic_cfg, "head")
  ```
- **Why high:** With `uvicorn --workers N` (or >1 replica), N processes race Alembic upgrades concurrently — duplicate/steps racing on `alembic_version` produce corruption risk. Separately, blind `stamp("head")` on any non-empty legacy DB asserts it matches head even if its schema diverged, permanently masking drift. Also note `inspect(engine)` + Alembic run are fully blocking inside the async lifespan (acceptable at startup, worth noting for consistency).
- **Fix:** Run migrations as a separate deploy step (`fastapi run` + entrypoint container running `alembic upgrade head`), or take an advisory lock (PostgreSQL `pg_advisory_lock`) around `_run_migrations`, and gate multi-worker startup behind `COMMAND_RUNS_MIGRATIONS=1` on worker 0 only. Replace the blanket stamp with a revision-aware baseline.

### MEDIUM

#### M-1. No security headers anywhere
- **File:** `app/main.py:77-88` (only middleware added: error envelope, tracing, CORS); verified by grep — zero occurrences of `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Content-Security-Policy` in `app/`
- **Fix:** Add a small middleware (or `secure` / custom) emitting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS when behind TLS; consider CSP for the docs pages kept enabled outside production.

#### M-2. Rate limiting keyed on spoofable `X-Forwarded-For`
- **File:** `app/core/rate_limit.py:18-22`
- **Snippet:**
  ```python
  def get_client_ip(request: Request) -> str:
      forwarded_for = request.headers.get("x-forwarded-for")
      if forwarded_for:
          return forwarded_for.split(",")[0].strip()
  ```
- **Impact:** Any client can rotate fake `X-Forwarded-For` values to obtain unlimited login/register brute-force attempts, defeating the limiter that protects credential endpoints. Also the per-key `defaultdict(deque)` map grows without bound (one entry per forged IP) — a memory-leak vector (`rate_limit.py:29`).
- **Fix:** Only honor XFF when the immediate peer is a trusted proxy (configure proxy-count / trusted CIDRs), else use `request.client.host`. Cap or periodically prune `_hits`.

#### M-3. `BaseHTTPMiddleware` for both observability layers
- **File:** `app/core/middleware.py:21,47`
- **Impact:** Starlette's `BaseHTTPMiddleware` wraps responses through an internal queue; with two stacked instances plus SSE streaming endpoints (`chat/stream`, `stream-autocomplete`) it adds per-chunk overhead, historically breaks `BackgroundTask`s/contextvars propagation, and converts some exceptions into ambiguous states. The error-envelope layer would be more robust as pure-ASGI middleware.
- **Fix:** Rewrite `GlobalErrorEnvelopeMiddleware` (and optionally tracing) as raw ASGI middleware (`async def __call__(self, scope, receive, send)`), which also guarantees headers can be attached before body send.

#### M-4. Plugin hook execution available to every authenticated user
- **File:** `app/api/v1/endpoints/plugins.py:37-57`
- **Snippet:** `execute_hook(... current_user: User = Depends(get_current_user) ...)` fans a payload to all enabled plugins' imported functions.
- **Impact:** Combined with C-1, anonymous users can repeatedly invoke arbitrary allow-listed plugin code paths with attacker-controlled payloads (the runtime isolates failures, but not cost). Registration/toggle are admin-gated; execution should match.
- **Fix:** Use `get_current_admin_user` here too, or expose execution solely through internal feature flows (paper extraction/export) rather than a public POST.

#### M-5. Cloud LLM API keys stored in plaintext JSON with non-atomic writes
- **File:** `app/services/provider_settings.py:110-133`
- **Snippet:**
  ```python
  def _store_path() -> Path:
      return Path(settings.UPLOAD_DIR).resolve().parent / "provider_keys.json"
  ...
  path.write_text(json.dumps(store, indent=2), encoding="utf-8")
  ```
- **Impact:** OpenAI/Anthropic keys sit unencrypted next to uploaded PDFs; a directory-traversal bug or backup leak exposes paid credentials. `write_text` is not atomic — a crash mid-write truncates the store (silently reset by `_load_store`'s broad `except Exception`, wiping keys). Masking over the API is done well (`mask_key`, lines 136-141).
- **Fix:** Atomic write via temp file + `os.replace`; restrict file perms (0600); consider OS keyring/DPAPI or at minimum Fernet encryption keyed from `SECRET_KEY`; alert loudly in docs for server deployments.

#### M-6. Multi-step writes committed non-atomically
- **Files:** `endpoints/teams.py:30-40` (Owner committed, then Membership committed separately — crash between leaves an orphan team Owner nobody belongs to); `endpoints/version_history.py:149-171` (restore commits document mutation, then commits the checkpoint — crash between yields a mutated doc with no restore record)
- **Fix:** Single `db.add_all([owner, membership]); db.commit()` and one transaction for restore (mutate doc + insert checkpoint, one commit).

#### M-7. Team-member invite leaks account existence (user enumeration)
- **File:** `endpoints/teams.py:206-208`
- **Snippet:** `raise HTTPException(status_code=404, detail=f"User with email {member_in.email} not found")`
- **Impact:** Contradicts the deliberately generic register/login messages (`auth.py:61-64,79-83`); enables confirmation of registered emails in any multi-user deployment.
- **Fix:** Return a neutral success-shaped response ("Invitation pending") or a generic 404 without echoing the email; note the tension with local-first UX and decide explicitly.

#### M-8. Missing input size ceilings across free-text schema fields
- **File:** `app/schemas/models.py` — e.g. `ChatRequest.message` (:308), `AIEditRequest.text` (:486), `AutocompleteRequest.prefix_text` (:446), `CommentCreate.content` (:827-832), `AnnotationCreate.selected_text` (:198-204), `ContextRankingRequest.paragraph_text` (:422-426); contrast with the good `UserCreate.password` bounds (:11) and `q` Query bounds in `research.py:18-20`
- **Impact:** Multi-megabyte strings flow into regex-heavy pipelines (`split_sentences`, BM25-style scoring, difflib `SequenceMatcher` in version diff — quadratic worst case at `version_history.py:205`), enabling cheap CPU exhaustion. Note `BibtexImportRequest` is checked post-parse (`citations.py:335-336`): FastAPI has already buffered/parsed the full body, so the 2 MB guard doesn't protect transport.
- **Fix:** `Field(max_length=...)` on all prose fields (e.g., 8k–64k chars), enforce body-size limits at the server/proxy layer, and apply `sanitize_surrogates` (already implemented in `text_utils.py`) at ingestion boundaries.

#### M-9. `GET /documents/{id}/versions` returns full content of every revision, unpaged
- **File:** `endpoints/version_history.py:64-79` with `VersionResponse` including `content_json` + `plain_text` (`schemas/models.py:869-881`)
- **Impact:** A long-lived document with hundreds of snapshots ships its entire history (potentially hundreds of MB) in one JSON response — latency, memory, and bandwidth blowup.
- **Fix:** Paginate; create a `VersionSummaryResponse` (id, number, author, summary, created_at) for the list, returning content only in `GET .../versions/{version_id}`.

#### M-10. Over-broad CORS with credentials
- **File:** `app/main.py:82-88`
- **Snippet:** `allow_credentials=True, allow_methods=["*"], allow_headers=["*"]`
- **Impact:** With credentials allowed, `*` methods/headers maximize exposed surface; fine for localhost, sloppy for self-host. Origins themselves are correctly restricted.
- **Fix:** Enumerate needed methods (`GET, POST, PATCH, PUT, DELETE, OPTIONS`) and headers (`Authorization, Content-Type, X-Request-ID`); keep origins strict.

#### M-11. Sync `Session` injected into async endpoints without threadpool (pattern inconsistency invites future bugs)
- **Files:** `endpoints/citations.py:240-247` (`resolve_identifier` takes no db — OK), `endpoints/graphs.py:41` (covered H-3a), `endpoints/collaboration.py:361` (`get_active_collaborators` is sync — OK). The systemic risk: nothing marks which endpoints are safe to convert to `async def`; three of the six `async def` route handlers currently contain direct sync ORM calls (H-3). Additionally `provider_settings.py` endpoints perform blocking `subprocess.run`/disk probes synchronously in `def` handlers (threadpool — correct but slow, occupying threads up to 10 s in `probe/status` paths).
- **Fix:** Adopt a lint rule (e.g., custom ruff/flake8 plugin or review checklist): any `async def` route must not reference `db.query(...)`. Standardize on the `Annotated[Session, Depends(get_db)]` type alias so sync/async intent is greppable.

#### M-12. `stream_autocomplete` SSE lacks the no-cache/anti-buffering headers used elsewhere
- **File:** `endpoints/ai_writing.py:80-83` vs `endpoints/chat.py:110-114`
- **Snippet:** `return StreamingResponse(ai_writing_service.stream_autocomplete(...), media_type="text/event-stream",)` — no `Cache-Control: no-cache`, no `X-Accel-Buffering: no`.
- **Impact:** Proxies (nginx default buffering) will delay/deny the single-frame SSE delivery; inconsistent behavior between the two streaming endpoints.
- **Fix:** Mirror chat's header set. Longer term, adopt the modern `response_class=EventSourceResponse` + `ServerSentEvent` pattern for both streams (removes hand-built `data:` framing).

#### M-13. Health endpoint probes Redis synchronously and reaches into a private method
- **File:** `endpoints/health.py:30-43` (`provider_cache_service._get_redis()`, `redis_client.ping()` with 1 s socket timeouts inside request handling)
- **Impact:** `/health` latency spikes to ≥1–2 s whenever Redis is degraded — dangerous for orchestrator health checks that kill on timeout; also couples the probe to another service's internals.
- **Fix:** Cache the ping result for a few seconds, lower timeouts, or drop Redis from readiness (report it in a separate diagnostics route).

### LOW

#### L-1. Deprecated status constant `HTTP_413_REQUEST_ENTITY_TOO_LARGE`
- **File:** `endpoints/papers.py:92,119` — modern Starlette exposes `HTTP_413_CONTENT_TOO_LARGE` (and the older alias may be removed). Fix: switch constant; same numeric code.

#### L-2. String-literal enums instead of `Literal`/`Enum` types
- **Files:** `schemas/models.py` — `ChatMessage.role` (:303), `ChatRequest.mode` (:309), `AskPaperAIRequest.prompt_type` (:234), `ExportRequest.export_format/citation_style` (:538-542), `GroundedSegment.grounding_state` (:291), `PluginManifest.plugin_type` (:951-953), etc. Only `TeamMemberAdd.role` validates via `field_validator` (:780-786). Impact: OpenAPI docs show bare `string`; invalid values surface as 500-path logic errors or silent normalization (`_resolve_mode` in `chat.py:23-25` coerces bad modes to "project"). Fix: `mode: Literal["document","library","project","general"] = "project"` → automatic 422s + accurate docs.

#### L-3. Legacy `Optional[X] = Depends(...)` style throughout; `Annotated` never used
- **Files:** all routers (≈80 injection sites). The skill-recommended `CurrentUserDep = Annotated[User, Depends(get_current_user)]` aliases would shrink signatures and eliminate the `current_user: User = Depends(...)` repetition visible in every function. Purely ergonomic/consistency, but it is the single largest stylistic deviation from current best practice.

#### L-4. Prefix/tags declared at include-site, none at router level
- **File:** `app/api/v1/api.py:27-46` sets tags in `include_router(...)`; individual endpoints embed full paths (`@router.post("/auth/register")`, `router = APIRouter()` bare at `auth.py:28`). Recommended shape is `APIRouter(prefix="/auth", tags=["auth"])`. Consequence: path typos are easier, tag lists live far from definitions, and shared dependencies can't be attached per-router.

#### L-5. Unused `request: Request` parameters
- **File:** `endpoints/auth.py:54,72,89` — `request` accepted but unused in `register/login/refresh_tokens` (rate-limit dep takes its own `Request`). Dead parameters pollute signatures/docs.

#### L-6. Router calls service private methods / internals
- **Files:** `papers.py:549` (`rag_service._llm_grounded_answer`), `health.py:33` (`provider_cache_service._get_redis()`). Fix: promote to public helpers (`rag_service.grounded_answer(...)`, `provider_cache_service.redis_ping()`).

#### L-7. Export POST/GET handlers duplicate ~40 lines
- **File:** `endpoints/export.py:19-68` vs `71-123`. Extract a shared `_render_export(document, db, fmt, style, bib, trust)` helper; keeps Content-Disposition logic in one place.

#### L-8. Hand-rolled BibTeX parser mishandles nested braces
- **File:** `endpoints/citations.py:338-355` — field regex `\{([^}]*)\}` stops at the first `}`, corrupting titles like `{The {BERT} Model}`. The repo already carries a real BibTeX parser boundary in `packages/citations` (per architecture.md); at minimum switch to a brace-depth scanner. Also `entry_regex` lookahead `(?=\n@|\n*$)` misses `@` entries not preceded by newline.

#### L-9. Silent bcrypt 72-byte password truncation
- **File:** `services/auth.py:24,30` — `plain_password.encode("utf-8")[:72]` quietly truncates; two distinct long passwords sharing a 72-byte prefix collide. Fix: reject `len(password.encode()) > 72` with 422 (schema max_length=128 chars is insufficient because multibyte chars count double).

#### L-10. WS exception tuple contains redundant catch-all
- **File:** `endpoints/collaboration.py:177-181` — `except (asyncio.TimeoutError, WebSocketDisconnect, json.JSONDecodeError, Exception)` — `Exception` subsumes the rest and also masks programming errors during handshake. Catch `Exception` alone with explicit logging, or narrow precisely.

#### L-11. Broadcast failures silently swallowed
- **File:** `endpoints/collaboration.py:141-154` (`except Exception: pass` around both Redis publish and per-socket sends). At minimum `logger.debug` the failure; silent loss makes "message didn't arrive" undebuggable.

#### L-12. `collab_manager` builds a Redis client at import time
- **File:** `endpoints/collaboration.py:74-85` — module-import side effect opens a Redis connection (via `aioredis.from_url`) whenever `REDIS_URL` is set, independent of lifespan ordering; complicates test hermeticity (conftest clears `settings.REDIS_URL`, but the manager captured it at import).
- Fix: lazy-init on first connect (like `_ensure_relay` already does for the task).

#### L-13. `rank_citations_for_context` loads and scores the entire library in-process
- **File:** `endpoints/citations.py:489-545` — O(N×W) Python loop per keystroke-triggered popover request. Acceptable locally; flag with a result cap (`payload.limit` exists but scoring isn't bounded) and consider pushing candidate pre-filtering into SQL.

#### L-14. `create_team`/`add_team_member` lack idempotency and pagination
- `teams.py:169-193` member listing unpaged (fine for small teams; add `limit` guard ≤500 like other listers).

#### L-15. `root()` returns an untyped dict
- **File:** `main.py:93-95` — no `response_model`/return annotation; inconsistent with the disciplined rest of the API. Trivial fix: annotate `-> dict[str, str]`.

#### L-16. Runtime deps file mixes dev tooling
- **File:** `requirements.txt:19-23` — pytest/mypy/ruff ship in the same list as runtime deps (pyproject correctly separates them). Risk: production images carry test tooling; drift between the two files (already true: `python-docx>=1.1.0` vs `1.2.0`, `reportlab 4.2.0` vs `4.5.0`, `pypdf 4.2.0` vs `5.0.0`). Prefer single source (pyproject + lock) — a `requirements.lock` exists; ensure CI verifies it's current.

#### L-17. Repo working tree contains runtime artifacts
- `apps/api/api.log`, `openresearch_dev.db(-shm/-wal)`, `.env` committed alongside source (env example duplicates it). Outside `app/` scope but affects auditability; ensure `.gitignore` covers db/log/storage and keep only `.env.example`.

### INFO

#### I-1. Lifespan + shared HTTP client pool is well engineered
`http_client.py` handles loop re-binding, stale-client detection, and clean shutdown; `main.py` initializes/closes within `lifespan` (not deprecated `@on_event`). The Tabby autostart daemon thread is fire-and-forget with no shutdown join — harmless given daemon flag, but a `threading.Event` for graceful stop would be tidier (`main.py:42-50,58-59`).

#### I-2. Docs/OpenAPI disabled in production correctly
`main.py:71-73` — good practice; note the docs remain exposed in `development`/`test` only, matching intent.

#### I-3. Response-model discipline is strong overall
~90% of routes declare `response_model` with dedicated Create/Detail/ListItem schemas; serialization filtering works as intended. Gaps: `index_paper` (`papers.py:210`), `execute_hook`, `provider_settings` ad-hoc dicts (`:59-62,83,105,139,148`), `root()`, `get_active_collaborators` (`collaboration.py:373-374`), and the streaming endpoints (acceptable for SSE).

#### I-4. Status-code usage largely exemplary
201 on creates, 204 with `None` returns on deletes, 409 for optimistic-lock conflicts (`documents.py:110-114`), 413 for size caps, 503 for provider-unavailable (`papers.py:551-557`), `WWW-Authenticate` headers on 401s (`auth.py:80-83`). Minor: `register` returning the full token pair on 201 is unusual but workable for API clients.

#### I-5. Pagination is applied where it matters most
`skip/limit` with `Query(ge=..., le=...)` on documents/papers/citations/comments listings. Missing on annotations, versions (see M-9), team members (L-14). No shared `Page[T]` envelope — clients must infer totals from array length; consider adding `X-Total-Count` or a meta wrapper when the UI needs counts.

#### I-6. Dependency composition is clean and DRY where centralized
Single `get_db` yield dependency (no commit-in-dependency surprises), single `get_current_user` → `get_current_admin_user` chain, reusable `rate_limit_dependency(limiter)` factory (`rate_limit.py:51-56`). The `_check_doc_access`/`_check_project_access` helpers exist in four flavors (`intelligence.py:25-33`, `comments.py:22-31`, `version_history.py:52-61`, `zotero.py:21-32`, `graphs.py:19-25`) — consolidating into one `deps.py` would remove ~80 duplicated lines and drift risk (they already differ subtly in wording/roles).

#### I-7. Pydantic v2 usage is correct
`ConfigDict(from_attributes=True)` (never class-based `Config`), `field_validator`/`model_validator` with `mode=` args, `EmailStr`, `Field` constraints, no `RootModel`, no ellipsis-for-required, `model_validate` for ORM conversion (`auth.py:48`, `citations.py:412`), `model_dump(exclude_none=True)` (`provider_settings.py:122`). Forward-ref `"CommentResponse"` recursion handled via self-reference (`models.py:857`).

#### I-8. One HTTP operation per function respected everywhere
No mixed-method handlers found; streaming and blocking variants are separate operations (`chat` vs `chat/stream`).

#### I-9. Test harness reflects production wiring honestly
`tests/conftest.py` overrides `get_db` (dependency-override pattern), resets rate limiters, isolates the provider-key store to tmp, and forces `ENVIRONMENT=test` — the limiter's test bypass (`rate_limit.py:32-33`) is thereby exercised consistently. Coverage gate at 94% (`pyproject.toml:64`).

#### I-10. Observability basics present
Correlation IDs sanitized against log injection (`middleware.py:18,30`), latency header, structured error envelope with `request_id` echo, per-domain loggers. Missing piece: no request-body/DB-query timing or Prometheus-style metrics endpoint (fine to defer).

---

## Endpoint Inventory Table

Auth column: 🔓 = effective anonymous (local-mode fallback per C-1), 🔑 = bearer required (same fallback applies — see C-1), 🛡️ = admin-gated dep. RM = response_model. All routes live under prefix `/api/v1`.

| Route | Method | Auth | RM | Notes |
|---|---|---|---|---|
| `/health` | GET | None | ✗ (dict) | Combined liveness/readiness; sync Redis probe (M-13) |
| `/` (root) | GET | None | ✗ | Untyped dict (L-15); defined outside v1 |
| `/auth/register` | POST | None (rate-limited) | Token · 201 | Generic dup-email msg ✓; unused `request` (L-5) |
| `/auth/login` | POST | None (rate-limited) | Token | Generic failure msg ✓ |
| `/auth/refresh` | POST | None (rate-limited) | Token | Type-checked refresh tokens ✓ |
| `/auth/me` | GET | 🔑→🔓 | UserResponse | Fallback identity (C-1) |
| `/projects` | POST | 🔑→🔓 | ProjectResponse · 201 | Bare query param `owner_id` unannotated |
| `/projects` | GET | 🔑→🔓 | List[ProjectResponse] | Cross-membership aggregation ✓; unpaged |
| `/projects/{id}` | GET/PATCH/DELETE | 🔑→🔓 | ProjectResponse / 204 | Role ladder owner/editor enforced ✓ |
| `/documents` | POST | editor | DocumentResponse · 201 | |
| `/projects/{id}/documents` | GET | viewer | List[DocumentListItem] | Paged ✓ |
| `/documents/{id}` | GET/PATCH/DELETE | viewer/editor | DocumentResponse / 204 | Optimistic locking → 409 ✓ |
| `/projects/{id}/papers/upload` | POST | editor | PaperDetailResponse · 201 | Async streamed upload ✓; blocking spots (H-3c,d,f) |
| `/papers/{id}/index` | POST | editor | ✗ (dict) | Re-index chunks |
| `/projects/{id}/papers` | GET | viewer | List[PaperResponse] | Paged + `q` ILIKE search ✓ |
| `/papers/{id}` | GET | viewer | PaperDetailResponse | |
| `/papers/{id}/status` | GET | viewer | PaperStatusResponse | Chunk count subquery |
| `/papers/{id}/pdf` | GET | viewer | FileResponse | Streams from disk ✓; no Range support |
| `/papers/{id}` | DELETE | editor | 204 | File cleanup best-effort ✓ |
| `/papers/{id}/annotations` | GET/POST | viewer/editor | AnnotationResponse(s) · 201 | Unpaged list (I-5) |
| `/papers/{id}/annotations/{aid}` | PATCH/DELETE | editor | AnnotationResponse / 204 | |
| `/papers/{id}/ask` | POST | viewer | AskPaperAIResponse | Calls private svc method (L-6); 503 semantics ✓ |
| `/projects/{id}/chat` | POST | viewer | ChatResponse | Grounding contract enforced |
| `/projects/{id}/chat/stream` | POST | viewer | SSE (✗) | Manual SSE framing; sync generator OK; headers ✓ |
| `/projects/{id}/rag/search` | POST | viewer | RAGSearchResponse | **Unbounded `limit` (H-4)** |
| `/documents/{id}/citations` | GET/POST | viewer/editor | CitationDetailResponse(s) · 201 | joinedload ✓ |
| `/documents/{id}/citations/{cid}` | DELETE | editor | 204 | |
| `/citations/resolve-identifier` | POST | 🔑→🔓 | IdentifierResolveResponse | Async providers + cache ✓; sync Redis in async (H-3b) |
| `/projects/{id}/papers/add-by-identifier` | POST | editor | PaperResponse · 201/422 | Threadpool offload ✓ |
| `/projects/{id}/papers/import-bibtex` | POST | editor | BibtexImportResponse · 201 | Regex parser limits (L-8); post-parse size check (M-8) |
| `/projects/{id}/export/bibtex` | GET | viewer | BibtexExportResponse | Loads all papers |
| `/documents/{id}/export/bibtex` | GET | viewer | BibtexExportResponse | |
| `/documents/{id}/citations/rank-context` | POST | viewer | ContextRankingResponse | In-memory scorer (L-13) |
| `/projects/{id}/ai/autocomplete` | POST | viewer | AutocompleteResponse | Tabby fast-path |
| `/projects/{id}/ai/stream-autocomplete` | POST | viewer | SSE (✗) | Missing anti-buffer headers (M-12) |
| `/projects/{id}/ai/edit` | POST | viewer | AIEditResponse | Rule-based fallbacks labeled ✓ |
| `/projects/{id}/ai/outline` | POST | viewer | AIOutlineResponse | Deterministic template output |
| `/documents/{id}/export` | POST | viewer | File stream | Filename sanitized ✓; dup logic (L-7) |
| `/documents/{id}/export/{format}` | GET | viewer | File stream | Same as POST via query params |
| `/projects/{id}/intelligence/*` (verify-claims, research-gaps, literature-matrix, paper-review) | POST | viewer | Dedicated schemas | Clean helper reuse ✓ |
| `/projects/{id}/zotero/import` | POST | editor | ZoteroImportResponse | Sync httpx in def ✓ |
| `/projects/{id}/zotero/sync` | POST | editor | ZoteroSyncResponse | API key arrives in body (logged nowhere ✓) |
| `/system/provider-status` | GET | 🔑→🔓 | ProviderQuotaResponse | |
| `/system/provider-cache/clear` | POST | 🔑→🔓 | CacheClearResponse | Mutation on non-admin (cf. M-4) |
| `/research/search` | GET | 🔑→🔓 | LiteratureSearchResponse | Parallel gather ✓; per-source isolation ✓ |
| `/ai/providers` | GET | 🔑→🔓 | ✗ (dict) | Masked keys ✓ |
| `/ai/providers/{p}` | PUT/DELETE | 🔑→🔓 | ✗ | Plaintext store (M-5) |
| `/ai/rate-limit` | GET/PUT | 🔑→🔓 | ✗ | Validated RPM ✓ |
| `/ai/autocomplete-settings` | GET/PUT | 🔑→🔓 | AutocompleteSettingsResponse | Spawns bg thread on enable |
| `/ai/autocomplete-settings/probe` | POST | 🔑→🔓 | AutocompleteProbeResponse | Up to ~2 s sync probe |
| `/ai/autocomplete-settings/status` | GET | 🔑→🔓 | ✗ | Subprocess version probe |
| `/ai/autocomplete-settings/setup` | POST | 🔑→🔓 (!) | ✗ | **Installs/launches software — not admin-gated (H-1)** |
| `/teams` | POST/GET | 🔑→🔓 | TeamResponse(s) · 201 | Two-phase commit (M-6); N+1 avoided ✓ |
| `/teams/{id}` | GET/PATCH/DELETE | member/editor/owner | TeamResponse / 204 | Last-owner protections ✓ |
| `/teams/{id}/members` | GET/POST | member/owner | TeamMemberResponse(s) · 201 | Enumeration 404 (M-7); unpaged |
| `/teams/{id}/members/{mid}` | PATCH/DELETE | owner | TeamMemberResponse / 204 | Last-owner demote/remove guards ✓ |
| `/ws/collaborate/{doc_id}` | WebSocket | first-frame auth / local fallback | n/a | Session pinned for life (H-2); frame cap + WS rate limit ✓; Redis fan-out relay ✓ |
| `/documents/{id}/collaborators` | GET | viewer | ✗ (dict) | Presence snapshot |
| `/documents/{id}/comments` | GET/POST | viewer/editor | CommentResponse(s) · 201 | Nested replies, paged ✓; author-only edit ✓ |
| `/documents/{id}/comments/{cid}/replies` | POST | editor | CommentResponse · 201 | |
| `/documents/{id}/comments/{cid}` | PATCH/DELETE | editor + author/owner | CommentResponse / 204 | |
| `/documents/{id}/versions` | GET/POST | viewer/editor | VersionResponse(s) · 201 | Full-content list unpaged (M-9); unique-number retry ✓ |
| `/documents/{id}/versions/{vid}` | GET | viewer | VersionResponse | |
| `/documents/{id}/versions/{vid}/restore` | POST | editor | VersionResponse | Two commits (M-6) |
| `/documents/{id}/versions/{v1}/diff/{v2}` | GET | viewer | VersionDiffResponse | difflib; unbounded inputs (M-8) |
| `/projects/{id}/research-graph` | GET | viewer | ResearchGraphResponse | O(N²) reference join; fine locally |
| `/projects/{id}/discover-related` | GET | viewer | List[DiscoveryRecommendation] | **Sync ORM in async (H-3a)**; dedup vs library ✓ |
| `/plugins` | GET / `/plugins/hooks` GET | 🔑→🔓 | List[PluginResponse]/List[str] | Seeds defaults on read |
| `/plugins/hooks/{name}` | POST | 🔑→🔓 | PluginHookExecuteResponse | Non-admin execution (M-4); unknown hook → 400 ✓ |
| `/plugins/register` | POST | 🛡️ admin | PluginResponse · 201 | Namespace-validated entrypoints ✓ |
| `/plugins/{pid}/toggle` · `/config` | PATCH | 🛡️ admin | PluginResponse | |

Totals: **93 HTTP operations + 1 WebSocket**, across 21 routers.

---

## Positive Observations

1. **Modern lifespan usage** — resources (Alembic bootstrap, shared httpx pools) initialize/close in `lifespan`; no deprecated `on_event` handlers anywhere (`main.py:53-62`).
2. **Deliberate and mostly consistent sync-first architecture** — sync SQLAlchemy 2.0 (`Mapped`/`mapped_column`) with plain `def` endpoints (threadpool-executed) is a coherent, low-risk choice; the few genuinely async paths offload via `anyio.to_thread.run_sync` in most places (upload verify/save, collab persistence, pdfplumber extraction).
3. **Upload pipeline hardening is textbook** — declared Content-Length pre-check, streamed 1 MB chunks with running byte cap, `%PDF-` magic sniff on the first chunk, basename + charset-sanitized filenames, UUID-prefixed storage paths, partial-file removal on any failure, empty-upload rejection (`papers.py:55-137`, `pdf_extractor.PDFValidator`).
4. **Consistent ownership/RBAC layer** — every resource route funnels through `verify_user_access_to_owner` with explicit role ladders (viewer read / editor write / owner destroy), including last-owner demotion/removal guards in teams.
5. **Query-efficiency awareness** — `joinedload(Citation.paper)` (`citations.py:129`), aggregate GROUP BY instead of per-row counts (`teams.py:66-74`), `yield_per(500)` bounded-batch scanning with a fixed-size top-k heap and single batched hydration query (`rag_service.hybrid_search`).
6. **Production configuration guardrails** — `model_validator` rejects default/weak secrets, short secrets, and SQLite in production (`config.py:90-110`); docs/OpenAPI disabled in prod; CORS origins enumerated.
7. **Honest-AI contract implemented end-to-end** — LLM unavailable ⇒ deterministic, clearly-labeled fallbacks; "Insufficient evidence" is a first-class response state; unverified extractions are penalized in ranking and surfaced in status; prompts forbid invented citations.
8. **Abuse-resistant realtime channel** — first-message JWT auth keeping tokens out of URLs, 10 s auth deadline, 512 KB frame ceiling, 120-msg/10 s sliding window with policy-violation close codes, server-owned identity fields, Redis pub/sub relay with origin de-duplication for horizontal scale.
9. **Rate limiting on the right endpoints** — login/register/refresh each get tuned windows with `Retry-After` headers; cloud LLM spend gets a global RPM governor with graceful degradation.
10. **Pydantic v2 done right** — `ConfigDict(from_attributes=True)` ORM modes, `field_validator` complexity rules, `EmailStr`, no `RootModel`, no ellipsized required fields, forward-compatible self-referencing comment trees.
11. **Plugin sandbox** — entrypoint strings validated against format rules and an importable-namespace allowlist, resolution cached, per-plugin failure isolation with an execution log returned to callers.
12. **Test suite mirrors the app faithfully** — dependency overrides, hermetic env (Redis off, rate-limit resets, isolated key store), 94% coverage floor wired into pytest addopts.

---

## Prioritized Recommendations

### P0 — do before any non-loopback exposure
1. **Gate local-user fallback behind an explicit `LOCAL_MODE`/environment check and fail closed on invalid tokens** (C-1, `services/auth.py:108-129`, `collaboration.py:189-198`). This is the highest-leverage change in the codebase.
2. **Admin-gate (or environment-disable) `POST /ai/autocomplete-settings/setup`** (H-1, `provider_settings.py:151`).
3. **Wire `.env` into pydantic-settings** (`env_file=".env"`) and drop `os.getenv` field defaults (C-2, `config.py:112`) — verify with a startup log of loaded-source keys (values redacted).
4. **Release the DB session before the WS message loop** (H-2, `collaboration.py`) — reuse the established scoped-session pattern.

### P1 — near-term hardening
5. Fix the async-blocking cluster: graphs discovery ORM calls, sync-Redis cache inside async resolvers/searches, upload disk writes, Grobid file read, `validate_pdf_file` (H-3a–f).
6. Clamp `RAGSearchRequest.limit/threshold` and audit every remaining body/query int for `ge/le` (H-4, M-8); add `max_length` to all free-text schemas.
7. Stop migrations-at-startup races: advisory lock or out-of-process migrate step; replace blind `stamp("head")` (H-5).
8. Add security-headers middleware and tighten CORS method/header lists (M-1, M-10).
9. Harden the client-IP resolution for rate limiting (trusted-proxy aware) and bound the limiter key map (M-2).
10. Move provider keys to atomic, permission-restricted storage (consider encryption/keyring) (M-5); make `teams.create_team` and version restore single-transaction (M-6); neutralize invite enumeration (M-7).

### P2 — quality & maintainability
11. Consolidate the five duplicated access-check helpers and the duplicated export handlers into shared deps/utilities (I-6, L-7).
12. Adopt `Annotated[...]` dependency aliases (`DbDep`, `CurrentUserDep`, `AdminUserDep`) and router-level `prefix`/`tags` (L-3, L-4).
13. Convert stringly enums to `Literal` types for validation + OpenAPI fidelity (L-2); swap deprecated 413 constant (L-1).
14. Rewrite error-envelope middleware as pure ASGI; unify both SSE endpoints on `EventSourceResponse` with consistent headers (M-3, M-12).
15. Paginate + slim version listing (M-9); page annotations/team-member lists (I-5, L-14).
16. Restrict plugin-hook execution and cache-clear to admins (M-4, cf. provider_status).
17. Replace hand-rolled BibTeX parsing with a brace-aware tokenizer (L-8); enforce bcrypt 72-byte limit at the schema boundary (L-9).
18. Promote `_llm_grounded_answer` / `_get_redis` to public APIs; remove dead `request` params (L-6, L-5).
19. Split runtime vs dev requirements to a single locked source and reconcile the version drift (L-16); gitignore runtime artifacts (`api.log`, `*.db*`, `.env`) (L-17).
20. Consider an async SQLAlchemy engine + `AsyncSession` migration only if concurrent I/O-bound traffic justifies it — the current consistent-sync strategy is sound; the priority is enforcing its boundaries (M-11), not switching paradigms.
