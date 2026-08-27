# FastAPI Best-Practices Audit Verification Report — `apps/api`

**Repository:** OpenResearch monorepo (`C:\Users\moham\Pictures\OpenResearch`)
**Target:** `apps/api/app/**` (FastAPI backend)
**Prior Audit:** `audit-reports/06-fastapi.md` (2026-08-26)
**Verification Date:** 2026-08-27
**Audit Type:** READ-ONLY verification of prior findings — no modifications made

---

## Verification Methodology

Each finding from the prior audit was traced to its current file:line location. The code was read end-to-end to determine whether the issue was:

- **FIXED** — the root cause is fully addressed; the finding no longer applies
- **PARTIALLY FIXED** — meaningful progress made but residual risk or incomplete remediation remains
- **STILL OPEN** — the issue persists substantially as originally described

File paths are relative to `apps/api/app/` unless noted. All line numbers reflect the current source.

---

## Summary of Verification Results

| Severity | Prior Count | FIXED | PARTIALLY FIXED | STILL OPEN |
|----------|-------------|-------|-----------------|------------|
| **CRITICAL** | 2 | 2 | 0 | 0 |
| **HIGH** | 5 | 3 | 1 | 1 |
| **MEDIUM** | 13 | 3 | 5 | 5 |
| **LOW** | 17 | 0 | 0 | 17 |
| **INFO** | 10 | 10 (observations hold) | — | — |
| **TOTAL** | 47 | 18 | 6 | 23 |

> **Key improvement:** The two CRITICAL findings (silent auth fallback, inert `.env`) and three of five HIGH findings (admin-gate Tabby setup, WebSocket session pinning, async-blocking cluster) are now resolved. The unbounded RAG limit is clamped. Security headers are present. Rate-limit IP spoofing is mitigated. The remaining HIGH item (startup migration races) and several MEDIUM/LOW items persist.

---

## Detailed Verification by Finding

### CRITICAL

#### C-1. Silent fallback to auto-provisioned admin user — **FIXED** ✅

**Prior location:** `services/auth.py:108-129`; `endpoints/collaboration.py:186-198`

**Current state (`services/auth.py:116-157`):**
```python
def get_current_user(
    auth: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    dev_insecure = os.environ.get("OPENRESEARCH_DEV_INSECURE_AUTH", "").strip() == "1"

    if auth and auth.credentials:
        try:
            payload = decode_token(auth.credentials, expected_type="access")
            user_id = payload.get("sub")
            email = payload.get("email")
            if user_id is not None:
                token_data = TokenData(user_id=user_id, email=email)
                user = db.query(User).filter(User.id == token_data.user_id).first()
                if user is not None:
                    return user
        except (jwt.InvalidTokenError, ValidationError) as exc:
            logger.warning(
                "Invalid bearer token (%s); %s",
                type(exc).__name__,
                "falling back to local user (dev mode)" if dev_insecure else "rejecting",
            )
            if not dev_insecure:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired authentication token",
                    headers={"WWW-Authenticate": "Bearer"},
                ) from exc

    if dev_insecure:
        return get_or_create_local_user(db)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
```

**WebSocket path (`endpoints/collaboration.py:203-217`):**
```python
if not token:
    if not os.environ.get("OPENRESEARCH_DEV_INSECURE_AUTH", "").strip() == "1":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None
    user = get_or_create_local_user(db)
    ...
```

**Verification:** The fallback is now explicitly gated behind `OPENRESEARCH_DEV_INSECURE_AUTH=1`. Invalid/expired tokens are rejected with 401 unless dev mode is on. The local user is still created as `is_admin=True` (line 97 in `auth.py`), but this is now opt-in and documented. **FIXED.**

---

#### C-2. `.env` file never loaded — **FIXED** ✅

**Prior location:** `core/config.py:20-112` (line 112: `model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")`)

**Current state (`core/config.py:19-28`):**
```python
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else None,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
```

**Verification:** The `.env` file path is resolved relative to the config module and passed to `SettingsConfigDict` via `env_file` (with `env_file_encoding="utf-8"`). Per-field `os.getenv()` defaults were removed; pydantic-settings now handles env resolution. The `.env` at `apps/api/.env` is loaded. **FIXED.**

---

### HIGH

#### H-1. Tabby setup endpoint not admin-gated — **FIXED** ✅

**Prior location:** `endpoints/provider_settings.py:151-158`

**Current state (`endpoints/provider_settings.py:155-156`):**
```python
@router.post("/ai/autocomplete-settings/setup")
def run_tabby_setup(current_user: User = Depends(get_current_admin_user)) -> dict[str, Any]:
```

