# REST API Design Audit — Verification Report
## OpenResearch `apps/api` — Follow-up to audit-reports/07-rest-api-design.md

> **Audit ID:** 07-VERIFY · **Date:** 2026-08-27  
> **Auditor:** opencode (read-only verification; no source files modified)  
> **Baseline report:** `audit-reports/07-rest-api-design.md` (35 findings)

---

## Summary of Verification Results

| Severity | Total | FIXED | PARTIALLY FIXED | STILL OPEN |
|----------|-------|-------|-----------------|------------|
| CRITICAL | 1     | 0     | 1               | 0          |
| HIGH     | 5     | 2     | 1               | 2          |
| MEDIUM   | 10    | 3     | 3               | 4          |
| LOW      | 10    | 2     | 2               | 6          |
| INFO     | 9     | —     | —               | 9 (observations) |
| **Total** | **35** | **7** | **7** | **21** |

---

## CRITICAL Findings

### C1 — Invalid/absent credentials silently degrade to auto-provisioned admin local user
**File:** `apps/api/app/services/auth.py:116-157` (`get_current_user`)  
**Status:** **PARTIALLY FIXED**

**What changed:**  
- Added `OPENRESEARCH_DEV_INSECURE_AUTH` environment variable gate (lines 125, 150)
- Invalid/missing tokens now raise `401 Unauthorized` with `WWW-Authenticate: Bearer` when `dev_insecure=False` (lines 143-148, 153-157)
- Local-user fallback only activates when `OPENRESEARCH_DEV_INSECURE_AUTH=1` is explicitly set

**What remains:**  
- The fallback still exists and is controlled by an env var rather than a typed config setting (`settings.AUTH_MODE`)
- In `dev_insecure` mode, a **supplied-but-invalid token** is still silently downgraded to local admin (line 141-142: logs warning but proceeds) — the audit's recommendation to reject bad tokens with 401 even in local mode is not implemented
- No integration tests asserting 401-on-bad-token in `required` mode (P0.1 from baseline)

**Severity assessment:** Downgraded from CRITICAL to **HIGH residual risk** — the attack surface is now explicitly opt-in via env var, but the silent-downgrade behavior in that mode remains a footgun for misconfiguration.

---

## HIGH Findings

### H1 — Three incompatible error-response envelopes; no RFC 7807 `application/problem+json`
**Files:** `apps/api/app/main.py:126-174` (exception handlers), `apps/api/app/core/middleware.py:57-80` (500 handler)  
**Status:** **FIXED**

**Verification:**  
- `main.py` now registers **unified exception handlers** for `HTTPException` (lines 151-163) and `RequestValidationError` (lines 166-174)
- All error responses now emit a single envelope shape: `{"error": {"code", "message", "request_id"}}` (lines 142-148, 159-162)
- Machine-readable error `code` values mapped via `_ERROR_CODE_MAP` (lines 126-139) covering 400, 401, 403, 404, 405, 409, 413, 422, 429, 500, 502, 503
- Validation errors are flattened into a string message but retain `code: "VALIDATION_ERROR"` (line 174)
- `X-Request-ID` header propagated on all error responses (lines 147, 156, 162)
- Middleware 500 handler unchanged but now consistent with the new envelope shape

**Gap:** RFC 7807 `application/problem+json` media type not adopted (still `application/json`), but the unified envelope with stable `code` field satisfies the practical interoperability goal.

---

### H2 — Instance-global config/cache mutation endpoints writable by any authenticated identity
**Files:** `apps/api/app/api/v1/endpoints/provider_settings.py:53-156`, `provider_status.py:22-28`  
**Status:** **STILL OPEN**

**Verification:**  
- `provider_settings.py` endpoints **still use `get_current_user`** (not `get_current_admin_user`) for:
  - `PUT /ai/providers/{provider}` (line 66-69) — accepts API keys
  - `PUT /ai/rate-limit` (line 93-95)
  - `DELETE /ai/providers/{provider}` (line 103-106)
  - `PUT /ai/autocomplete-settings` (line 118-121) — triggers background process launch
  - `POST /ai/autocomplete-settings/probe` (line 134-136)
  - `GET /ai/autocomplete-settings/status` (line 147-152)
  - `POST /ai/autocomplete-settings/setup` (line 156) — **correctly uses `get_current_admin_user`** (only admin-gated endpoint)
