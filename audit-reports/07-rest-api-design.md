# REST API Design Audit — OpenResearch `apps/api`

> Audit ID: 07 · Area: REST API design (FastAPI HTTP surface) · Date: 2026-08-26
> Auditor: ox-alpha (read-only audit; no source files modified)

---

## Scope & Methodology

**In scope**

- The entire HTTP API surface of `apps/api` (Python FastAPI): every route registered through `app/api/v1/api.py` plus the root route and the WebSocket channel in `app/main.py` / `app/api/v1/endpoints/*`.
- Resource modeling & URL naming, HTTP method semantics, status-code correctness, idempotency, versioning, pagination/filtering/sorting consistency, error-envelope consistency (incl. RFC 7807 question), content-type handling, bulk operations, PATCH semantics, hypermedia needs, rate-limiting headers, OpenAPI documentation completeness, breaking-change risks, and cross-endpoint consistency.
- Conformance of the implemented API against the intended behavior described in `docs/OpenResearch_Spec.md` and `docs/architecture.md`.

**Out of scope / ignored**: `node_modules`, `.venv`, `.next`, `__pycache__`, coverage dirs, caches, `storage/`, `logs/`. Frontend (`apps/web`) was consulted only where an API contract question required it (it was not needed; the audit is backend-centric).

**Method**

1. Loaded the `rest-api-design` skill and applied its reference guidance (resource naming, query parameters, response formats, HTTP status codes, OpenAPI documentation, rate limiting headers) as an audit rubric.
2. Built a complete endpoint inventory by grepping all `@router.*` / `@app.*` decorators (`apps/api/app/**`), yielding **86 REST operations under `/api/v1`**, **1 WebSocket channel**, and **1 unversioned root route** (88 total operations).
3. Read every router module end-to-end, plus supporting infrastructure: `app/core/middleware.py`, `app/core/rate_limit.py`, `app/core/config.py`, `app/services/auth.py`, `app/services/plugin_runtime.py` / `plugin_service.py` (hook validation), and the Pydantic schema layer `app/schemas/models.py`.
4. Cross-checked each endpoint's declared status codes, response models, access-control pattern, pagination behavior, and error paths against the skill checklist and the product spec.
5. Verified absence of ETag / `X-RateLimit-*` / OpenAPI `example`/`json_schema_extra` usage via repo-wide grep (zero hits).

**Key files examined**: `apps/api/app/main.py`, `apps/api/app/api/v1/api.py`, all 19 modules in `apps/api/app/api/v1/endpoints/`, `apps/api/app/schemas/models.py`, `apps/api/app/services/auth.py`, `apps/api/app/core/{middleware,rate_limit,config}.py`, `apps/api/tests/test_openapi_schema.py`, `docs/OpenResearch_Spec.md`, `docs/architecture.md`.

---

## Executive Summary