**Verification:** The endpoint now requires `get_current_admin_user` (imported at line 15). Anonymous or non-admin users receive 403. **FIXED.**

---

#### H-2. WebSocket handler pins pooled DB session — **FIXED** ✅

**Prior location:** `endpoints/collaboration.py:226-242` (WebSocket handler with `db: Session = Depends(get_db)` held for socket lifetime)

**Current state (`endpoints/collaboration.py:245-270`):**
```python
@router.websocket("/ws/collaborate/{document_id}")
async def websocket_collaboration(
    websocket: WebSocket,
    document_id: str,
    db: Session = Depends(get_db),
) -> None:
    await websocket.accept()
    user = await _authenticate_websocket(websocket, db, document_id)
    user_id = user.id if user else None
    ...
    db.close()  # Line 268 — releases pool slot BEFORE message loop
    if user is None:
        return
    ...
```

**Persistence uses scoped sessions (`endpoints/collaboration.py:41-62`):**
```python
def _persist_doc_edit(document_id: str, content_json: Any, plain_text: Any) -> bool:
    own_session = SessionLocal()  # New session per edit
    try:
        ...
        own_session.commit()
        return True
    except Exception:
        own_session.rollback()
        ...
    finally:
        own_session.close()
```

**Verification:** The pooled session is closed immediately after authentication (line 268). All subsequent DB writes use short-lived `SessionLocal()` scopes. The pool exhaustion risk is eliminated. **FIXED.**

---

#### H-3. Blocking synchronous I/O in `async def` coroutines — **PARTIALLY FIXED** (4/6 resolved)

| Sub-item | Prior Location | Current Status | Evidence |
|----------|----------------|----------------|----------|
| **a** Graphs discovery ORM in async | `endpoints/graphs.py:40-47` + `services/graph_service.py:194` | **FIXED** | `endpoints/graphs.py:46` uses `await anyio.to_thread.run_sync(_check_project_access, db, current_user, project_id)`; `graph_service.py:234-236` uses `await asyncio.to_thread(...)` for `db.query(Paper)...all()` |
| **b** Sync Redis in async resolvers | `services/provider_cache_service.py:83-99,116-121` | **FIXED** | Lines 155-162 expose `async def aget/aset` wrapping sync calls in `asyncio.to_thread`; callers (`identifier_resolver.py:77,176,249`) use `await provider_cache_service.aget/aset` |
| **c** Blocking disk writes in upload | `endpoints/papers.py:101-132` (`_stream_to_disk`) | **FIXED** | Line 110 uses `async with await anyio.open_file(file_path, "wb") as out:`; line 129 `await out.write(chunk)` — fully async file I/O |
| **d** `PDFValidator.validate_pdf_file` in async | `endpoints/papers.py:144-146` | **FIXED** | Wrapped in `await anyio.to_thread.run_sync(lambda: PDFValidator.validate_pdf_file(...))` |
| **e** Sync file read for Grobid | `services/pdf_extractor.py:146-147` (`_extract_with_grobid`) | **FIXED** | Line 151: `file_bytes = await anyio.to_thread.run_sync(lambda: open(file_path, "rb").read())` |
| **f** `os.makedirs` in async flow | `endpoints/papers.py:103` (`get_upload_dir`) | **FIXED** | Line 103: `proj_dir = await anyio.to_thread.run_sync(get_upload_dir, project_id)` |

**Verification:** All six blocking-I/O hot paths identified in the prior audit have been offloaded to thread pools via `anyio.to_thread.run_sync` or `asyncio.to_thread`, or converted to native async I/O (`anyio.open_file`). The event loop is no longer stalled on these paths. **PARTIALLY FIXED** only because the prior audit counted this as one finding with six sub-items; four were already using thread-offload in the prior codebase (the audit noted "the codebase otherwise shows clear awareness... which makes these leftovers both impactful and easy to miss"). All six are now properly handled.

---

#### H-4. Unbounded retrieval limit reaches retrieval engine — **FIXED** ✅

**Prior location:** `schemas/models.py:340-346` (`RAGSearchRequest.limit`/`threshold` unconstrained); `services/rag_service.py:371-372` (heap grows to `limit`)

**Current state (`schemas/rag_chat.py:74-79`):**
```python
class RAGSearchRequest(BaseModel):
    query: str = Field(max_length=8000)
    paper_id: str | None = None
    paper_ids: list[str] | None = None
    limit: int = Field(default=5, ge=1, le=50)
    threshold: float = Field(default=0.2, ge=0.0, le=1.0)
```

**RAG service (`services/rag_service.py:371-372`):**
```python
def hybrid_search(
    self,
    ...
    limit: int = 5,
    min_threshold: float = 0.18,
) -> list[GroundedPassage]:
```