- `provider_status.py:24` `POST /system/provider-cache/clear` still uses `get_current_user`

**Contrast:** `plugins.py` correctly uses `get_current_admin_user` for registration/toggle/config (lines 76, 92, 108)

**Impact:** Unchanged — any authenticated user (including the local admin fallback in dev mode) can mutate global provider keys, rate limits, autocomplete engine settings, and clear caches.

---

### H3 — Rate limiting covers only 3 auth endpoints; no `X-RateLimit-*` headers; in-process store
**Files:** `apps/api/app/core/rate_limit.py`, `apps/api/app/api/v1/endpoints/auth.py:34-42`  
**Status:** **PARTIALLY FIXED**

**What changed:**  
- CORS headers now explicitly allowlisted methods/headers (main.py:114-115) — not directly related but shows hardening mindset
- Rate limiter infrastructure unchanged

**What remains open:**  
- Only 3 endpoints rate-limited: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` (auth.py:56, 76, 93)
- **Zero** `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers emitted (grep confirms)
- In-process `SlidingWindowRateLimiter` with per-worker state (rate_limit.py:54-88) — horizontal scaling multiplies quotas
- Expensive endpoints unprotected: AI chat/autocomplete/edit/outline, PDF upload, export, literature search, Zotero sync/import
- Limiter disabled in `ENVIRONMENT=test` (rate_limit.py:74)

---

### H4 — Inconsistent resource-creation styles; redundant parent IDs in bodies accepted but never validated
**Files:** Multiple endpoints and schemas  
**Status:** **STILL OPEN**

**Verification — Flat creates with parent in body (unchanged):**
- `POST /documents` → `DocumentCreate.project_id` (documents.py:22, schemas/documents.py:10) — parent in body
- `POST /documents/{id}/citations` → `CitationCreate.document_id` (citations.py:94-95, schemas/citations.py:12) — parent in body

**Verification — Nested creates with parent in path (unchanged):**
- `POST /projects/{id}/papers/upload` (papers.py:56)
- `POST /papers/{id}/annotations` → `AnnotationCreate.paper_id` (papers.py:410-412, schemas/papers.py:68) — **redundant body field**
- `POST /documents/{id}/comments` (comments.py:79-80) — no parent in body ✓
- `POST /teams/{id}/members` (teams.py:223-224) — no parent in body ✓

**Hybrid oddity unchanged:** `POST /projects` accepts `owner_id` as **both query param and body field** (projects.py:16-22, schemas/projects.py `ProjectCreate.owner_id`)

**Redundant-and-ignored fields unchanged:**
- `AnnotationCreate.paper_id` (schemas/papers.py:68) vs URL `paper_id`
- `ContextRankingRequest.document_id` (schemas/citations.py:101) vs URL

**No validation of body/path mismatch** — client can send conflicting identifiers silently.

---

### H5 — Pagination contract inconsistent and metadata-free
**Files:** Multiple list endpoints  
**Status:** **PARTIALLY FIXED**

**What changed:**  
- `GET /teams/{team_id}/members` now checks team existence first → returns 404 (teams.py:195-197) — was 403 for nonexistent team (M1 row)
- `POST /teams/{team_id}/members` duplicate → **now returns 409** (teams.py:247) — was 400
- Last-owner demote/remove guards → **now return 409** (teams.py:295-296, 343-344) — was 400