The API is structurally sound for an early-stage product: clean `/api/v1` versioning, plural noun collections, near-universal `404 → 403` authorization ordering, correct `201`/`204` on most creates/deletes, optimistic-locking `409` on document updates, and a thoughtful correlation-ID/error-envelope middleware layer. However, it has one critical authentication-design hazard inherited from the intentional local-first mode, five systemic high-severity issues (error-envelope fragmentation, ungated global-config mutation endpoints, minimal rate-limit coverage, inconsistent resource-creation styles with unvalidated redundant parent IDs, and incomplete/unmetadata'd pagination), and a long tail of medium/low polish items (status-code misfires, undocumented response schemas, RPC verbs in URLs, no conditional requests, spec-drift on async processing and chat persistence).

**Counts per severity**

| Severity | Findings |
|---|---|
| CRITICAL | 1 |
| HIGH | 5 |
| MEDIUM | 10 |
| LOW | 10 |
| INFO | 9 |
| **Total** | **35** |

---

## Complete Endpoint Inventory

All paths are prefixed with `/api/v1` (`settings.API_V1_STR`) unless marked *(root)*. "Status codes" lists codes reachable per implementation (including framework-generated 422 validation errors and middleware-generated 500). Issues column summarizes endpoint-specific problems detailed later.

| # | Method | Path | Handler | Response model? | Status codes used | Issues (see §Detailed Findings) |
|---|---|---|---|---|---|---|
| 1 | GET | `/` *(root)* | `main.py::root` | ❌ | 200 | INFO-I1: unversioned, static message, no API index/HATEOAS |
| 2 | GET | `/health` | `health.py::get_health` | ❌ | 200, 503 | MED-M2: no response_model; otherwise well designed |
| 3 | POST | `/auth/register` | `auth.py::register` | ✅ Token | 201, 400 (dup email), 422, 429 | LOW-L5: 400-vs-409 defensible (anti-enumeration); rate-limited ✔ |
| 4 | POST | `/auth/login` | `auth.py::login` | ✅ Token | 200, 401, 422, 429 | ✔ `WWW-Authenticate`; rate-limited ✔ |
| 5 | POST | `/auth/refresh` | `auth.py::refresh_tokens` | ✅ Token | 200, 401, 422, 429 | MED-M6: no revocation/rotation-reuse detection |
| 6 | GET | `/auth/me` | `auth.py::get_me` | ✅ UserResponse | 200 | ✔ (never 401 due to C1 fallback) |
| 7 | POST | `/projects` | `projects.py::create_project` | ✅ | 201, 403, 404 (owner), 422 | HIGH-H4: redundant `owner_id` in **both** query and body |
| 8 | GET | `/projects` | `projects.py::list_projects` | ✅ | 200, 403 | HIGH-H5: **no pagination**, no total count |
| 9 | GET | `/projects/{project_id}` | `projects.py::get_project` | ✅ | 200, 403, 404 | ✔ ordering 404→403 |
| 10 | PATCH | `/projects/{project_id}` | `projects.py::update_project` | ✅ | 200, 403, 404 | ✔ proper PATCH semantics |
| 11 | DELETE | `/projects/{project_id}` | `projects.py::delete_project` | — | 204, 403, 404 | ✔ owner-role gate |
| 12 | POST | `/documents` | `documents.py::create_document` | ✅ | 201, 403, 404, 422 | HIGH-H4: flat create w/ `project_id` in body (vs nested elsewhere) |
| 13 | GET | `/projects/{project_id}/documents` | `documents.py::list_project_documents` | ✅ | 200, 403, 404 | ✔ skip/limit (ge/le bounded); HIGH-H5: no total metadata |
| 14 | GET | `/documents/{document_id}` | `documents.py::get_document` | ✅ | 200, 403, 404 | ✔ |
| 15 | PATCH | `/documents/{document_id}` | `documents.py::update_document` | ✅ | 200, 403, 404, **409** | ✔ optimistic lock via body `version`; MED-M5: not If-Match/ETag |
| 16 | DELETE | `/documents/{document_id}` | `documents.py::delete_document` | — | 204, 403, 404 | ✔ |
| 17 | POST | `/projects/{project_id}/papers/upload` | `papers.py::upload_paper` | ✅ | 201, 400, 403, 404, 413 | MED-M7: synchronous heavy processing; verb `/upload`; else strong streaming design |
| 18 | POST | `/papers/{paper_id}/index` | `papers.py::index_paper` | ❌ ad-hoc dict | 200, 403, 404 | MED-M2: undocumented schema; idempotent re-index ✔ |
| 19 | GET | `/projects/{project_id}/papers` | `papers.py::list_papers` | ✅ | 200, 403, 404 | ✔ `q` filter + skip/limit; HIGH-H5: no totals |
| 20 | GET | `/papers/{paper_id}` | `papers.py::get_paper` | ✅ | 200, 403, 404 | ✔ |
| 21 | GET | `/papers/{paper_id}/status` | `papers.py::get_paper_status` | ✅ | 200, 403, 404 | MED-M7: hardcodes `step="ready"` — fake progress contract |
| 22 | GET | `/papers/{paper_id}/pdf` | `papers.py::stream_paper_pdf` | binary | 200, 403, 404 | LOW-L5b: no explicit Range/HEAD story |
| 23 | DELETE | `/papers/{paper_id}` | `papers.py::delete_paper` | — | 204, 403, 404 | ✔ deletes file too (§34a aligned) |
| 24 | GET | `/papers/{paper_id}/annotations` | `papers.py::get_paper_annotations` | ✅ | 200, 403, 404 | HIGH-H5: **no pagination** |
| 25 | POST | `/papers/{paper_id}/annotations` | `papers.py::create_annotation` | ✅ | 201, 403, 404, 422 | HIGH-H4: redundant `paper_id` in body unvalidated |
| 26 | PATCH | `/papers/{paper_id}/annotations/{annotation_id}` | `papers.py::update_annotation` | ✅ | 200, 403, 404 | ✔ |
| 27 | DELETE | `/papers/{paper_id}/annotations/{annotation_id}` | `papers.py::delete_annotation` | — | 204, 403, 404 | ✔ |
| 28 | POST | `/papers/{paper_id}/ask` | `papers.py::ask_paper_ai` | ✅ | 200, 400, 403, 404, 503 | ✔ honest refusal modeling; RPC verb `/ask` (MED-M3) |
| 29 | POST | `/projects/{project_id}/chat` | `chat.py::project_chat` | ✅ | 200, 403, 404 | MED-M8: invalid `mode` silently coerced, not 422 |
| 30 | POST | `/projects/{project_id}/chat/stream` | `chat.py::project_chat_stream` | ❌ SSE frames | 200, 403, 404 | MED-M2: frame schema undocumented; sets Cache-Control ✔ |
| 31 | POST | `/projects/{project_id}/rag/search` | `chat.py::rag_search` | ✅ | 200, 403, 404 | ✔ |
| 32 | GET | `/documents/{document_id}/citations` | `citations.py::list_document_citations` | ✅ | 200, 403, 404 | ✔ skip/limit; HIGH-H5: no totals |
| 33 | POST | `/documents/{document_id}/citations` | `citations.py::create_citation` | ✅ | 201, 403, 404 | HIGH-H4: redundant `document_id` in body unvalidated |
| 34 | DELETE | `/documents/{document_id}/citations/{citation_id}` | `citations.py::delete_citation` | — | 204, 403, 404 | ✔ |
| 35 | POST | `/citations/resolve-identifier` | `citations.py::resolve_identifier` | ✅ | 200 | MED-M3: RPC verb-in-path; no project scoping needed ✔ |
| 36 | POST | `/projects/{project_id}/papers/add-by-identifier` | `citations.py::add_paper_by_identifier` | ✅ | 201, 403, 404, **422** | MED-M3 verb; 422-for-upstream-resolve-failure debatable (LOW-L5c) |
| 37 | POST | `/projects/{project_id}/papers/import-bibtex` | `citations.py::import_bibtex` | ✅ | 201, 400, 403, 404, 413 | ✔ genuine bulk op w/ limits; LOW-L5d: 413 for count>500 |
| 38 | GET | `/projects/{project_id}/export/bibtex` | `citations.py::export_project_bibtex` | ✅ JSON | 200, 403, 404 | MED-M10: returns JSON wrapper, not `.bib` file/content-type |
| 39 | GET | `/documents/{document_id}/export/bibtex` | `citations.py::export_document_bibtex` | ✅ JSON | 200, 403, 404 | MED-M10: same |
| 40 | POST | `/documents/{document_id}/citations/rank-context` | `citations.py::rank_citations_for_context` | ✅ | 200, 403, 404 | LOW-L10: body `limit` unbounded; redundant `document_id` (H4) |
| 41 | POST | `/projects/{project_id}/ai/autocomplete` | `ai_writing.py::generate_autocomplete` | ✅ | 200, 400, 403, 404, 503 | ✔ 503 mapping honest |
| 42 | POST | `/projects/{project_id}/ai/stream-autocomplete` | `ai_writing.py::stream_autocomplete` | ❌ SSE | 200, 403, 404 | LOW-L4b: missing `Cache-Control`/`X-Accel-Buffering` (vs #30) |
| 43 | POST | `/projects/{project_id}/ai/edit` | `ai_writing.py::generate_ai_edit` | ✅ | 200, 400, 403, 404, 503 | ✔ |
| 44 | POST | `/projects/{project_id}/ai/outline` | `ai_writing.py::generate_ai_outline` | ✅ | 200, 403, 404 | ✔ |
| 45 | POST | `/documents/{document_id}/export` | `export.py::export_document_post` | binary | 200, 400, 403, 404 | ✔ exposes Content-Disposition via CORS ✔ |
| 46 | GET | `/documents/{document_id}/export/{export_format}` | `export.py::export_document_get` | binary | 200, 400, 403, 404 | MED-M3/M10: parallel GET/POST export duality; format-as-path-segment |
| 47 | POST | `/projects/{project_id}/intelligence/verify-claims` | `intelligence.py::verify_claims_endpoint` | ✅ | 200, 403, 404 | ✔ |
| 48 | POST | `/projects/{project_id}/intelligence/research-gaps` | `intelligence.py::research_gaps_endpoint` | ✅ | 200, 403, 404 | ✔ |
| 49 | POST | `/projects/{project_id}/intelligence/literature-matrix` | `intelligence.py::literature_matrix_endpoint` | ✅ | 200, 403, 404 | ✔ |
| 50 | POST | `/projects/{project_id}/intelligence/paper-review` | `intelligence.py::paper_review_endpoint` | ✅ | 200, 403, 404 | ✔ |
| 51 | POST | `/projects/{project_id}/zotero/import` | `zotero.py::import_zotero_endpoint` | ✅ | **200**, 403, 404 | MED-M1: creates papers but returns 200, not 201 |
| 52 | POST | `/projects/{project_id}/zotero/sync` | `zotero.py::sync_zotero_endpoint` | ✅ | **200**, 403, 404 | MED-M1/M9: same; API key in body |
| 53 | GET | `/system/provider-status` | `provider_status.py::get_provider_status_endpoint` | ✅ | 200 | ✔ §19 quota visibility ✔ |
| 54 | POST | `/system/provider-cache/clear` | `provider_status.py::clear_provider_cache_endpoint` | ✅ | 200 | HIGH-H2: global mutation open to any authenticated identity |
| 55 | GET | `/research/search` | `research.py::search_online_literature` | ✅ | 200, 400 | MED-M4: live external fan-out on GET; LOW-L3: per-source limit/offset ambiguity |
| 56 | GET | `/ai/providers` | `provider_settings.py::list_ai_providers` | ❌ | 200 | HIGH-H2/MED-M2 |
| 57 | PUT | `/ai/providers/{provider}` | `provider_settings.py::update_ai_provider` | ❌ | 200, 400, 404 | HIGH-H2; PUT semantics OK-ish (full config replace) |
| 58 | GET | `/ai/rate-limit` | `provider_settings.py::read_cloud_rate_limit` | ❌ | 200 | HIGH-H2/MED-M2 |
| 59 | PUT | `/ai/rate-limit` | `provider_settings.py::update_cloud_rate_limit` | ❌ | 200, 400 | HIGH-H2 |
| 60 | DELETE | `/ai/providers/{provider}` | `provider_settings.py::remove_ai_provider` | ❌ | **200 + body**, 404 | MED-M1: only DELETE returning 200 w/ body (others 204) |
| 61 | GET | `/ai/autocomplete-settings` | `provider_settings.py::read_autocomplete_settings` | ✅ | 200 | HIGH-H2 |
| 62 | PUT | `/ai/autocomplete-settings` | `provider_settings.py::update_autocomplete_settings` | ✅ | 200, 400 | MED-M1: **PUT with all-optional partial body = PATCH semantics**; HIGH-H2 |
| 63 | POST | `/ai/autocomplete-settings/probe` | `provider_settings.py::probe_autocomplete_engine` | ✅ | 200 | MED-M3 RPC |
| 64 | GET | `/ai/autocomplete-settings/status` | `provider_settings.py::read_tabby_setup_status` | ❌ | 200 | MED-M2 |
| 65 | POST | `/ai/autocomplete-settings/setup` | `provider_settings.py::run_tabby_setup` | ❌ | 200 | MED-M2/M3: installs software via API — powerful action, undocumented schema |
| 66 | POST | `/teams` | `teams.py::create_team` | ✅ | 201 | ✔ |
| 67 | GET | `/teams` | `teams.py::list_teams` | ✅ | 200 | HIGH-H5: no pagination; N+1 avoided ✔ |
| 68 | GET | `/teams/{team_id}` | `teams.py::get_team` | ✅ | 200, 403, 404 | ✔ |
| 69 | PATCH | `/teams/{team_id}` | `teams.py::update_team` | ✅ | 200, 403, 404 | ✔ |
| 70 | DELETE | `/teams/{team_id}` | `teams.py::delete_team` | — | 204, 403, 404 | MED-M6: deletes `Owner` row — cascade semantics for owned projects undefined at API level |
| 71 | GET | `/teams/{team_id}/members` | `teams.py::list_team_members` | ✅ | 200, **403-for-nonexistent-team** | MED-M1: 403 before existence check (should be 404); no pagination (H5) |
| 72 | POST | `/teams/{team_id}/members` | `teams.py::add_team_member` | ✅ | 201, **400** (dup), 403, 404 | MED-M1: duplicate membership should be 409 |
| 73 | PATCH | `/teams/{team_id}/members/{membership_id}` | `teams.py::update_team_member_role` | ✅ | 200, **400** (last-owner), 403, 404 | MED-M1: last-owner guard should be 409 |
| 74 | DELETE | `/teams/{team_id}/members/{membership_id}` | `teams.py::remove_team_member` | — | 204, **400** (last-owner), 403, 404 | MED-M1: same |
| 75 | WS | `/ws/collaborate/{document_id}` | `collaboration.py::websocket_collaboration` | n/a | 101 / close 1008 | LOW-L9: versioned REST prefix hosts a socket; first-frame auth ✔ |
| 76 | GET | `/documents/{document_id}/collaborators` | `collaboration.py::get_active_collaborators` | ❌ | 200, 403, 404 | MED-M2: undocumented schema |
| 77 | GET | `/documents/{document_id}/comments` | `comments.py::list_comments` | ✅ | 200, 403, 404 | ✔ skip/limit + `include_resolved` filter; H5: no totals |
| 78 | POST | `/documents/{document_id}/comments` | `comments.py::create_comment` | ✅ | 201, 403, 404 | ✔ nested-create style (contrast #12/#33 — H4) |
| 79 | POST | `/documents/{document_id}/comments/{comment_id}/replies` | `comments.py::create_comment_reply` | ✅ | 201, 403, 404 | ✔ |
| 80 | PATCH | `/documents/{document_id}/comments/{comment_id}` | `comments.py::update_comment` | ✅ | 200, 403, 404 | ✔ author-only content edit; resolve open to editors (intended?) |
| 81 | DELETE | `/documents/{document_id}/comments/{comment_id}` | `comments.py::delete_comment` | — | 204, 403, 404 | ✔ author-or-owner rule |
| 82 | GET | `/documents/{document_id}/versions` | `version_history.py::list_document_versions` | ✅ | 200, 403, 404 | HIGH-H5: **no pagination** on unbounded revision history |
| 83 | POST | `/documents/{document_id}/versions` | `version_history.py::create_document_version` | ✅ | 201, 403, 404, 500* | LOW-L5e: exhausted uniqueness retries surface as 500 |
| 84 | GET | `/documents/{document_id}/versions/{version_id}` | `version_history.py::get_document_version` | ✅ | 200, 403, 404 | ✔ |
| 85 | POST | `/documents/{document_id}/versions/{version_id}/restore` | `version_history.py::restore_document_version` | ✅ | **200** (creates checkpoint), 403, 404 | MED-M1: restore creates a new Version → arguable 201 |
| 86 | GET | `/documents/{document_id}/versions/{v1_id}/diff/{v2_id}` | `version_history.py::compute_version_diff` | ✅ | 200, 403, 404 | MED-M3: 5-segment depth + verb `diff` |
| 87 | GET | `/projects/{project_id}/research-graph` | `graphs.py::get_project_research_graph` | ✅ | 200, 403, 404 | ✔ |
| 88 | GET | `/projects/{project_id}/discover-related` | `graphs.py::discover_related_papers` | ✅ | 200, 403, 404 | MED-M4: live external queries on GET, no cache headers |

\* 500 only if unique-constraint retries exhaust (`version_history.py:41-48`) — practically unreachable but possible under sustained contention.

**Inventory totals**: 88 operations (87 HTTP + 1 WebSocket). 62 have `response_model` set; **15 lack any documented success schema** (#1, 2, 18, 30, 42, 54*, 56–60, 64, 65, 76 — *#54 has a model; the undocumented set is #1, 2, 18, 30, 42, 56, 57, 58, 59, 60, 64, 65, 76 = 13, plus root/health variants counted above). Binary/file responses (22, 45, 46) correctly omit JSON models.

---

## Detailed Findings

Severity scale: **CRITICAL** (breaks core API guarantees / exploitable in realistic deployment), **HIGH** (systemic contract or consistency defect affecting many endpoints), **MEDIUM** (localized correctness/documentation/design flaw), **LOW** (polish/hygiene), **INFO** (observation, no action strictly required).

---

### CRITICAL

#### C1 — Invalid or absent credentials silently degrade to an auto-provisioned **admin** local user on every endpoint
- **Where:** `apps/api/app/services/auth.py:108-129` (`get_current_user`), consumed by all 80+ user-scoped endpoints; admin gate at `auth.py:132-138` protects only the 4 plugin-admin routes.
- **Issue:** `HTTPBearer(auto_error=False)` plus a catch-all fallback means:
  - No `Authorization` header → request runs as `local@openresearch.dev` with `is_admin=True` (`auth.py:71-105`).
  - A **malformed, expired, or wrong-signature JWT** is swallowed (`except jwt.InvalidTokenError: pass`) and the request **also** proceeds as the local admin — there is no code path in the entire API that returns `401` for a bad token on a protected resource.
- **Why CRITICAL:** Every endpoint's documented security semantics (401 vs 403 distinction, per-user isolation required by Spec §34 "Never expose another user's documents") are voided whenever the process is exposed beyond loopback — e.g., a self-hoster binding to `0.0.0.0`, a LAN deployment, or any future hosted instance. Any user of a shared instance who sends a garbage token gains admin. It also makes `POST /auth/login`'s careful 401 semantics meaningless for the rest of the surface.
- **Context/mitigation acknowledged:** `docs/architecture.md` ("Local-first auth") documents single-user local mode as a deliberate decision, and the WebSocket path (`collaboration.py:171-223`) does enforce token validation when provided. The finding is therefore about **mode gating, not intent**: the fallback is unconditional — it does not key off `settings.ENVIRONMENT` or an explicit `LOCAL_MODE` flag, so nothing prevents accidental exposure.
- **Fix:**
  1. Introduce an explicit setting (e.g. `AUTH_MODE=local|required`) chosen at startup; in `required` mode, reject missing/invalid tokens with `401` + `WWW-Authenticate: Bearer` on every protected dependency.
  2. Even in local mode, treat a *supplied-but-invalid* token as `401`, never as anonymous — silent downgrade hides client bugs and token expiry.
  3. Gate `get_or_create_local_user` behind the same flag so remote callers cannot materialize an admin account.

---

### HIGH

#### H1 — Three incompatible error-response envelopes; no RFC 7807 `application/problem+json`
- **Where:** `app/core/middleware.py:47-68` (500 shape), FastAPI defaults everywhere else (`endpoints/*.py`, dozens of `HTTPException(detail=...)`), FastAPI request-validation 422 arrays.
- **Issue:** Clients must parse three distinct failure shapes:
  1. Handled errors → `{"detail": "<string>"}` (e.g., `documents.py:81`, `papers.py:202`).
  2. Validation errors → `{"detail": [{"loc": ..., "msg": ..., "type": ...}]}` (array).
  3. Unhandled exceptions → `{"error": {"code": "INTERNAL_SERVER_ERROR", "message": ..., "request_id": ...}}` (middleware).
  There is no machine-readable error `code` for categories 1–2, no stable `type`/`title` fields, and no content type other than `application/json`. RFC 7807/9457 (`type`, `title`, `status`, `detail`, `instance`) is not adopted anywhere.
- **Impact:** Frontend error handling must special-case every layer; correlation IDs are attached only to 500s (the tracing middleware does add `X-Request-ID` to all responses — good — but the *body* contract differs).
- **Fix:** Add exception handlers for `HTTPException` and `RequestValidationError` that emit one envelope (either uniform `{"error": {code, message, details, request_id}}` matching the existing middleware shape, or RFC 7807 problem+json with `request_id` as an extension member). Include the machine-readable `code` values already implicit in messages (e.g., `VERSION_CONFLICT`, `PERMISSION_DENIED`). Register `problem+json` media type if adopting 7807.

#### H2 — Instance-global configuration and cache mutation endpoints are writable by *any* authenticated identity (no admin gate)
- **Where:** `provider_settings.py:65` (`PUT /ai/providers/{provider}` — accepts API keys), `:92` (`PUT /ai/rate-limit`), `:101` (`DELETE /ai/providers/{provider}`), `:116` (`PUT /ai/autocomplete-settings`, triggers background process launch at `:127-128`), `:151` (`POST /ai/autocomplete-settings/setup` — installs/launches Tabby), and `provider_status.py:22` (`POST /system/provider-cache/clear`).
- **Issue:** All of these mutate **shared, instance-wide** state yet depend only on `get_current_user`. Contrast `plugins.py`, which correctly uses `get_current_admin_user` for registration/toggle/config (`plugins.py:70,85,101`). Under C1, "any authenticated identity" includes anonymous visitors in local mode — but even *with* real auth, ordinary members of a shared instance could overwrite the operator's provider keys, disable the global cloud rate limit, or force-launch background processes.
- **Fix:** Apply `Depends(get_current_admin_user)` to all mutating provider/settings/cache endpoints (reads can stay user-level or admin-level per product choice). This is also a **breaking-change risk** to manage: coordinate with frontend before tightening.

#### H3 — Rate limiting covers only 3 auth endpoints; no `X-RateLimit-*` headers; in-process store
- **Where:** `endpoints/auth.py:30-38` (register/login/refresh limiters), `app/core/rate_limit.py:25-45`, `config.py:30-33`. Repo-wide grep confirms **zero** occurrences of `X-RateLimit`/`RateLimit-*` headers; the only limiter header is `Retry-After` on 429 (`rate_limit.py:43`).
- **Issue:**
  - Spec §34 requires "Rate-limit APIs" generally; expensive surfaces (LLM chat/autocomplete/export/PDF upload/literature search) have **no** limits.
  - Standard `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` (draft IETF `RateLimit` header) are absent, so clients cannot adapt proactively; they discover limits only by receiving 429.
  - The sliding window is per-process (`rate_limit.py` module docstring admits single-worker assumption); horizontal scaling silently multiplies quotas.
  - Limiter is disabled wholesale in `ENVIRONMENT=test` (`rate_limit.py:32`) — fine for CI, but ensure staging parity.
- **Fix:** Add limiter dependencies to AI-generation, upload, export, and external-search routes; emit `RateLimit-Limit/Remaining/Reset` headers from middleware; move counters to Redis (already a dependency) when scaling; document limits in OpenAPI via response headers.

#### H4 — Inconsistent resource-creation styles; redundant parent IDs in bodies accepted but never validated
- **Where:**
  - Flat creates with parent id in **body**: `POST /documents` (`documents.py:22`, `DocumentCreate.project_id`), `POST /documents/{id}/citations` (`citations.py:160`, `CitationCreate.document_id`).
  - Nested creates with parent id in **path**: `POST /projects/{id}/papers/upload` (`papers.py:55`), `POST /papers/{id}/annotations` (`papers.py:372`), `POST /documents/{id}/comments` (`comments.py:79`), `POST /teams/{id}/members` (`teams.py:196`).
  - Hybrid oddity: `POST /projects` accepts `owner_id` **twice** — as a query parameter and in the body (`projects.py:17-24`: `project_in.owner_id or owner_id or ...`).
  - Redundant-and-ignored fields: `AnnotationCreate.paper_id` (`schemas/models.py:198-199`) vs URL `paper_id`; `ContextRankingRequest.document_id` (`models.py:423`) vs URL.
- **Issue:** Two competing creation idioms for the same kind of operation; body/path mismatches are silently ignored (client believes annotation went to paper X in body while URL says Y); the dual `owner_id` on project create is ambiguous and undocumented. Skill guidance: pick one canonical pattern (nested sub-resource create is preferred for containment) and reject conflicting identifiers with 422.
- **Fix:** Standardize on nested creation (`POST /projects/{pid}/documents`, `POST /documents/{did}/citations`), drop parent fields from create schemas (or validate equality → 422 on mismatch), remove the query-param `owner_id` from `POST /projects`.

#### H5 — Pagination contract is inconsistent and metadata-free
- **Where:** Paginated (skip/limit, `ge/le`-bounded ≤500): documents (`documents.py:52-53`), papers (`papers.py:217-218`), citations (`citations.py:114-115`), comments (`comments.py:57-58`). **Unpaginated collections:** projects (`projects.py:44`), teams (`teams.py:54`), team members (`teams.py:169`), annotations (`papers.py:346`), versions (`version_history.py:64`). External search uses `limit/offset` names instead of `skip` (`research.py:28-29`).
- **Issue:**
  - Bare-array responses carry **no total count, next/cursor, or `X-Total-Count` header** — a client paging documents cannot know it reached the end except by receiving < limit.
  - Defaults (`limit=100`) mean silent truncation for large libraries — directly at odds with Spec §41 ("1,000+ research papers", "100+ documents").
  - Parameter-name drift (`skip` vs `offset`) and presence/absence drift across sibling resources violate the skill's consistency mandate.
- **Fix:** Adopt one envelope for collections (e.g., `{"items": [...], "total": n, "skip": s, "limit": l}`) or keep arrays but add `X-Total-Count`; apply skip/limit to all five unpaginated collections; unify `skip` naming; consider keyset pagination for versions/comments.

---

### MEDIUM

#### M1 — Status-code misfires across several endpoints
| Endpoint(s) | Current | Expected | Why |
|---|---|---|---|
| `POST /teams/{id}/members` duplicate (`teams.py:210-212`) | 400 | **409 Conflict** | State conflict, not malformed syntax |
| Last-owner demote/remove guards (`teams.py:245-254`, `:283-292`) | 400 | **409 Conflict** | Same |
| `POST .../zotero/import`, `/zotero/sync` (`zotero.py:35,50`) | 200 | **201** (or 200 with explicit upsert semantics) | Resources created |
| `POST .../versions/{vid}/restore` (`version_history.py:132`) | 200 | Arguably **201** | Creates a new Version checkpoint resource |
| `DELETE /ai/providers/{provider}` (`provider_settings.py:101-105`) | 200 + JSON body | **204** (or keep body but then standardize) | Every other DELETE returns 204 |
| `GET /teams/{id}/members` for nonexistent team (`teams.py:169-172`) | 403 | **404** | Existence checked only via membership lookup; inconsistent with `get_team` which 404s first (`teams.py:95-97`) |
| `PUT /ai/autocomplete-settings` with all-optional body (`provider_settings.py:116-129`; schema `models.py:469-474`) | PUT | **PATCH** | Partial-update semantics on PUT verb violates method semantics |
| `PATCH /plugins/{id}/toggle` (`plugins.py:81`) | PATCH-action | Consider `PUT /plugins/{id}` `{enabled}` or `POST .../enable|disable` | Toggle is an action, not a partial representation update |

Note: `POST /auth/register` duplicate email returning 400 (`auth.py:61-64`) is a *deliberate* anti-enumeration choice — acceptable, but document it.

#### M2 — OpenAPI completeness gaps: undocumented schemas, zero examples, docs disabled in production
- **Missing `response_model` (success schemas invisible to generated docs):** `papers.py:193` (`/papers/{id}/index`), `chat.py:70` (`/chat/stream` — SSE frames have no schema object), `ai_writing.py:60` (`/ai/stream-autocomplete`), `provider_settings.py:53,86,92,101,142,151` (`/ai/providers`, `/ai/rate-limit` ×2, DELETE provider, tabby status/setup), `collaboration.py:357` (`/collaborators`), `health.py:12`, `main.py:93` (root).
- **No examples anywhere:** repo-wide grep finds **zero** `json_schema_extra`/`examples=`/`Field(example=...)` usages in `app/` — the skill's OpenAPI guidance (examples for requests/responses, especially for complex payloads like `ChatRequest`, `ExportRequest`, SSE frame sequences) is unmet.
- **Docs fully disabled in production** (`main.py:71-73`: `openapi_url/docs_url/redoc_url = None` when `ENVIRONMENT=production`). Reasonable for surface-minimization, but Spec §35 requires published API documentation; serving a static exported OpenAPI file would satisfy both.
- Error response schemas are likewise undocumented (see H1) — OpenAPI declares only success models.
- **Fix:** Add `response_model` (or `responses={...}`) for every endpoint incl. SSE frame schema components; add examples to the ~20 most complex schemas; publish a versioned static OpenAPI artifact for production.

#### M3 — RPC-style verbs in URLs and one over-nested route
- Verb-bearing segments: `/research/search`, `/citations/resolve-identifier`, `/papers/add-by-identifier`, `/papers/import-bibtex`, `/papers/upload`, `/papers/{id}/ask`, `/versions/{id}/restore`, `/versions/diff`, `/plugins/hooks/{name}` (exec), `/plugins/{id}/toggle`, `/ai/autocomplete-settings/probe|setup`, `/system/provider-cache/clear`, `/ai/stream-autocomplete`, `/citations/rank-context`.
- Depth outlier: `GET /documents/{doc}/versions/{v1}/diff/{v2}` — 5 path segments including two resource ids and a verb; skill guidance caps nesting ≈2 levels.
- **Assessment:** For inherently procedural AI/ML operations (autocomplete, review, gap analysis), action-style endpoints are industry-common and arguably clearer than forcing CRUD shapes; the problem is that the codebase mixes paradigms **without a stated convention**. The `diff` route specifically should become e.g. `POST /documents/{id}/versions/diff {"v1": "...", "v2": "..."}` or query params.
- **Fix:** Document an explicit "actions use `POST /<resource-collection>/<verb>`" convention in `docs/`; flatten the diff route; prefer noun forms where trivially available (`/uploads` is not worth churn; leave `/search`).

#### M4 — GET endpoints performing live external network fan-out with no caching/response-freshness semantics
- `GET /projects/{id}/discover-related` (`graphs.py:39-48`) and `GET /research/search` (`research.py:16-59`) trigger synchronous third-party API calls (Crossref/OpenAlex/arXiv/S2) per request.
- Issues: unbounded repeat cost against §19's quota concerns (partially mitigated by `provider_cache_service` for some providers — but `discover_related_work` and search results expose no `Cache-Control`/`ETag` to browsers); slow responses on a GET invite client timeouts with no `202 Accepted`-style escape hatch; no documented worst-case latency.
- **Fix:** Return short-lived `Cache-Control: max-age=...` (or `ETag` + 304), consider a `refresh=false` cached-first query param, and document expected latency budgets.

#### M5 — Conditional requests / concurrency controls are bespoke, not HTTP-standard
- Document optimistic locking uses a body field (`DocumentUpdate.version` → 409 at `documents.py:110-114`) — functional, but the platform-standard mechanism (`ETag` on GET, `If-Match` on PATCH, `412 Precondition Failed`) is absent repo-wide (grep confirms no `ETag`). No `Last-Modified`/`If-Modified-Since` on documents, papers, or PDF streams; no explicit Range support documentation on `/papers/{id}/pdf` (Starlette `FileResponse` handles Range implicitly — worth stating + adding `Accept-Ranges` visibility in docs).
- **Fix:** Emit weak `ETag`s derived from `updated_at`/`version` on GET document/paper; honor `If-Match` on PATCH alongside (or instead of) the body field; keep body `version` for backward compat during migration.

#### M6 — Resource-identity and lifecycle hazards with breaking-change potential
- `TeamResponse.id` **is the Owner id** (`teams.py:42-51`); team and owner resources share identity, so future separation (e.g., renaming teams without touching owner rows, or exposing owners directly) becomes a breaking change.
- `DELETE /teams/{id}` deletes the `Owner` row (`teams.py:164-165`). Projects reference `owner_id`; whether projects cascade, orphan, or block is invisible at the API contract level — no `4xx` precheck, no documented cascade. Spec §34a requires *defined* deletion semantics.
- Refresh tokens (`auth.py:51-59`) are stateless JWTs with **no server-side revocation, rotation, or reuse-detection**: a leaked refresh token is valid for 30 days (`config.py:29`) regardless of logout.
- **Fix:** Give Team its own surrogate id (or commit publicly to the Owner-id equivalence in docs); define and document team-deletion cascade (block if projects exist → 409, or explicit recursive delete); add a token-version/jti claim with per-user revocation list for refresh tokens.

#### M7 — Async-processing contract (Spec §41) is only cosmetic
- Spec §41 demands asynchronous PDF processing with a visible step progression (`Upload → Processing → Metadata → Text → Embeddings → Ready`) and a UI that never blocks.
- Implementation: `POST /projects/{id}/papers/upload` runs validation + GROBID/pdfplumber extraction + DB save + chunking **synchronously inside the request** (`papers.py:134-190`); `GET /papers/{id}/status` then **hardcodes** `step="ready", step_index=4` (`papers.py:283-290`) — the stepped-progress endpoint can never report intermediate states, and a 50 MB upload holds an HTTP worker for the whole pipeline.
- **Fix:** Either implement true background processing (enqueue job id from upload → `202 Accepted` + `Location: /papers/{id}/status`, status reads real pipeline state) or simplify the contract honestly (drop `step`/`step_index` claims, document synchronous semantics + timeout expectations). Current state is the worst of both: clients are promised a progress protocol that always says "done".

#### M8 — Chat is stateless; conversation persistence promised by Spec §7/§13 has no API
- `ChatRequest.conversation_history` is client-supplied every call (`models.py:307-313`); there are no endpoints to create/list/rename/delete AI conversations per project (§7 lists "AI conversations" among project contents). Additionally, an invalid `mode` value is silently coerced to `"project"` (`chat.py:23-25`) instead of a 422 — masking client bugs.
- **Fix:** Validate `mode` via `Literal[str]`/enum in the schema (→ automatic 422); roadmap conversation resources (`GET/POST /projects/{id}/conversations`, `POST .../conversations/{cid}/messages`) or amend the spec to declare client-held history as v1 scope.

#### M9 — Credential handling in request bodies (Zotero)
- `ZoteroSyncRequest.api_key` / `ZoteroImportRequest.api_key` (`models.py:708-726`) transmit a third-party secret in the JSON body. No grep evidence of logging it, which is good, but: no guidance comment warning against logging, no storage policy stated in the response (sync returns `last_synced_version` implying stored state — confirm the key itself is never persisted), and local deployments typically run plain HTTP, contrary to §34's "encrypt data in transit".
- **Fix:** Document one-round-trip usage (key used transiently, never persisted) in the endpoint description and schema description; consider accepting `Authorization:` style headers instead of body fields for secrets.

#### M10 — Export surface is split across four inconsistent idioms
- `POST /documents/{id}/export` → binary file (correct download semantics, `Content-Disposition` exposed via CORS ✔).
- `GET /documents/{id}/export/{format}` → same thing again with query-param options (`style`, `bib`, `trust`) and format spelled differently in the path (`markdown` vs body's `export_format` allowing `md` aliases).
- `GET /projects/{id}/export/bibtex` and `GET /documents/{id}/export/bibtex` → **JSON wrappers** (`BibtexExportResponse{bibtex_content,...}`), i.e., the same conceptual operation (export bibliography) yields a file from two routes and structured JSON from two others.
- **Fix:** Keep `POST .../export` for configurable generation; make GET variants pure download shortcuts; convert bibtex GETs to return `application/x-bibtex` with `Content-Disposition` (offer the JSON variant under an `Accept: application/json` negotiation or a distinct `/bibtex-preview` route).

---

### LOW

- **L1 — No hypermedia affordances.** Root returns a static greeting (`main.py:93-95`); no `_links`/self URLs in any response. Not required for v1, but even a root document enumerating top-level collections would aid discoverability (and satisfies part of §35's documentation goal).
- **L2 — Nonstandard timing header name.** `X-Response-Time-MS` (`middleware.py:38`) — consider standard `Server-Timing: total;dur=...` alongside for observability-tool compatibility.
- **L3 — `GET /research/search` pagination semantics ambiguous.** `limit` applies **per source** while `offset` forwarding per-provider is unstated (`research.py:28-29`); total result count is unknowable. Document explicitly or aggregate-and-paginate server-side.
- **L4 — SSE response-header inconsistency.** `chat.py:110-114` sets `Cache-Control: no-cache` and `X-Accel-Buffering: no`; `ai_writing.py:80-83` sets neither. Proxy buffering may break ghost-text streaming.
- **L5 — Assorted status/validation edge cases:** (a) PDF stream lacks documented Range/HEAD support (`papers.py:293-312`); (b) 422 for upstream identifier-resolution failure (`citations.py:272-279`) conflates client input validity with upstream availability — 404/502-family or 422-with-machine-code both defensible, just codify; (c) `413` used for BibTeX **entry-count** >500 (`citations.py:342-343`) — a count limit is not a payload-size condition (use 400/422 with code `TOO_MANY_ENTRIES`); (d) exhausted version-number retries raise raw `IntegrityError` → 500 (`version_history.py:47-48`) — return 409; (e) `highlight_color` is a free-form string (`models.py:202`) — constrain to enum or hex pattern.
- **L6 — Free-form enum-ish strings validated downstream, inconsistently.** `ChatRequest.mode` coerced (M8); `AskPaperAIRequest.prompt_type` unknown values fall through to no instruction (`papers.py:539-543`) rather than 422; `AutocompleteRequest.mode`, `AIEditRequest.action` rely on service-layer `ValueError` → 400. Prefer `Literal[...]` types for wire contracts.
- **L7 — Body-supplied `limit` without upper bound.** `ContextRankingRequest.limit` (`models.py:426`, applied at `citations.py:544-545`) has no `le=` cap; a client may request ranking of the entire library. Cap consistently with Query-parameter bounds (≤500).
- **L8 — Existence-leak asymmetry.** Most endpoints correctly 404 before 403 (e.g., `projects.py:71-77`), but `list_team_members` 403s for nonexistent teams (M1 row) and `GET /teams/{id}` reveals existence to non-members via 403-vs-404 distinction. UUIDs mitigate guessing; pick one policy (hide-with-404 vs reveal-with-403) and document it.
- **L9 — WebSocket route under the versioned REST prefix.** `/api/v1/ws/collaborate/{document_id}` mixes transport styles under one prefix, and `architecture.md` depicts the path as `/ws/collaborate/{doc_id}` (doc/code drift). Either exempt sockets from the API prefix or update the diagram; either way, document the close codes (only `1008` is used).
- **L10 — CORS posture is dev-shaped.** `allow_methods=["*"]`, `allow_headers=["*"]`, `allow_credentials=True` with localhost origins (`main.py:82-88`, `config.py:36-39`). Fine for local-first; require explicit method/header allowlists when a hosted origin list ships.

### INFO (observations, spec-conformance notes)

- **I1** — Root endpoint provides no capability discovery (see L1); harmless today because docs URL is returned in the message body.
- **I2** — Spec-conformant highlights verified: citation `attribution_scope` (sentence/clause, §26a) is modeled and accepted on create (`models.py:253`, `citations.py:186-188`); grounded-chat trust legend/segments (§26/§33 Rules 3-5) are richly typed (`models.py:289-324`); claim verification and gap assistant correctly ship the v1-scoped mechanical features and label confidence scoring `"deferred"` (§21/§25/§43) (`models.py:581,635`).
- **I3** — §19 provider-quota visibility exists (`GET /system/provider-status`) with cache stats — matches the "surface provider status/quota in Settings" requirement.
- **I4** — §34a paper deletion removes the stored PDF immediately (`papers.py:330-340`); chunk/embedding removal relies on ORM cascade (verify once pgvector migration lands).
- **I5** — §7 "Collections" and "Notes" project contents have no API surface (annotations partially cover notes). Declare them out of current scope in docs or track as backlog.
- **I6** — `ENVIRONMENT=test` bypass of the rate limiter (`rate_limit.py:32`) is pragmatic; note it means limiter regressions won't be caught by the suite unless a dedicated unit test constructs the limiter directly.
- **I7** — `test_openapi_schema.py` asserts ≥20 paths and a security scheme — a useful floor; consider asserting every route declares either `response_model` or an explicit `responses` entry to lock in M2 fixes.
- **I8** — Hook execution validates unknown hook names into a 400 (`plugin_runtime.py:78-80` via `plugins.py:48-51`) — good defensive routing; earlier concern about `HOOK_REGISTRY[hook_name]` KeyError is unfounded.
- **I9** — `Access-Control-Expose-Headers: Content-Disposition` on export responses (`export.py:58-61,111-114`) is a frequently-missed detail done right.

---

## Consistency Matrix

Legend: ✔ = present/applied; ✖ = absent; ◐ = partial/inconsistent.

| Dimension | Auth | Projects | Documents | Papers | Annotations | Citations | Comments | Versions | Teams | Plugins | AI/Settings | System/Research |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Plural collection nouns | n/a | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ (`/ai/*` mixed) | ◐ (`/system/provider-status` sg.) |
| Verbs in URL | ◐ (conventional `/auth/*`) | ✖ | ✖ | ◐ (`upload`,`ask`,`index`) | ✖ | ◐ (`resolve-identifier`,`add-by-identifier`,`import-bibtex`,`rank-context`) | ✖ | ◐ (`restore`,`diff`) | ✖ | ◐ (`register`,`toggle`,`hooks exec`) | ◐ (`probe`,`setup`,`stream-autocomplete`) | ◐ (`clear`,`search`) |
| Create → 201 | ✔ (register) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ◐ (zotero 200) |
| Delete → 204 | n/a | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | n/a | ◐ (provider DELETE 200) | n/a |
| 404-before-403 ordering | n/a | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ (members list) | ✔ | ◐ | ✔ |
| `response_model` on success | ✔ | ✔ | ✔ | ◐ (`index`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ (6 gaps) | ◐ (`collaborators`) |
| Pagination on list | n/a | ✖ | ✔ | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ (×2) | n/a | n/a | ◐ (`limit/offset`) |
| Filter params on list | n/a | ◐ (`owner_id`) | ✖ | ✔ (`q`) | ✖ | ✖ | ✔ (`include_resolved`) | ✖ | ✖ | n/a | n/a | ✔ (sources/year/OA) |
| Sort params | n/a | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ (fixed desc) | ✖ | ✖ | ✖ | ✖ |
| Total-count metadata | n/a | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | n/a | n/a | ◐ (per-source `total`) |
| Bulk operations | n/a | ✖ | ✖ | ✖ | ✖ | ✔ (bibtex import) | ✖ | ✖ | ✖ | n/a | n/a | n/a |
| Idempotent-by-design writes | ◐ (refresh issues new pair — replayable) | ✖ | ✖ | ◐ (`index` re-runnable) | ✖ | ✖ | ✖ | ◐ (unique-number retry) | ✖ | ✖ | ◐ (PUTs idempotent) | ◐ (cache clear) |
| Rate limited | ✔ (×3) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Admin gate on mutations | n/a | role-based ✔ | role-based ✔ | role-based ✔ | role-based ✔ | role-based ✔ | role+author ✔ | role-based ✔ | role-based ✔ | ✔ admin | ✖ **any user** | ◐ (cache clear: any user) |
| Error envelope | ◐ detail-string | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |

Read-across: the biggest horizontal rifts are **pagination** (4 paginated vs 5 not), **creation style** (flat vs nested), **mutation authorization** (role-checked resources vs ungated instance-global settings), and **DELETE semantics** (one outlier). Error shape is uniformly `{"detail": ...}` for handled errors — the inconsistency is versus the middleware 500 envelope and validation arrays (H1).

---

## Positive Observations

1. **Clean versioning foundation.** Single `/api/v1` prefix via one aggregated router (`api/v1/api.py`) with tag-per-domain grouping — trivially evolvable to `/v2`.
2. **Disciplined authorization choreography.** Nearly every resource endpoint follows load → 404 → role-checked 403, powered by one reusable helper (`verify_user_access_to_owner`, `auth.py:164-177`) that already implements the polymorphic Owner/Membership model the spec mandated for Phase-3-readiness (§31).
3. **Correct core status codes where it matters most.** Creates 201, deletes 204, document version conflicts 409 (`documents.py:110-114`), upload-size violations 413, upstream-AI absence 503 (`papers.py:550-557`, `ai_writing.py:27`) with actionable remediation text.
4. **Honest AI failure surfacing.** Insufficient-evidence and provider-unavailable states are first-class response fields (`AskPaperAIResponse.insufficient_evidence`, `ChatResponse.trust_legend`) rather than hidden 200s-with-empty-strings — directly implements §33 Rules 3-5.
5. **Robust upload engineering.** Declared-length precheck, chunked streaming with running size cap, magic-byte header validation, partial-file cleanup, and thread-offloaded DB work (`papers.py:86-137`).
6. **Security-conscious middleware.** Client-supplied `X-Request-ID` sanitized against log injection (`middleware.py:18,30`); per-request latency logging; WebSocket auth via first-frame token (keeps JWTs out of URLs) with frame-size caps and per-window message rate limiting (`collaboration.py:34-37,171-223,266-279`).
7. **Anti-enumeration registration error** (`auth.py:61-64`) and `WWW-Authenticate` headers on credential failures (`auth.py:82,97`).
8. **Bulk BibTeX import is genuinely bulk-aware**: entry-count ceiling, size ceiling, empty-content rejection (`citations.py:332-343`).
9. **Query-performance care in list endpoints**: joinedload for citations (`citations.py:127-135`), single-query aggregation for team member counts (`teams.py:66-74`).
10. **Concurrency-aware version snapshots**: unique-constraint retry loop for concurrent snapshot creation (`version_history.py:36-49`).
11. **Health probe with component granularity** distinguishing required (DB → 503) from optional (Redis → degraded 200) dependencies (`health.py:12-56`).
12. **CORS exposure of `Content-Disposition`** so the browser frontend can read filenames (I9).

---

## Prioritized Recommendations

**P0 — Do now (security/contract integrity)**

1. **Gate local-user fallback behind an explicit mode flag** and return 401 for supplied-but-invalid tokens (C1). Add integration tests asserting 401-on-bad-token in `required` mode.
2. **Admin-gate instance-global mutators**: `PUT/DELETE /ai/providers/*`, `PUT /ai/rate-limit`, `PUT /ai/autocomplete-settings`, `POST /ai/autocomplete-settings/setup`, `POST /system/provider-cache/clear` (H2).
3. **Unify the error envelope** with dedicated exception handlers; adopt one shape (recommend RFC 7807 problem+json with `code` + `request_id` extensions) across HTTPException, validation errors, and the middleware (H1).

**P1 — Next sprint (contract coherence)**

4. Standardize collection pagination: add `skip/limit` (or cursor) + total metadata to projects, teams, team members, annotations, versions; add `X-Total-Count` or an envelope to the already-paginated lists; rename `research/search`'s `offset`→`skip` or document the difference (H5).
5. Pick one creation idiom (nested) and migrate `POST /documents`, `POST /documents/{id}/citations`; validate-or-drop redundant parent ids in `AnnotationCreate`, `CitationCreate`, `ContextRankingRequest`; remove the duplicate query/body `owner_id` on `POST /projects` (H4).
6. Fix status codes: duplicates/last-owner → 409; zotero import/sync → 201; team-members-list nonexistent → 404; provider DELETE → 204; restore → 201 (or document why 200) (M1).
7. Extend rate limiting to AI-generation, upload, export, and literature-search routes; emit `RateLimit-*` headers; plan Redis-backed counters (H3).

**P2 — Planned (documentation & evolution)**

8. Complete OpenAPI: `response_model`/`responses` for the 13 undocumented endpoints (incl. SSE frame schemas), add examples to major request/response models, publish a static OpenAPI artifact for production (M2).
9. Resolve the async-processing contract: real job queue with `202` + status polling, or an honestly-synchronous simplified contract (M7).
10. Define deletion semantics for teams (cascade vs 409-block) and give Team its own identity; add refresh-token revocation/rotation (M6).
11. Codify the "action endpoints" convention in docs; flatten the version-diff route; reconcile the WebSocket path in `architecture.md` (M3/L9).
12. Add conditional-request support (`ETag`/`If-Match`) for documents and papers; cache headers for external-search GETs; convert BibTeX GET exports to true file downloads (M4/M5/M10).
13. Tighten wire contracts with `Literal` enums (`mode`, `prompt_type`, `action`, `highlight_color`), cap body `limit`s, and decide the existence-disclosure policy (403-vs-404) once and document it (M8/L5/L6/L7/L8).

---

*End of report. Generated as part of the read-only audit series; no repository files were modified other than this report.*