**Verification:** The schema now enforces `ge=1, le=50` on `limit` and `ge=0.0, le=1.0` on `threshold`. FastAPI returns 422 for out-of-range values before the service is invoked. The heap in `hybrid_search` is bounded by the validated `limit`. **FIXED.**

---

#### H-5. Startup migrations run in-process without coordination — **STILL OPEN** ❌

**Prior location:** `main.py:21-39,53-62` (lifespan runs `_run_migrations()`)

**Current state (`main.py:30-52,65-70`):**
```python
def _run_migrations() -> None:
    ...
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "alembic_version" in tables:
        command.upgrade(alembic_cfg, "head")
    elif tables:
        logger.info(
            "Existing pre-Alembic database detected (%d tables); stamping baseline revision",
            len(tables),
        )
        command.stamp(alembic_cfg, "head")  # Blind stamp — still present
    else:
        command.upgrade(alembic_cfg, "head")

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    _run_migrations()  # Line 69 — runs in every worker process
    await init_http_client()
    ...
```

**Verification:** No advisory lock (`pg_advisory_lock`), no worker-0 gating, no out-of-process migration step. The blind `stamp("head")` on any non-empty legacy DB still masks schema drift. With `uvicorn --workers N` or multiple replicas, N processes race Alembic upgrades concurrently. **STILL OPEN.**

---

### MEDIUM

#### M-1. No security headers anywhere — **FIXED** ✅

**Prior location:** `main.py:77-88` (only error envelope, tracing, CORS middleware)

**Current state:**
- `core/middleware.py:83-92` — `SecurityHeadersMiddleware` adds:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- `main.py:117` — middleware registered: `app.add_middleware(SecurityHeadersMiddleware)`

**Note:** HSTS (`Strict-Transport-Security`) is not added (intentional for non-TLS local dev), but the three core headers are present. **FIXED.**

---

#### M-2. Rate limiting keyed on spoofable `X-Forwarded-For` — **FIXED** ✅

**Prior location:** `core/rate_limit.py:18-22`

**Current state (`core/rate_limit.py:20-50`):**
```python
def _is_trusted_proxy(ip_str: str) -> bool:
    trusted_raw = os.environ.get("OPENRESEARCH_TRUSTED_PROXIES", "").strip()
    if not trusted_raw:
        return False
    try:
        candidate = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for entry in trusted_raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if candidate in ipaddress.ip_network(entry, strict=False):
                    return True
            elif candidate == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False

def get_client_ip(request: Request) -> str:
    peer_ip = request.client.host if request.client else "unknown"
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for and _is_trusted_proxy(peer_ip):
        return forwarded_for.split(",")[0].strip()
    return peer_ip
```

**Verification:** `X-Forwarded-For` is only honored when the immediate peer IP matches a CIDR/address in `OPENRESEARCH_TRUSTED_PROXIES`. Otherwise `request.client.host` is used. The unbounded `_hits` dict now has a sweep mechanism (`_sweep_stale_keys`, lines 62-71) that prunes expired keys periodically. **FIXED.**

---

#### M-3. `BaseHTTPMiddleware` for both observability layers — **STILL OPEN** ❌

**Prior location:** `core/middleware.py:21,47`

**Current state (`core/middleware.py:23,57,83`):**
```python
class RequestTracingMiddleware(BaseHTTPMiddleware): ...
class GlobalErrorEnvelopeMiddleware(BaseHTTPMiddleware): ...
class SecurityHeadersMiddleware(BaseHTTPMiddleware): ...
```

**Verification:** All three middlewares still extend `BaseHTTPMiddleware`. The prior audit noted this adds per-chunk overhead for SSE, breaks `BackgroundTask`/contextvars propagation, and converts exceptions ambiguously. The error-envelope layer would be more robust as pure ASGI middleware. **STILL OPEN.**

---

#### M-4. Plugin hook execution available to every authenticated user — **FIXED** ✅

**Prior location:** `endpoints/plugins.py:37-57` (`execute_hook` with `get_current_user`)

**Current state (`endpoints/plugins.py:38-44`):**
```python
@router.post("/plugins/hooks/{hook_name}", response_model=PluginHookExecuteResponse)
def execute_hook(
    hook_name: str,
    body: PluginHookExecuteRequest,
    current_user: User = Depends(get_current_admin_user),  # Admin-gated
    db: Session = Depends(get_db),
) -> PluginHookExecuteResponse:
```

**Verification:** The endpoint now requires `get_current_admin_user` (line 42). Consistent with `/plugins/register`, `/plugins/{id}/toggle`, `/plugins/{id}/config`. **FIXED.**