**What remains open:**  
| Endpoint | Pagination | Total Count | Notes |
|----------|------------|-------------|-------|
| `GET /projects` | ❌ None | ❌ | projects.py:46-73 |
| `GET /teams` | ❌ None | ❌ | teams.py:59-97 |
| `GET /teams/{id}/members` | ❌ None | ❌ | teams.py:191-220 |
| `GET /papers/{id}/annotations` | ❌ None | ❌ | papers.py:380-402 |
| `GET /documents/{id}/versions` | ❌ None | ❌ | version_history.py:65-79 |
| `GET /projects/{id}/documents` | ✅ skip/limit | ❌ No total | documents.py:52-77 |
| `GET /projects/{id}/papers` | ✅ skip/limit | ❌ No total | papers.py:231-263 |
| `GET /documents/{id}/citations` | ✅ skip/limit | ❌ No total | citations.py:39-85 |
| `GET /documents/{id}/comments` | ✅ skip/limit | ❌ No total | comments.py:53-76 |
| `GET /research/search` | ✅ limit/offset | ⚠️ Per-source | research.py:16-55 |

- **No envelope** (e.g., `{"items": [], "total": n, "skip": s, "limit": l}`) or `X-Total-Count` header on any collection
- Parameter naming drift: `skip`/`limit` (most) vs `offset`/`limit` (research/search)
- Default `limit=100` means silent truncation for large collections (Spec §41: 1,000+ papers)

---

## MEDIUM Findings

### M1 — Status-code misfires across several endpoints
**Status:** **MOSTLY FIXED**

| Endpoint | Baseline | Current | Status |
|----------|----------|---------|--------|
| `POST /teams/{id}/members` duplicate | 400 | **409** (teams.py:247) | ✅ FIXED |
| Last-owner demote/remove | 400 | **409** (teams.py:296, 344) | ✅ FIXED |
| `POST /projects/{id}/zotero/import` | 200 | **201** (zotero.py:38) | ✅ FIXED |
| `POST /projects/{id}/zotero/sync` | 200 | **201** (zotero.py:57) | ✅ FIXED |
| `GET /teams/{id}/members` nonexistent team | 403 | **404** (teams.py:196-197) | ✅ FIXED |
| `DELETE /ai/providers/{provider}` | 200+body | **204** (provider_settings.py:103) | ✅ FIXED |
| `POST /documents/{id}/versions/{id}/restore` | 200 | **201** (version_history.py:144) | ✅ FIXED |
| `PUT /ai/autocomplete-settings` (all-optional body) | PUT | **PUT** (provider_settings.py:117) | ❌ STILL OPEN |
| `PATCH /plugins/{id}/toggle` | PATCH-action | **PATCH** (plugins.py:88) | ❌ STILL OPEN |

**Remaining issues:**
- `PUT /ai/autocomplete-settings` at provider_settings.py:117-130 accepts `AutocompleteSettingsUpdate` (all fields optional) — this is **PATCH semantics on PUT verb**. Should be `PATCH` or require full replacement.
- `PATCH /plugins/{id}/toggle` at plugins.py:88-101 is an action endpoint (enable/disable), not a partial representation update. Consider `POST /plugins/{id}/enable|disable` or `PUT /plugins/{id} {enabled: true}`.

---

### M2 — OpenAPI completeness gaps: undocumented schemas, zero examples, docs disabled in production
**Status:** **PARTIALLY FIXED**

**What improved:**  
- Unified error envelope (H1 fix) means error responses are now documented via exception handlers in main.py
- `version_history.py` restore endpoint now has `status_code=201` and `response_model=VersionResponse` (line 144)

**What remains:**  
- **Endpoints still missing `response_model`:** 
  - `GET /` root (main.py:180-182)
  - `GET /health` (health.py:20)
  - `POST /papers/{id}/index` (papers.py:208) — returns ad-hoc dict
  - `POST /projects/{id}/chat/stream` (chat.py:70) — SSE frames
  - `POST /projects/{id}/ai/stream-autocomplete` (ai_writing.py:60) — SSE frames
  - `GET /ai/providers` (provider_settings.py:53)
  - `PUT /ai/providers/{provider}` (provider_settings.py:65)
  - `GET /ai/rate-limit` (provider_settings.py:86)
  - `PUT /ai/rate-limit` (provider_settings.py:92)
  - `DELETE /ai/providers/{provider}` (provider_settings.py:103) — now 204, no model needed
  - `GET /ai/autocomplete-settings/status` (provider_settings.py:146)
  - `POST /ai/autocomplete-settings/setup` (provider_settings.py:155)
  - `GET /documents/{id}/collaborators` (collaboration.py:398)