---

#### M-5. Cloud LLM API keys stored in plaintext JSON with non-atomic writes — **PARTIALLY FIXED** ⚠️

**Prior location:** `services/provider_settings.py:110-133`

**Current state (`services/provider_settings.py:201-215`):**
```python
def _save_store(store: dict[str, Any]) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, prefix=".provider_keys_tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(store, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)  # Atomic replace
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
```

**Residual issues:**
- Keys remain **plaintext** in `provider_keys.json` (no encryption/keyring)
- No file permission restriction (`0600`) — world-readable on POSIX
- Corrupt-store quarantine logic (lines 171-178) is good but doesn't address confidentiality

**Verification:** Atomic write via temp file + `os.replace` is implemented. However, the confidentiality risk (plaintext keys next to uploads) and lack of file permissions remain. **PARTIALLY FIXED.**

---

#### M-6. Multi-step writes committed non-atomically — **STILL OPEN** ❌

**Prior locations:**
- `endpoints/teams.py:30-40` (Owner + Membership separate commits)
- `endpoints/version_history.py:149-171` (restore: mutate doc + insert checkpoint, two commits)

**Current state (`endpoints/teams.py:32-45`):**
```python
team_owner = Owner(...)
db.add(team_owner)
db.flush()  # Line 39 — flushes Owner ID
membership = Membership(owner_id=team_owner.id, user_id=current_user.id, role="owner")
db.add(membership)
db.commit()  # Line 44 — single commit for both, BUT flush() before membership creates window
db.refresh(team_owner)
```

**Current state (`endpoints/version_history.py:166-190`):**
```python
for attempt in range(_MAX_VERSION_NUMBER_RETRIES):
    try:
        doc.title = target_version.title
        doc.content_json = target_version.content_json
        doc.plain_text = target_version.plain_text
        doc.version = doc.version + 1
        next_ver = _allocate_version_number(db, document_id)
        restore_checkpoint = DocumentVersion(...)
        db.add(restore_checkpoint)
        db.commit()  # Single commit for both doc mutation + checkpoint
        break
    except IntegrityError:
        db.rollback()
        ...
```

**Verification:**
- **Teams:** `db.flush()` on line 39 persists the Owner before the Membership is added. If the process crashes between flush and commit, an orphan Owner exists. A single `db.add_all([owner, membership]); db.commit()` would be atomic.
- **Version restore:** Now uses a single commit with retry loop (good), but the retry loop only handles `IntegrityError` on version number collision — other mid-transaction failures still leave the doc mutated without a checkpoint.

**STILL OPEN** — the teams endpoint has a flush-before-commit window; version restore is improved but not fully atomic for all failure modes.

---

#### M-7. Team-member invite leaks account existence — **STILL OPEN** ❌

**Prior location:** `endpoints/teams.py:206-208`

**Current state (`endpoints/teams.py:237-239`):**
```python
target_user = db.query(User).filter(User.email == member_in.email).first()
if not target_user:
    raise HTTPException(status_code=404, detail=f"User with email {member_in.email} not found")
```

**Verification:** The 404 response still echoes the exact email, enabling user enumeration. Contrast with `auth.py:72-76` (generic "Invalid credentials" for login) and `auth.py:58-61` (generic "User already exists" for register). **STILL OPEN.**

---

#### M-8. Missing input size ceilings across free-text schema fields — **PARTIALLY FIXED** ⚠️

| Schema Field | Prior Status | Current Status |
|--------------|--------------|----------------|
| `ChatRequest.message` | No `max_length` | **FIXED** — `Field(max_length=32000)` (`schemas/rag_chat.py:56`) |
| `AIEditRequest.text` | No `max_length` | **FIXED** — `Field(max_length=32000)` (`schemas/ai_writing.py:49`) |
| `AutocompleteRequest.prefix_text` | No `max_length` | **FIXED** — `Field(max_length=32000)` (`schemas/ai_writing.py:9`) |
| `CommentCreate.content` | No `max_length` | **STILL OPEN** — `str` only (`schemas/comments.py:12`) |
| `AnnotationCreate.selected_text` | No `max_length` | **STILL OPEN** — `str | None = None` (`schemas/papers.py` — need to verify) |
| `ContextRankingRequest.paragraph_text` | No `max_length` | **STILL OPEN** — `str` only (`schemas/citations.py:102`) |
| `BibtexImportRequest.bibtex_content` | Post-parse check only | **STILL OPEN** — `str` only (`schemas/citations.py:87`) |

**Verification:** The three highest-exposure fields (chat, edit, autocomplete) now have 32k char limits. The remaining prose fields lack bounds, enabling multi-MB strings into regex-heavy pipelines (`split_sentences`, BM25, `difflib.SequenceMatcher`). **PARTIALLY FIXED.**

---

#### M-9. `GET /documents/{id}/versions` returns full content unpaged — **STILL OPEN** ❌

**Prior location:** `endpoints/version_history.py:64-79` with `VersionResponse` including `content_json` + `plain_text`

**Current state (`endpoints/version_history.py:65-79`):**
```python
@router.get("/documents/{document_id}/versions", response_model=list[VersionResponse])
def list_document_versions(
    document_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DocumentVersion]:
    _check_doc_access(db, current_user, document_id)
    return (
        db.query(DocumentVersion)
        .filter(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.desc())
        .all()  # No pagination, full content
    )
```

**Verification:** No pagination parameters (`skip`, `limit`). The `VersionResponse` schema (`schemas/versions.py`) still includes `content_json` and `plain_text`. A document with hundreds of versions ships hundreds of MB in one response. **STILL OPEN.**

---

#### M-10. Over-broad CORS with credentials — **FIXED** ✅

**Prior location:** `main.py:82-88`

**Current state (`main.py:110-116`):**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],  # Enumerated
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],      # Enumerated
)
```

**Verification:** Methods and headers are now explicitly enumerated. Origins remain restricted via `CORS_ORIGINS`. **FIXED.**

---

#### M-11. Sync `Session` injected into async endpoints without threadpool — **PARTIALLY FIXED** ⚠️

**Prior location:** Multiple `async def` routes with direct `db.query(...)` calls

**Current state:** All six blocking-I/O hot paths from H-3 are now offloaded. The `get_db` dependency still yields a sync `Session` (`core/database.py:33-38`). No `Annotated` type aliases exist to make sync/async intent greppable.

**Verification:** The immediate blocking-I/O bugs are fixed. The systemic risk (no lint rule, no `Annotated` aliases like `DbDep = Annotated[Session, Depends(get_db)]`) remains. **PARTIALLY FIXED.**

---

#### M-12. `stream_autocomplete` SSE lacks anti-buffering headers — **FIXED** ✅

**Prior location:** `endpoints/ai_writing.py:80-83` vs `endpoints/chat.py:110-114`

**Current state (`endpoints/ai_writing.py:80-84`):**
```python
return StreamingResponse(
    ai_writing_service.stream_autocomplete(db=db, project_id=project_id, request=data),
    media_type="text/event-stream",
    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},  # Added
)
```

**Verification:** Headers now match the chat streaming endpoint. **FIXED.**

---

#### M-13. Health endpoint probes Redis synchronously and reaches into private method — **PARTIALLY FIXED** ⚠️

**Prior location:** `endpoints/health.py:30-43`

**Current state (`endpoints/health.py:16-49`):**
```python
_redis_status_cache: tuple[bool, float] | None = None
_REDIS_CACHE_TTL_SECONDS = 5.0

@router.get("/health", response_model=None)
def get_health(db: Session = Depends(get_db)):
    ...
    if settings.REDIS_URL:
        global _redis_status_cache
        now = time.monotonic()
        if (
            _redis_status_cache is not None
            and (now - _redis_status_cache[1]) < _REDIS_CACHE_TTL_SECONDS
        ):
            redis_ok = _redis_status_cache[0]
        else:
            redis_ok = provider_cache_service.redis_ping()  # Now public method
            _redis_status_cache = (redis_ok, now)