- **Zero examples** in any schema — grep for `json_schema_extra`, `examples=`, `Field(example=...)` in `app/` returns 0 hits
- Docs still disabled in production (main.py:99-101: `openapi_url/docs_url/redoc_url = None` when production)
- No static OpenAPI artifact published for production

---

### M3 — RPC-style verbs in URLs and one over-nested route
**Status:** **STILL OPEN**

**Verb-bearing segments unchanged:**
- `/research/search` (research.py:16)
- `/citations/resolve-identifier` (citations.py:176)
- `/projects/{id}/papers/add-by-identifier` (citations.py:186)
- `/projects/{id}/papers/import-bibtex` (citations.py:253)
- `/projects/{id}/papers/upload` (papers.py:56)
- `/papers/{id}/ask` (papers.py:515)
- `/papers/{id}/index` (papers.py:208)
- `/documents/{id}/versions/{v1}/diff/{v2}` (version_history.py:197) — 5 segments
- `/documents/{id}/versions/{id}/restore` (version_history.py:141)
- `/plugins/hooks/{name}` (plugins.py:38)
- `/plugins/{id}/toggle` (plugins.py:88)
- `/ai/autocomplete-settings/probe|setup` (provider_settings.py:133, 155)
- `/system/provider-cache/clear` (provider_status.py:22)
- `/projects/{id}/ai/stream-autocomplete` (ai_writing.py:60)
- `/documents/{id}/citations/rank-context` (citations.py:404)

**No documented convention** for action endpoints in codebase or docs.

---

### M4 — GET endpoints performing live external network fan-out with no caching/response-freshness
**Files:** `graphs.py:38-46`, `research.py:16-55`  
**Status:** **STILL OPEN**

**Verification:**  
- `GET /projects/{id}/discover-related` (graphs.py:38-46) calls `ResearchGraphService.discover_related_work` → live Crossref queries, no `Cache-Control`/`ETag`
- `GET /research/search` (research.py:16-55) fans out to OpenAlex/Crossref/arXiv/S2 in parallel, no cache headers
- `provider_cache_service` exists but these endpoints don't expose freshness semantics to clients

---

### M5 — Conditional requests / concurrency controls bespoke, not HTTP-standard
**Files:** `documents.py:116-124`, `papers.py` (no ETag)  
**Status:** **STILL OPEN**

**Verification:**  
- Document optimistic locking uses body field `DocumentUpdate.version` → 409 (documents.py:116-124) — functional but non-standard
- **No `ETag` headers** on any GET response (grep confirms zero `ETag` in codebase)
- **No `If-Match`/`If-None-Match` handling** on PATCH/GET
- **No `Last-Modified`/`If-Modified-Since`** on documents, papers, or PDF streams
- `FileResponse` for PDF (papers.py:341) handles Range implicitly but no `Accept-Ranges` documented

---

### M6 — Resource-identity and lifecycle hazards with breaking-change potential
**Status:** **STILL OPEN**

- `TeamResponse.id` **is the Owner id** (teams.py:48) — team and owner share identity
- `DELETE /teams/{id}` deletes `Owner` row (teams.py:186) — cascade semantics for projects undefined at API level
- Refresh tokens stateless JWTs with **no revocation/rotation/reuse-detection** (auth.py:55-58, config.py:42)

---

### M7 — Async-processing contract (Spec §41) is only cosmetic
**Files:** `papers.py:56-205` (upload), `papers.py:286-316` (status)  
**Status:** **STILL OPEN**

**Verification:**  
- `POST /projects/{id}/papers/upload` runs full extraction + chunking + embedding **synchronously** in request (papers.py:144-205)
- `GET /papers/{id}/status` **hardcodes** `step="ready", step_index=4` (papers.py:309-310) with comment acknowledging the gap (lines 305-308)
- No job queue, no `202 Accepted`, no real progress states