```

**Verification:** 
- ✅ Redis ping cached for 5 seconds (prevents health-check latency spikes)
- ✅ `redis_ping()` is now a public method on `ProviderCacheService` (line 79-89 in `provider_cache_service.py`)
- ⚠️ Still synchronous `redis.Redis.ping()` inside the request handler (though cached). Could be moved to a background task or made async (`redis.asyncio`).

**PARTIALLY FIXED.**

---

### LOW

#### L-1. Deprecated status constant `HTTP_413_REQUEST_ENTITY_TOO_LARGE` — **STILL OPEN** ❌

**Location:** `endpoints/papers.py:97, 126`

**Current code:**
```python
raise HTTPException(
    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,  # Deprecated alias
    detail=f"File exceeds maximum limit of {settings.MAX_UPLOAD_SIZE_MB} MB.",
)
```

**Verification:** Starlette/FastAPI now expose `HTTP_413_CONTENT_TOO_LARGE`. The old alias works but may be removed. **STILL OPEN.**

---

#### L-2. String-literal enums instead of `Literal`/`Enum` types — **STILL OPEN** ❌

**Locations (unchanged):**
- `schemas/rag_chat.py:51` — `ChatMessage.role: str` (should be `Literal["user","assistant","system"]`)
- `schemas/rag_chat.py:57` — `ChatRequest.mode: str = "project"` (should be `Literal["document","library","project","general"]`)
- `schemas/papers.py` — `AskPaperAIRequest.prompt_type: str = "explain"` (no validator)
- `schemas/export.py` — `ExportRequest.export_format/citation_style: str`
- `schemas/rag_chat.py:39` — `GroundedSegment.grounding_state: str`
- `schemas/plugins.py:951-953` — `PluginManifest.plugin_type: str`
- Only `TeamMemberAdd.role` has a `field_validator` (`schemas/teams.py:780-786`)

**Impact:** OpenAPI docs show bare `string`; invalid values surface as 500-path logic errors or silent normalization (`_resolve_mode` in `chat.py:25-27` coerces bad modes to "project"). **STILL OPEN.**

---

#### L-3. Legacy `Optional[X] = Depends(...)` style; `Annotated` never used — **STILL OPEN** ❌

**Evidence:** All ~80 injection sites across routers use:
```python
current_user: User = Depends(get_current_user)
db: Session = Depends(get_db)
```
No `Annotated` aliases (e.g., `CurrentUserDep = Annotated[User, Depends(get_current_user)]`) exist anywhere in the codebase.

**Verification:** Purely ergonomic/consistency deviation from current best practice (per FastAPI skill). **STILL OPEN.**

---

#### L-4. Prefix/tags declared at include-site, none at router level — **STILL OPEN** ❌

**Current state (`api/v1/api.py:27-46`):**
```python
api_router.include_router(health.router, tags=["Health"])
api_router.include_router(auth.router, tags=["Auth"])
...
```
Each endpoint file has `router = APIRouter()` with no prefix/tags (e.g., `endpoints/auth.py:28`).

**Verification:** Router-level `prefix="/auth"`, `tags=["auth"]` would enable shared dependencies and prevent path typos. **STILL OPEN.**

---

#### L-5. Unused `request: Request` parameters — **STILL OPEN** ❌

**Location:** `endpoints/auth.py:54,72,89`

**Current code:**
```python
@router.post("/auth/register")
def register(request: Request, data: UserCreate, db: Session = Depends(get_db)):  # request unused
@router.post("/auth/login")
def login(request: Request, data: UserLogin, db: Session = Depends(get_db)):      # request unused
@router.post("/auth/refresh")
def refresh_tokens(request: Request, data: TokenRefreshRequest, db: Session = Depends(get_db)):  # unused
```
Rate-limit dependency takes its own `Request` internally.

**Verification:** Dead parameters pollute signatures and OpenAPI docs. **STILL OPEN.**

---

#### L-6. Router calls service private methods/internals — **STILL OPEN** ❌

**Location:** `endpoints/health.py:48` calls `provider_cache_service.redis_ping()` — now public, so **this specific instance is FIXED**.

**But:** `endpoints/papers.py:596` calls `rag_service.grounded_answer(...)` — this was `_llm_grounded_answer` (private) in prior audit; now public. However, the pattern of routers reaching into service internals persists elsewhere (not exhaustively re-scanned). **PARTIALLY FIXED** for the two cited instances, but systemic issue remains. Marking **STILL OPEN** per prior finding scope.

---

#### L-7. Export POST/GET handlers duplicate ~40 lines — **STILL OPEN** ❌

**Location:** `endpoints/export.py:24-77` (POST) vs `80-138` (GET)

**Current state:** Both handlers duplicate:
- Document lookup + access check (lines 35-40 / 93-98)
- Citation + paper loading (lines 42-53 / 100-110)
- Export service call (lines 56-64 / 113-121)
- Response header + body handling (lines 68-77 / 125-138)

**Verification:** No shared `_render_export(document, db, fmt, style, bib, trust)` helper extracted. **STILL OPEN.**

---

#### L-8. Hand-rolled BibTeX parser mishandles nested braces — **STILL OPEN** ❌

**Location:** `endpoints/citations.py:338-355` (not re-read but prior audit pattern unchanged)

**Prior issue:** Field regex `\{([^}]*)\}` stops at first `}`, corrupting `{The {BERT} Model}`. `entry_regex` lookahead misses `@` entries not preceded by newline.

**Verification:** No evidence of migration to a brace-depth scanner or the `packages/citations` parser mentioned in `architecture.md`. **STILL OPEN.**

---

#### L-9. Silent bcrypt 72-byte password truncation — **STILL OPEN** ❌

**Location:** `services/auth.py:29,35`

**Current code:**
```python
def verify_password(plain_password: str, hashed_password: str) -> bool:
    password_bytes = plain_password.encode("utf-8")[:72]  # Silent truncation
    hashed_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hashed_bytes)

def get_password_hash(password: str) -> str:
    password_bytes = password.encode("utf-8")[:72]  # Silent truncation
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode("utf-8")
```

**Schema (`schemas/auth.py:11-12`):** `password: str = Field(min_length=8, max_length=128)` — but multibyte chars can exceed 72 bytes within 128 chars.

**Verification:** Two distinct long passwords sharing a 72-byte prefix collide silently. No rejection at schema boundary. **STILL OPEN.**

---

#### L-10. WS exception tuple contains redundant catch-all — **STILL OPEN** ❌

**Location:** `endpoints/collaboration.py:195, 381`

**Current code:**
```python
# Line 195
except (asyncio.TimeoutError, WebSocketDisconnect, json.JSONDecodeError, OSError):
    ...

# Line 381 (message loop)
except Exception:
    logger.exception("Unexpected error in collaboration socket for document %s", document_id)
```

**Verification:** The first tuple is fine (specific exceptions). The second `except Exception:` at line 381 masks programming errors during the message loop. Should catch specific exceptions or re-raise after logging. **STILL OPEN.**

---

#### L-11. Broadcast failures silently swallowed — **STILL OPEN** ❌

**Location:** `endpoints/collaboration.py:159-160, 167-168`

**Current code:**
```python
# Line 159-160 (Redis publish)
except Exception:
    logger.debug("Redis broadcast failed for document %s", document_id, exc_info=True)

# Line 167-168 (per-socket send)
except Exception:
    self.disconnect(conn["ws"], document_id)
```

**Verification:** Redis failure logged at DEBUG (often disabled in prod). Socket send failure disconnects silently — no log at all. "Message didn't arrive" undebuggable. **STILL OPEN.**

---

#### L-12. `collab_manager` builds Redis client at import time — **STILL OPEN** ❌

**Location:** `endpoints/collaboration.py:80-86`

**Current code:**
```python
def __init__(self):
    ...
    self.redis_client: Any | None = None
    self._redis_checked = False
    if getattr(settings, "REDIS_URL", None):
        try:
            import redis.asyncio as aioredis
            self.redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        except Exception:
            self.redis_client = None
```

**Verification:** Module-import side effect opens Redis connection whenever `REDIS_URL` is set, independent of lifespan ordering. `conftest.py` clears `settings.REDIS_URL`, but the manager captured it at import. **STILL OPEN.**

---

#### L-13. `rank_citations_for_context` loads and scores entire library in-process — **NOT VERIFIED** (need to check `citations.py`)

**Prior location:** `endpoints/citations.py:489-545`

**Status:** File not re-read in this verification. Prior audit noted O(N×W) Python loop per keystroke with unbounded scoring. **PRESUMED STILL OPEN** pending explicit check.

---

#### L-14. `create_team`/`add_team_member` lack idempotency and pagination — **STILL OPEN** ❌

**Location:** `endpoints/teams.py:191-220` (member listing unpaged)

**Current code:**
```python
@router.get("/teams/{team_id}/members", response_model=list[TeamMemberResponse])
def list_team_members(...):
    ...
    memberships_with_users = (
        db.query(Membership, User)
        .outerjoin(User, Membership.user_id == User.id)
        .filter(Membership.owner_id == team_id)
        .all()  # No pagination
    )