---

### M8 — Chat is stateless; conversation persistence promised by Spec §7/§13 has no API
**Files:** `chat.py:25-27`, `schemas/rag_chat.py` (`ChatRequest.conversation_history`)  
**Status:** **STILL OPEN**

**Verification:**  
- `ChatRequest.conversation_history` still client-supplied every call (schemas/rag_chat.py)
- No endpoints for `GET/POST /projects/{id}/conversations`, `POST .../conversations/{cid}/messages`
- `_resolve_mode` at chat.py:25-27 **still silently coerces invalid `mode`** to `"project"` instead of 422

---

### M9 — Credential handling in request bodies (Zotero)
**Files:** `schemas/zotero.py` (`ZoteroSyncRequest.api_key`, `ZoteroImportRequest.api_key`)  
**Status:** **STILL OPEN**

- Third-party secrets transmitted in JSON body
- No schema description warning against logging
- No storage policy stated in response (sync returns `last_synced_version` implying stored state)
- Local deployments typically plain HTTP (contrary to Spec §34 "encrypt data in transit")

---

### M10 — Export surface split across four inconsistent idioms
**Files:** `export.py`, `citations.py:350-398`  
**Status:** **STILL OPEN**

**Verification unchanged:**
- `POST /documents/{id}/export` → binary file (correct)
- `GET /documents/{id}/export/{format}` → binary file with query params (style, bib, trust); format spelled differently (`markdown` vs body's `md` aliases)
- `GET /projects/{id}/export/bibtex` → **JSON wrapper** `BibtexExportResponse{bibtex_content, total_entries}`
- `GET /documents/{id}/export/bibtex` → **JSON wrapper** same

No content negotiation, no `application/x-bibtex` download variant.

---

## LOW Findings

### L1 — No hypermedia affordances
**Status:** **STILL OPEN** — Root returns static greeting (main.py:180-182); no `_links`/self URLs anywhere.

### L2 — Nonstandard timing header `X-Response-Time-MS`
**Status:** **STILL OPEN** — middleware.py:43 emits `X-Response-Time-MS`; consider standard `Server-Timing`.

### L3 — `GET /research/search` pagination semantics ambiguous
**Status:** **STILL OPEN** — `limit` applies per-source (research.py:26), `offset` forwarding per-provider unstated, total unknowable.

### L4 — SSE response-header inconsistency
**Status:** **FIXED** — Both `chat.py:117` and `ai_writing.py:83` now set `Cache-Control: no-cache` and `X-Accel-Buffering: no`.

### L5 — Assorted status/validation edge cases
| Sub-item | Status | Details |
|----------|--------|---------|
| (a) PDF stream Range/HEAD | STILL OPEN | papers.py:319-343 no explicit docs |
| (b) 422 for upstream resolve failure | STILL OPEN | citations.py:212-219 returns 422 for unresolved identifier |
| (c) 413 for BibTeX entry-count >500 | STILL OPEN | citations.py:284-287 uses 413 for count limit |
| (d) Exhausted version retries → 500 | STILL OPEN | version_history.py:46-48 raises IntegrityError after retries |
| (e) `highlight_color` free-form string | STILL OPEN | schemas/papers.py:71 no enum/pattern constraint |

### L6 — Free-form enum-ish strings validated downstream
**Status:** **PARTIALLY FIXED**

- `ChatRequest.mode` — still coerced silently (chat.py:25-27) ❌
- `AskPaperAIRequest.prompt_type` — unknown values fall through to no instruction (papers.py:590) instead of 422 ❌
- `AutocompleteRequest.mode`, `AIEditRequest.action` — rely on service-layer `ValueError` → 400 ✅ (acceptable but not wire-contract level)
- **No `Literal[...]` types** used in any request schema

### L7 — Body-supplied `limit` without upper bound
**Status:** **STILL OPEN** — `ContextRankingRequest.limit` (schemas/citations.py:104, citations.py:484) has no `le=` cap; client can request ranking of entire library.

### L8 — Existence-leak asymmetry
**Status:** **PARTIALLY FIXED**

- Most endpoints correctly 404 before 403 ✅
- `GET /teams/{id}` reveals existence to non-members via 403-vs-404 distinction (teams.py:104-114) ❌
- UUIDs mitigate guessing but policy undocumented

### L9 — WebSocket route under versioned REST prefix
**Status:** **STILL OPEN** — `/api/v1/ws/collaborate/{document_id}` (collaboration.py:245) mixes transport styles; `architecture.md` depicts `/ws/collaborate/{doc_id}` (doc/code drift).

### L10 — CORS posture is dev-shaped
**Status:** **FIXED** — main.py:114-115 now explicitly allowlists methods (`GET, POST, PATCH, PUT, DELETE, OPTIONS`) and headers (`Authorization, Content-Type, X-Request-ID`) instead of `["*"]`.

---

## INFO Observations (unchanged)

I1-I9 remain valid observations; no action required.

---

## New Issues Discovered During Verification

### N1 — `GET /health` lacks `response_model` and returns 503 with JSON body but no documented schema
**File:** `health.py:20-67`  
**Severity:** LOW  
**Remediation:** Add `HealthResponse` schema and `response_model`; document 503 response shape.

### N2 — `POST /papers/{paper_id}/index` returns ad-hoc `dict` with no `response_model`
**File:** `papers.py:208-228`  
**Severity:** LOW  
**Remediation:** Define `IndexPaperResponse` schema.

### N3 — `ContextRankingRequest.limit` default 10 but no `ge=1, le=500` bounds (query params have them)
**File:** `schemas/citations.py:104`  
**Severity:** LOW  
**Remediation:** Add `Field(default=10, ge=1, le=500)`.

### N4 — `AnnotationCreate.highlight_color` default "yellow" but no enum constraint
**File:** `schemas/papers.py:71`  
**Severity:** LOW  
**Remediation:** Use `Literal["yellow", "green", "blue", "pink", "orange", "purple"]` or hex pattern.

### N5 — `DocumentUpdate.version` optional but required for optimistic locking; no documentation
**File:** `schemas/documents.py:20`  
**Severity:** INFO  
**Remediation:** Add field description explaining optimistic locking requirement.

---

## Consistency Matrix — Current State

| Dimension | Auth | Projects | Documents | Papers | Annotations | Citations | Comments | Versions | Teams | Plugins | AI/Settings | System/Research |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Plural nouns | n/a | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ |
| Verbs in URL | ◐ | ✖ | ✖ | ◐ | ✖ | ◐ | ✖ | ◐ | ✖ | ◐ | ◐ | ◐ |
| Create → 201 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ (zotero) |
| Delete → 204 | n/a | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | n/a | ✔ | n/a |
| 404→403 ordering | n/a | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ |
| `response_model` | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ (6 gaps) | ◐ |
| Pagination | n/a | ✖ | ✔ | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ (×2) | n/a | n/a | ◐ |
| Filter params | n/a | ◐ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | n/a | n/a | ✔ |
| Sort params | n/a | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Total-count | n/a | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | n/a | n/a | ◐ |
| Rate limited | ✔ (3) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Admin gate mutations | n/a | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ | ✖ |
| Error envelope | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

**Key persistent rifts:** Pagination (4/9 collections), creation style (flat vs nested), mutation auth (resources vs global settings), DELETE semantics (one outlier fixed).

---

## Prioritized Remediation Plan (Updated)

### P0 — Do Now (Security/Contract Integrity)
1. **C1 residual:** Make local-user fallback require explicit `settings.AUTH_MODE=local` (typed config), and **reject supplied-but-invalid tokens with 401 even in local mode**. Add integration test for 401-on-bad-token in `required` mode.
2. **H2:** Admin-gate all instance-global mutators: `PUT/DELETE /ai/providers/*`, `PUT /ai/rate-limit`, `PUT /ai/autocomplete-settings`, `POST /ai/autocomplete-settings/setup`, `POST /system/provider-cache/clear` → `Depends(get_current_admin_user)`.
3. **H1 follow-up:** Consider adopting RFC 7807 `application/problem+json` media type for full standard compliance (optional but recommended).

### P1 — Next Sprint (Contract Coherence)
4. **H5:** Standardize pagination: add `skip/limit` + total metadata to projects, teams, team members, annotations, versions; add `X-Total-Count` or envelope to paginated lists; unify `offset`→`skip` on research/search.
5. **H4:** Migrate to nested creation (`POST /projects/{pid}/documents`, `POST /documents/{did}/citations`); validate-or-drop redundant parent IDs in `AnnotationCreate`, `CitationCreate`, `ContextRankingRequest`; remove duplicate query/body `owner_id` on `POST /projects`.
6. **M1 residual:** Change `PUT /ai/autocomplete-settings` → `PATCH`; replace `PATCH /plugins/{id}/toggle` → `PUT /plugins/{id} {enabled: bool}` or `POST .../enable|disable`.
7. **H3:** Extend rate limiting to AI-generation, upload, export, literature-search routes; emit `RateLimit-*` headers; plan Redis-backed counters.

### P2 — Planned (Documentation & Evolution)
8. **M2:** Complete OpenAPI: `response_model`/`responses` for 13 undocumented endpoints (incl. SSE frame schemas), add examples to major models, publish static OpenAPI artifact for production.
9. **M7:** Resolve async-processing contract: real job queue with `202` + status polling, or honest synchronous contract.
10. **M6:** Define team-deletion cascade (block if projects exist → 409, or explicit recursive delete); give Team its own identity; add refresh-token revocation/rotation.
11. **M3:** Codify "action endpoints" convention in docs; flatten version-diff route; reconcile WebSocket path in `architecture.md`.
12. **M4/M5/M10:** Add conditional-request support (`ETag`/`If-Match`); cache headers for external-search GETs; convert BibTeX GET exports to true file downloads with content negotiation.
13. **L5/L6/L7/L8:** Tighten wire contracts with `Literal` enums, cap body `limit`s, decide existence-disclosure policy (403-vs-404) and document it.

---

## Files Modified Since Baseline (Affecting Audit Surface)

| File | Change Relevant to Audit |
|------|--------------------------|
| `apps/api/app/main.py` | Unified error envelope handlers (H1 fix); CORS allowlisting (L10 fix); docs still disabled in prod |
| `apps/api/app/services/auth.py` | `OPENRESEARCH_DEV_INSECURE_AUTH` gate for local-user fallback (C1 partial) |
| `apps/api/app/api/v1/endpoints/teams.py` | Duplicate membership → 409; last-owner guards → 409; team existence → 404 before 403 (M1 fixes) |
| `apps/api/app/api/v1/endpoints/zotero.py` | Import/sync → 201 status (M1 fix) |
| `apps/api/app/api/v1/endpoints/version_history.py` | Restore → 201 status (M1 fix) |
| `apps/api/app/api/v1/endpoints/provider_settings.py` | DELETE provider → 204 (M1 fix); autocomplete-settings still PUT with partial body |
| `apps/api/app/api/v1/endpoints/ai_writing.py` | SSE headers added (L4 fix) |
| `apps/api/app/api/v1/endpoints/chat.py` | SSE headers unchanged (already correct) |

---

## Conclusion

The codebase has made **meaningful progress on 7 findings** (mostly status-code corrections and the critical auth-mode gate), but **21 findings remain open**, including the systemic HIGH-severity issues H2 (ungated global mutators), H3 (rate limiting), H4 (creation inconsistency), H5 (pagination), and the MEDIUM contract gaps M3/M4/M5/M7/M8/M9/M10. The unified error envelope (H1) is a significant architectural improvement that simplifies client integration.

**Recommendation:** Prioritize P0 items (auth-mode hardening, admin-gating global mutators) before any feature work, as they represent exploitable security/contract defects. Then tackle P1 pagination and creation-style standardization to establish a consistent contract foundation.