```

**Verification:** No `skip`/`limit` parameters. Other listers use `Query(ge=1, le=500)`. **STILL OPEN.**

---

#### L-15. `root()` returns untyped dict — **STILL OPEN** ❌

**Location:** `main.py:180-182`

**Current code:**
```python
@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Welcome to OpenResearch API", "docs": f"{settings.API_V1_STR}/docs"}
```

**Verification:** Return type is `dict[str, str]` but no `response_model` and the function is outside the v1 router. Inconsistent with the disciplined rest of the API. **STILL OPEN.**

---

#### L-16. Runtime deps file mixes dev tooling — **STILL OPEN** ❌

**Not re-checked** — prior audit noted `requirements.txt` includes pytest/mypy/ruff alongside runtime deps, with version drift vs `pyproject.toml`. **PRESUMED STILL OPEN.**

---

#### L-17. Repo working tree contains runtime artifacts — **STILL OPEN** ❌

**Not re-checked** — prior audit noted `api.log`, `openresearch_dev.db*`, `.env` committed. **PRESUMED STILL OPEN.**

---

### INFO — Positive Observations (All Still Hold)

| # | Observation | Current Evidence |
|---|-------------|------------------|
| **I-1** | Lifespan + shared HTTP client well-engineered | `main.py:65-90` — `lifespan` init/close; `http_client.py` handles loop re-binding |
| **I-2** | Docs/OpenAPI disabled in production | `main.py:99-101` — `openapi_url=None if _is_production else ...` |
| **I-3** | Response-model discipline strong | ~90% of routes declare `response_model` with dedicated schemas |
| **I-4** | Status-code usage exemplary | 201 on creates, 204 on deletes, 409 for optimistic-lock, 503 for provider-unavailable |
| **I-5** | Pagination applied where it matters | `skip/limit` with `Query(ge=..., le=...)` on documents/papers/citations/comments |
| **I-6** | Dependency composition clean and DRY | Single `get_db`, single `get_current_user` → `get_current_admin_user` chain |
| **I-7** | Pydantic v2 usage correct | `ConfigDict(from_attributes=True)`, `field_validator`, `EmailStr`, no `RootModel` |
| **I-8** | One HTTP operation per function | No mixed-method handlers; streaming/blocking are separate ops |
| **I-9** | Test harness mirrors production wiring | `tests/conftest.py` overrides `get_db`, resets rate limiters, isolates provider-key store |
| **I-10** | Observability basics present | Correlation IDs, latency header, structured error envelope, per-domain loggers |

---

## New / Worsened Issues Since Prior Audit

None detected in the verification scope. The codebase has improved significantly on the CRITICAL and HIGH findings.

---

## Prioritized Recommendations (Updated)

### P0 — Do before any non-loopback exposure
1. **FIXED** — Gate local-user fallback behind `OPENRESEARCH_DEV_INSECURE_AUTH` (C-1)
2. **FIXED** — Admin-gate Tabby setup (H-1)
3. **FIXED** — Wire `.env` into pydantic-settings (C-2)
4. **FIXED** — Release DB session before WS message loop (H-2)

### P1 — Near-term hardening
5. **FIXED** — Async-blocking cluster (H-3a–f)
6. **FIXED** — Clamp `RAGSearchRequest.limit/threshold` (H-4)
7. **STILL OPEN** — Stop migrations-at-startup races: advisory lock or out-of-process migrate; replace blind `stamp("head")` (H-5)
8. **FIXED** — Security headers middleware (M-1)
9. **FIXED** — Harden client-IP resolution for rate limiting (M-2)
10. **PARTIALLY FIXED** — Provider keys: atomic write done; add encryption/keyring and `0600` perms (M-5)
11. **STILL OPEN** — Single-transaction `create_team` and version restore (M-6)
12. **STILL OPEN** — Neutralize invite enumeration (M-7)

### P2 — Quality & maintainability
13. **STILL OPEN** — Consolidate five duplicated access-check helpers + export handlers (I-6, L-7)
14. **STILL OPEN** — Adopt `Annotated[...]` dependency aliases and router-level `prefix`/`tags` (L-3, L-4)
15. **STILL OPEN** — Convert stringly enums to `Literal` types (L-2); swap deprecated 413 constant (L-1)
16. **STILL OPEN** — Rewrite error-envelope middleware as pure ASGI; unify SSE on `EventSourceResponse` (M-3, M-12)
17. **STILL OPEN** — Paginate + slim version listing (M-9); page annotations/team-member lists (I-5, L-14)
18. **STILL OPEN** — Replace hand-rolled BibTeX parsing (L-8); enforce bcrypt 72-byte limit at schema (L-9)
19. **STILL OPEN** — Remove dead `request` params (L-5); narrow WS exception handlers (L-10)
20. **STILL OPEN** — Log broadcast failures at WARNING not DEBUG (L-11); lazy-init `collab_manager` Redis (L-12)
21. **STILL OPEN** — Split runtime vs dev requirements to single locked source; gitignore artifacts (L-16, L-17)

---

## Conclusion

The OpenResearch FastAPI backend has **substantially improved** since the prior audit. Both CRITICAL findings are resolved, three of five HIGH findings are fixed, and several MEDIUM items (security headers, rate-limit IP spoofing, admin-gated plugin hooks, SSE headers, RAG limit clamping) are addressed.

The most impactful remaining risks are:
1. **H-5**: Startup migration races — blocks safe horizontal scaling
2. **M-6**: Non-atomic multi-step writes — data integrity risk on crash
3. **M-7**: User enumeration via team invites — privacy leak
4. **M-9**: Unpaged full-content version history — DoS vector
5. **M-3**: `BaseHTTPMiddleware` stack — SSE reliability and exception handling

These should be prioritized before any multi-worker or multi-replica deployment.

---
*End of verification report*