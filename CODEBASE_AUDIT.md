# Codebase Audit Report

**Project:** OpenResearch — AI Academic Research & Writing Assistant
**Scope:** Full repository audit (frontend `apps/web`, backend `apps/api`, packages `packages/*`, infrastructure, docs)
**Date:** 2026-08-25
**Method:** Static analysis + full execution-path tracing. Every finding below was verified against source code; line numbers refer to the working tree at audit time.

---

## Executive Summary

OpenResearch is a genuinely implemented **single-user, local-first research workbench**: real SQLAlchemy persistence (SQLite dev / PostgreSQL prod), real Alembic migrations, real external integrations (Crossref, arXiv, PubMed, Zotero API, GROBID, pdfplumber, Ollama/OpenAI/Anthropic), and a real RAG chat pipeline with honest "insufficient evidence" semantics.

However, it is **not a multi-user production application**, and several flagship features are fabricated:

1. **Authentication is decorative.** The web client has no login UI and never sends credentials; the backend resolves *every* request — including requests with invalid tokens or no token at all — to an auto-provisioned **admin** user (`local@openresearch.dev`). Login/register endpoints exist but are unreachable from the shipped frontend.
2. **Four "AI intelligence" surfaces return fabricated content** in the production path: selection Ask-AI (canned templates), Literature Matrix (hardcoded cell values), Discover Related Work (invented DOIs/papers), and the Evaluation Benchmark (simulated scores with a constant metric).
3. **Real-time collaboration broadcasts edits but never persists them**, and its WebSocket accepts an empty token as the local admin.
4. **Server-global LLM API keys can be set/repointed by any unauthenticated caller**, stored plaintext on disk.
5. Demo/sample data is seeded into the production path (a fake "Attention Is All You Need" paper, a hardcoded quantum-computing sample document auto-created on the server for every new project).

The honest characterization: **a well-engineered local demo wearing the clothes of a multi-user SaaS platform.**

---

## Overall Production Readiness

### Score: 4/10

- **As a single-user local/self-hosted tool:** ~7/10 — CRUD, uploads, extraction, citations, export, chat all really work against a real database.
- **As a multi-user production service for real users:** ~2/10 — no functioning auth from the UI, zero tenant isolation, unauthenticated admin-equivalent control of global secrets, multiple fake AI features, non-persistent collaboration.

The answer to *"If I remove all demo/mock/test data and deploy this for real users, what will actually work?"*:

> Projects, documents (with autosave), PDF upload/extraction, annotations, BibTeX/identifier import, citation management, exports (MD/DOCX/PDF/BibTeX), RAG chat (when Ollama or a cloud key is configured), research graphs, comments, version history, and Zotero import **will genuinely work — but only as one shared anonymous admin user**. Registration/login, per-user data isolation, team security, claim verification badges, literature matrices, related-work discovery, evaluation benchmarks, and real-time collaborative editing **will not deliver what they advertise**.

---

## Critical Findings

### C-1. Authentication is bypassed by design — every request becomes an admin

- **Where:** `apps/api/app/services/auth.py:108-129` (`get_current_user`), `apps/api/app/services/auth.py:71-105` (`get_or_create_local_user`)
- **Evidence:**
  ```python
  def get_current_user(auth=..., db=...) -> User:
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
              pass                      # invalid tokens fall through!
      return get_or_create_local_user(db)   # auto-creates ADMIN user
  ```
  The fallback user is created with `is_admin=True` (`auth.py:89`) and password = its own email (`auth.py:86`).
- **Why problematic:**
  - No `ENVIRONMENT` gating — this applies identically in `ENVIRONMENT=production`.
  - All 65 HTTP routes' `Depends(get_current_user)` checks and all `verify_user_access_to_owner(...)` ownership checks are **vacuous** for unauthenticated traffic: everyone is the same admin.
  - `get_current_admin_user` (`auth.py:132-138`) is meaningless — every anonymous caller is admin.
  - Any network-reachable deployment exposes full read/write/delete of all projects, documents, papers, uploads, teams, versions, and comments to anyone.
  - Even *deliberately invalid* tokens are silently swallowed (`except jwt.InvalidTokenError: pass`) instead of being rejected.
- **Classification:** Mock/fake security mechanism. 🔴 **Critical**
- **Fix:** Reject missing/invalid credentials unless an explicit `LOCAL_MODE=true` flag (dev-only, default off in production) enables the single-user fallback; gate the fallback behind `ENVIRONMENT != production`; fail closed on malformed tokens.

### C-2. Web frontend hardcodes authentication success; no login exists in the product

- **Where:** `apps/web/src/context/AuthContext.tsx:12-36`
- **Evidence:**
  ```ts
  export const LOCAL_USER: User = { id: 'local-user', email: 'local@openresearch.local', ... };
  const value: AuthContextType = {
    user: LOCAL_USER,
    isAuthenticated: true,     // always true, hardcoded
    isLoading: false,
    isOfflineMode: false,
  };
  ```
  And `apps/web/src/lib/api/client.ts:59-79` — `request()` sends only `Content-Type`; **no `Authorization` header is ever attached anywhere in `apps/web/src`** (verified by grep; a unit test even asserts its absence: `apps/web/src/lib/api/client.test.ts:71`).
- **Why problematic:** The backend's `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/me` endpoints (real implementations with bcrypt + JWT + rate limits, `apps/api/app/api/v1/endpoints/auth.py:52-115`) have **zero callers in the web app**. There is no registration page, no login page, no logout, no token storage, no session restore. A new user cannot register or log in through the product.
- **Classification:** Fake authentication state / dead auth feature. 🔴 **Critical**
- **Fix:** Implement login/register/refresh flows wired to the existing backend endpoints, attach Bearer tokens in `client.ts`, handle 401 → redirect, persist refresh tokens securely (httpOnly cookie preferred).

### C-3. Global LLM provider credentials controllable by any unauthenticated caller

- **Where:** `apps/api/app/api/v1/endpoints/provider_settings.py:39-62`; `apps/api/app/services/provider_settings.py:46-76`
- **Evidence:** `PUT /ai/providers/{provider}` and `DELETE /ai/providers/{provider}` require only `Depends(get_current_user)` — which, per C-1, is anyone. Keys are written in plaintext JSON to `<storage>/../provider_keys.json` (`_save_store`, lines 65-68). The `custom` provider accepts an arbitrary `base_url` (line 162); `llm_service._generate_openai_compatible` then POSTs `Authorization: Bearer <key>` to whatever URL is configured (`llm_service.py:110-128`).
- **Why problematic:** An attacker who can reach the API can (a) replace the server's OpenAI/Anthropic keys, (b) point `custom.base_url` at their own server and harvest credentials/tokens sent through subsequent LLM calls, or (c) silently disable AI. No encryption-at-rest for keys.
- **Classification:** Insecure secret handling + missing authorization. 🔴 **Critical**
- **Fix:** Require admin auth (post-C-1), encrypt keys at rest or use a secret manager, validate/allow-list base URLs, document key storage clearly.

---

## High-Severity Findings

### H-1. Selection "Ask AI" returns canned template text, not AI

- **Where:** Backend `apps/api/app/api/v1/endpoints/papers.py:494-501` (`ask_paper_ai`); mirrored client-side in `apps/web/src/context/PaperContext.tsx:524-537`.
- **Evidence (backend):**
  ```python
  answer = f'**Passage Explanation:**\n\nThe highlighted text argues: "{selected[:120]}...".
  In the context of {paper.title}, ... The authors emphasize that this mechanism reduces
  computational overhead while maintaining theoretical consistency.'
  ```
  Three fixed templates keyed on `prompt_type` (`explain`/`summarize`/`findings`/other). No LLM call, no RAG lookup, identical output for every paper.
- **Impact:** The PdfReader presents these as answers ("Source-Grounded Answer", `PdfReader.tsx:813-818`). Fabricated authority over user documents. 🟠 **High**

### H-2. Literature Matrix returns hardcoded content unrelated to actual papers

- **Where:** `apps/api/app/services/intelligence_service.py:370-385` (cells built at 388-422).
- **Evidence:** Cell values chosen by keyword-matching the paper **title**: `"Self-attention transformer architecture with scaled dot-product attention"`, `"WMT 2014 English-to-German & English-to-French benchmarks"`, with fabricated provenance (`page_number=2, section="Methodology"`). None of `intelligence_service.py` imports or calls `llm_service` (verified).
- **Impact:** Users receive confident, sourced-looking but invented comparative data. 🟠 **High**

### H-3. "Discover Related Work" fabricates papers with invented DOIs

- **Where:** `apps/api/app/services/graph_service.py:216-253` (empty-library case 189-202).
- **Evidence:**
  ```python
  DiscoveryRecommendation(id="rec-disc-1",
    title=f"Advanced Frontiers in {topic_labels[0].capitalize()} Methods and Frameworks",
    doi="10.1145/3618257.3624801", arxiv_id="2402.18902", relevance_score=0.96, ...)
  ```
  Hardcoded DOIs/arXiv IDs/authors templated around extracted keywords; no external scholarly search is performed (no httpx import in file). 🟠 **High**

### H-4. Evaluation benchmark is simulated yet exposed as a system-health feature

- **Where:** `apps/api/app/services/eval_service.py:282-306, 400-414`; endpoints `apps/api/app/api/v1/endpoints/evaluation.py:11-30`.
- **Evidence:** Retrieval results are fabricated from the gold set itself: `retrieved = tc.target_papers + ["extra_paper_noisy_sample"]`; answer text is hardcoded gold claims; `answer_relevance_pct=94.5` is a constant. Self-labeled `[SIMULATED]` in schema, but both GET and POST run uncached CPU-bound computation per request with no rate limit (cheap DoS vector) and no frontend caller at all. 🟠 **High** (fake feature) / 🟡 Medium (DoS)

### H-5. Real-time collaboration never persists edits & accepts empty-token joins

- **Where:** `apps/api/app/api/v1/endpoints/collaboration.py:166-168` (auth), `273-284` (`doc_edit` handling).
- **Evidence:**
  ```python
  if not token:
      # Local single-user mode...
      user = get_or_create_local_user(db)   # anyone joins as admin
  ...
  elif msg_type == "doc_edit":
      await collab_manager.broadcast(...)   # broadcast only — no DB write anywhere
  ```
  Edits fanned out to peers vanish on disconnect unless the client separately PATCHes; no message size/rate bounds; broad `except Exception: pass` swallowing; clients can spoof their presence `user_info` via `init_user`. 🟠 **High**

### H-6. Multi-user/team features are unusable end-to-end

- Teams RBAC, memberships, roles are fully implemented server-side (`teams.py`, real SQLAlchemy), and TeamModal calls the real API — but with C-1/C-2 there is no second user, no login, and every visitor *is* the admin. Last-owner demotion/removal is possible (`teams.py:238-274`), role strings unvalidated, member emails enumerable (404 vs 200). 🟠 **High** (as a multi-user claim; individual bugs are Medium)

### H-7. Sample/demo content is seeded into the server-side production path

- **Where:** `apps/web/src/context/DocumentContext.tsx:44-99` (`DEFAULT_SAMPLE_CONTENT`), used at lines 200-205 when a project has no documents; `ProjectContext.tsx:83-90` auto-creates `'Academic Research Project'` on the server.
- **Evidence:** Every brand-new project gets a fabricated "Variational Quantum Algorithms for Optimization" draft (with LaTeX equations) persisted to the real database as if the user wrote it. 🟠 **High** (demo data in production path)

### H-8. Offline/demo mode ships fabricated data and fake AI, toggled by a constant

- **Where:** `apps/web/src/context/PaperContext.tsx:154-253` (full fake "Attention Is All You Need" paper with sections/tables/equations), `307-361` (simulated upload with `setTimeout(600/800/500)`), `516-546` (canned AI answers). Currently dead because `AuthContext.tsx:33` hardcodes `isOfflineMode: false` — but the entire branch ships to production bundles and activates the moment that flag flips. 🟠 **High** (latent), 🔵 Low while unreachable.

---

## Medium-Severity Findings

| ID | Finding | Evidence | Severity |
|----|---------|----------|----------|
| M-1 | **Fake-success patterns in UI**: Research graph "Add to Library" is `alert('Added ... to library!')` with no API call | `apps/web/src/components/intelligence/ResearchGraphView.tsx:504` | 🟡 |
| M-2 | Citation-insert toast shows success **before** server sync; failure only `console.warn` | `DocumentContext.tsx:447-459` | 🟡 |
| M-3 | Upload progress "Extracting"/"Embeddings" stages driven by arbitrary timers around a single fetch; real status endpoint never polled (`papersApi.status` unused) | `PaperContext.tsx:367-394`; `lib/api/papers.ts:118-121` | 🟡 |
| M-4 | Hardcoded fake collaborator avatar "A" titled "Active collaborators online"; no presence code exists | `AppShell.tsx:556-564` | 🟡 |
| M-5 | Claims badge permanently reads "Claims verified": `setUnsupportedClaimsCount` never called anywhere | `AppShell.tsx:91,595-605` (grep-verified) | 🟡 |
| M-6 | "Find Sources" for unsupported claims discards the query argument | `AppShell.tsx:411-413` | 🟡 |
| M-7 | Misleading copy: settings badge says provider keys "Stored locally on this machine" while they are PUT to the server | `AppShell.tsx:902` vs `handleSaveProvider` 447-489 | 🟡 |
| M-8 | Rate limiting only on auth routes; in-process; keyed on spoofable `X-Forwarded-For`; disabled under `ENVIRONMENT=test` | `app/core/rate_limit.py:18-45` | 🟡 |
| M-9 | Absolute server filesystem paths leaked to clients (`pdf_path`) | `schemas/models.py:164,181`; populated `papers.py:172` | 🟡 |
| M-10 | Silent localStorage fallbacks swallow server errors → silent data divergence between browser and DB | `ProjectContext.tsx:92-94,126-128`; `DocumentContext.tsx:212-214` | 🟡 |
| M-11 | Zotero sync: cap 50 items, no pagination; hardcoded `last_synced_version=1`; Collection-ID field collected in UI but never sent | `zotero_service.py:159,183`; `ZoteroImportModal.tsx:81-84` | 🟡 |
| M-12 | BibTeX export interpolates user fields without escaping (export injection/corruption); import regex unbounded & mis-parses nested braces | `citations.py:60-85, 305-322` | 🟡 |
| M-13 | Add-by-identifier persists junk rows titled `"Paper <raw id>"` with status `unresolved` and returns 201 | `citations.py:257` | 🟡 |
| M-14 | Embeddings are hash-based pseudo-vectors, not model embeddings (weak semantic recall); stored as JSON blocks pgvector migration despite docs claiming pgvector | `rag_service.py:42-92`; `models/chunk.py:29-30` | 🟡 |
| M-15 | Debug endpoint dumps raw chunks (`GET /projects/{id}/chunks`) reachable by anyone (given C-1) | `chat.py:102-125` | 🟡 |
| M-16 | Provider-cache clear (`POST /system/provider-cache/clear`) has no admin gate — global destructive action | `provider_status.py:22-29` | 🟡 |
| M-17 | Teams: arbitrary role strings accepted; last-owner demote/remove possible; deleting a team cascades all projects/docs/papers with no guard | `teams.py:214,238-274,164-165`; `models/owner.py:37-40` | 🟡 |
| M-18 | Version restore computes next number via max+1 without unique constraint/lock → duplicate version numbers under concurrency | `version_history.py:135-141` | 🟡 |
| M-19 | AI-writing fallbacks fabricate academic boilerplate when LLM unavailable; "translate" merely prefixes `[Traduction française]:`; SSE stream is one-shot delivered as two frames; placeholder latency defaults (120/150/250 ms) | `ai_writing_service.py:168-178,375-387,126-143`; `schemas/models.py:457,479,506` | 🟡 |
| M-20 | Health endpoint leaks environment name; `X-Request-ID` echoed verbatim into logs (log-forgery surface); unknown export format silently falls back to Markdown instead of 400 | `health.py:45-52`; `middleware.py:25-26`; `export/service.py:73-80` | 🟡 |
| M-21 | Paper extraction total failure fabricates metadata (title from filename, "Unknown Author") and still returns 201; RAG indexing failure swallowed (paper saved unsearchable, client unaware) | `papers.py:141-159,181-184` | 🟡 |
| M-22 | Comments: top-level create doesn't validate `parent_id` belongs to same document | `comments.py:91-101` | 🟡 |

## Low-Severity Findings

| ID | Finding | Evidence |
|----|---------|----------|
| L-1 | Dead component `PlaceholderShell` (full static mock workspace) never imported | `components/Placeholder.tsx` |
| L-2 | Dead API modules/methods: `evaluationApi.*`, `ragApi.search/listChunks`, `papersApi.getPdfUrl/status/index`, `aiWritingApi.streamAutocomplete`, `citationsApi.rankContext` | `lib/api/*.ts` (grep: zero callers) |
| L-3 | Browser extension: `content.js` message handler never invoked; `background.js` is a console.log stub; broad host permissions on 9 domains unused; token stored plaintext in `chrome.storage.local` | `packages/browser-extension/*` |
| L-4 | `mockRef` variable name in production renderer (not actual mock data — builds reference from node attrs) | `packages/editor/src/extensions/citation.ts:122` |
| L-5 | `OpenAlexProvider` returns empty stubs ("Typed stub for Phase 1"); other providers in package also thin | `packages/research/src/providers/openalex.ts:10-29` |
| L-6 | `citationCount={stats.characters}` — character count passed as citation count to ExportModal | `ModalContainer.tsx:150` |
| L-7 | Shortcuts modal documents shortcuts that don't exist (`Ctrl+Shift+C`, `Ctrl+\`) | `ShortcutsModal.tsx:50,58` vs `AppShell.tsx:222-239` |
| L-8 | Missing CSS animation classes referenced by components (`animate-slide-in-right/left`) | `LiteratureMatrixView.tsx:454`, `CommentsPanel.tsx:116` |
| L-9 | `onApplyFix` prop threaded through AppShell→PaperReviewView but never used; unused imports | `PaperReviewView.tsx:34-39` |
| L-10 | Docs drift: architecture doc advertises JWT-auth middleware & pgvector hybrid retrieval; reality is fallback-auth + JSON embeddings | `docs/architecture.md` vs code |
| L-11 | Internal phase/doc-reference labels shipped in UI ("Phase 8", "Phase 4 RAG", internal spec references) | `LeftNavigation.tsx:129-131`, `AiResearchChat.tsx:215` |
| L-12 | Ghost-text hourly usage counter never resets and is client-side only; latency-tier setting cosmetic | `AppShell.tsx:104-106,674-679` |
| L-13 | Non-atomic paper delete (file removed before DB commit) | `papers.py:329-336` |

---

## Mock Data Findings

**In the live production path:**
1. `DEFAULT_LOCAL_PROJECT` "Quantum Machine Learning" seed — `ProjectContext.tsx:27-34` (localStorage fallback only today, but shipped).
2. `DEFAULT_SAMPLE_CONTENT` quantum-paper draft — **persisted server-side** for each new project — `DocumentContext.tsx:44-99,200-205`.
3. Fabricated initial editor stats `{words:78, characters:512}` shown before editing — `DocumentContext.tsx:130-134`.
4. Demo paper "Attention Is All You Need" with fabricated sections/tables/equations/references — `PaperContext.tsx:165-250` (gated behind `isOfflineMode=false`; latent).
5. Canned Ask-AI templates — `papers.py:494-501` (**live**).
6. Hardcoded Literature-Matrix cells — `intelligence_service.py:370-385` (**live**).
7. Fabricated discovery recommendations w/ invented DOIs — `graph_service.py:216-253` (**live**).
8. Simulated evaluation benchmark incl. constant `94.5%` — `eval_service.py:282-306,414` (**live**, self-labeled simulated).
9. Plugin-manager register form pre-filled with sample manifest — `PluginManagerModal.tsx:146-161` (submits really, content is sample).
10. Fake collaborator avatar & always-green claims badge — `AppShell.tsx:556-564,595-605`.

**Legitimate (not flagged):** test fixtures/mocks under `apps/api/tests/*` and `*.test.ts(x)` (never imported by runtime code); HTML input `placeholder` attributes; TipTap `@tiptap/extension-placeholder`; i18n strings; `.env.example` values; loading skeletons.

---

## Authentication Audit

| Mechanism | Status | Evidence |
|---|---|---|
| Password hashing | ✅ Real | bcrypt with 72-byte truncation — `services/auth.py:23-32` |
| Register/Login/Refresh endpoints | ✅ Real (server-side) | `endpoints/auth.py:52-110`; JWT HS256 with access/refresh type separation — `services/auth.py:35-59` |
| Email verification | ❌ Missing | No flow anywhere |
| Logout / token revocation | ❌ Missing | Refresh tokens valid until 30-day expiry; no denylist — `auth.py:87-110` |
| Session mgmt (web) | ❌ Fake | Hardcoded `isAuthenticated: true` — `AuthContext.tsx:31` |
| Token attachment (web) | ❌ Absent | `client.ts:59-79`; asserted absent in `client.test.ts:71` |
| OAuth / Google / GitHub | ❌ Missing | Not present |
| RBAC enforcement | ⚠️ Implemented server-side, moot | `verify_user_access_to_owner` — `services/auth.py:164-177`; vacuous under C-1 |
| Admin gating | ⚠️ Vacuous | Everyone gets `is_admin=True` local user — `services/auth.py:89` |
| Protected routes (frontend) | ❌ N/A | Single-page app, no router guards; nothing to protect because everything is open |
| WebSocket auth | ⚠️ First-frame design good, bypassable | Empty token → local admin join — `collaboration.py:166-176` |

**Verdict:** Credentials ARE verified against the database when presented — but the product never presents them, and the backend refuses nothing. Authentication is effectively **bypassed**.

---

## Authorization Audit

- Per-endpoint ownership checks exist and are correctly written (e.g., `projects.py:27,49,75,91,112`; comment author-only edit `comments.py:168-170`; annotation role gates `papers.py:354+`). Under C-1 they are decorative: one shared admin identity owns everything.
- **IDOR:** For a hypothetical second *real* token user, object access goes through owner-membership verification (good). But since the fallback grants the shared admin account to everyone, cross-*user* isolation cannot exist: any two visitors see and mutate the same data.
- **Frontend restrictions bypassable:** trivially — all APIs accept unauthenticated calls (C-1), including global settings writes (C-3) and cache clears (M-16).
- **Roles enforced server-side:** yes where coded (`owner/editor/viewer` filters in `verify_user_access_to_owner`), but role strings from `TeamMemberAdd.role` are unvalidated (M-17).

---

## API Audit

Complete inventory: **66 routes** (65 HTTP + 1 WS) under `/api/v1`, registered in `app/api/v1/api.py:26-46`. Highlights (auth/ownership columns assume post-C-1 reality):

| Group | Endpoints | Auth dep | Ownership check | Real implementation? |
|---|---|---|---|---|
| Health | GET /health | none (OK) | n/a | ✅ (leaks env name) |
| Auth | register/login/refresh/me | none + RL / yes | n/a | ✅ real, **unused by web app** |
| Projects | 5 CRUD | yes (moot) | yes | ✅ real SQLAlchemy |
| Documents | 5 CRUD (+optimistic locking) | yes (moot) | yes | ✅ real; 409 on version mismatch |
| Papers | upload/index/list/get/status/pdf/delete/annotations×4/**ask** | yes (moot) | yes | ✅ real GROBID→pdfplumber pipeline; **❌ ask = canned templates (H-1)** |
| Chat/RAG | chat / rag/search / chunks | yes (moot) | yes | ✅ hybrid BM25+cosine + LLM w/ honest refusal; hash embeddings (M-14); chunks = debug endpoint (M-15) |
| Citations | list/create/delete/resolve/add-by-id/import-bibtex/export-bibtex×2/rank-context | yes (moot) | yes | ✅ real Crossref/arXiv/PubMed resolver; issues M-12/M-13 |
| AI Writing | autocomplete / stream-autocomplete / edit / outline | yes (moot) | yes | ⚠️ real when LLM configured; fabricated boilerplate fallbacks (M-19); SSE is one-shot |
| Export | 2 routes | yes (moot) | yes | ✅ real MD/DOCX/PDF/BibTEX exporters; silent md fallback (M-20) |
| Evaluation | benchmark GET/POST | yes (moot) | n/a | ❌ **fully simulated (H-4)**; no frontend caller |
| Intelligence | verify-claims / research-gaps / literature-matrix / paper-review | yes (moot) | yes | ⚠️ heuristics; **matrix fabricated (H-2)**; review floors scores ≥~52 |
| Zotero | import / sync | yes (moot) | yes | ✅ real api.zotero.org; caps/fake version field (M-11) |
| Provider status/settings | 5 routes | partial | **global, no ownership** | ✅ real; **critical exposure (C-3, M-16)** |
| Teams | 9 routes | yes (moot) | yes | ✅ real; lifecycle gaps (M-17) |
| Collaboration | WS + collaborators | first-frame (bypassable) | doc/project check | ⚠️ broadcast-only, **no persistence (H-5)** |
| Comments | 6 routes | yes (moot) | author/owner rules | ✅ real; parent_id gap (M-22) |
| Versions | 5 routes | yes (moot) | yes | ✅ real diff/restore; race (M-18) |
| Graphs | research-graph / discover-related | yes (moot) | yes | ✅ graph real; **discovery fabricated (H-3)** |
| Plugins | 5 routes | admin (vacuous) | n/a | ✅ metadata-only; write-on-read seeding; no code exec |

Dead endpoints (defined, never called by the shipped frontend): `rag/search`, `chunks`, `papers/status`, `papers/pdf`, `papers/index`, `stream-autocomplete`, `rank-context`, `evaluation/benchmark` (both verbs).

---

## Database Audit

- **Engine:** Real SQLAlchemy 2.0 engine from `DATABASE_URL` — `app/core/database.py:9`; SQLite pragmas for dev, `pool_pre_ping`.
- **Local dev currently runs SQLite** (`apps/api/.env` DATABASE_URL confirmed `sqlite:///./openresearch_dev.db`; file present, 100% gitignored). Production compose uses Postgres+pgvector image — `infrastructure/docker-compose.selfhost.yml:44`; config validator forbids SQLite in production (`config.py:90-94`). ✅
- **Migrations:** Alembic runs at startup with pre-Alembic stamping — `main.py:20-48`. ✅
- **Models:** Consistent UUID-PK schema; polymorphic Owner + Membership RBAC; Paper/Chunk/Citation/Comment/Version/PluginConfig. Real. Notable gaps: embeddings stored as JSON (blocks pgvector), no unique(document_id, version_number).
- **CRUD:** All traced operations perform real commits (`db.commit()` throughout endpoints). Persistence verified by code path; no in-memory arrays acting as databases server-side.
- **Frontend bypass risk:** Contexts write localStorage in parallel with server writes and fall back to localStorage on any server error (M-10) — data can diverge silently; `local-*` prefixed IDs exist only in the browser and will 404 server-side after a connectivity blip.

Trace example (documents): Editor autosave → `updateActiveDocument` → `api.documents.update` → PATCH `/documents/{id}` → optimistic-lock check → `db.commit()` → Postgres/SQLite row. ✅ Real.

---

## Frontend Audit

| Feature | UI Exists | Real Logic | Real API | Real Data | Production Ready |
|---|---|---|---|---|---|
| Auth/session | ❌ (none) | ❌ hardcoded | n/a | ❌ | No |
| Projects CRUD | ✅ | ✅ | ✅ | Mixed (seed/auto-create H-7) | Partial |
| Documents + autosave | ✅ | ✅ | ✅ | Mixed (sample seed H-7) | Partial |
| TipTap academic editor | ✅ | ✅ | local content | ✅ user content | Yes |
| @-citation popover | ✅ | ⚠️ client ranking | ❌ rankContext unused | ✅ | Partial |
| AI continuation/edit cards | ✅ | ✅ | ✅ ai.autocomplete/edit | ⚠️ accept mutates plain_text only (content_json divergence — may not render in JSON-driven editor) | Partial |
| Ghost text | ✅ | ✅ | ✅ | ✅ | Partial (client-side quota only) |
| AI outline | ✅ | ✅ | ✅ | ⚠️ `||4500` word-count fallback | Yes-ish |
| RAG research chat | ✅ | ✅ | ✅ chat.send | ✅ honest refusals | Yes (needs LLM/Ollama) |
| Library upload pipeline | ✅ | ⚠️ timer theater | ✅ upload | ✅ | Partial |
| PDF reader pane | ✅ | ⚠️ extracted-text-as-page ("Simulated Paper Header"), zoom = CSS scale | ❌ getPdfUrl unused | Extracted text | Partial (no real PDF rendering) |
| Annotations/highlights | ✅ | ✅ | ✅ online / localStorage offline | ✅ | Yes (online) |
| Ask-AI on selection | ✅ | ✅ plumbing | ✅ papers.ask | ❌ canned answers (H-1) | No |
| Citations manager/bibliography | ✅ | ✅ | Partial | Mixed | Partial |
| BibTeX import/export | ✅ | ✅ | ✅ | ✅ | Yes (escaping gap M-12) |
| Add-by-identifier | ✅ | ✅ | ✅ | ✅ | Yes (junk rows M-13) |
| Zotero import/sync | ✅ | ✅ | ✅ | ⚠️ 50-cap; collection field ignored (M-11) | Partial |
| Literature Matrix | ✅ | ✅ | ✅ | ❌ fabricated cells (H-2) | No |
| Research Gaps | ✅ | ✅ | ✅ | ⚠️ heuristic, disclaimed | Partial |
| Paper Review | ✅ | ✅ | ✅ | ⚠️ heuristic, floored scores; dead onApplyFix | Partial |
| Research Graph | ✅ | ✅ | ✅ | ✅ computed | Partial (fake add-to-library M-1) |
| Related-work discovery | ✅ | ✅ plumbing | ✅ | ❌ fabricated papers (H-3) | No |
| Claim verification | ✅ | ✅ | ✅ | ⚠️ keyword heuristic; badge fake (M-5) | Partial |
| Global search (Ctrl+K) | ✅ | ⚠️ client-side filter only | ❌ | Loaded data only | Partial |
| Collaborator presence | ✅ visuals | ❌ | ❌ | ❌ hardcoded avatar (M-4) | No |
| Comments | ✅ | ✅ | ✅ | ✅ | Yes (breaks silently on local-doc ids) |
| Version history | ✅ | ✅ | ✅ | ✅ ("auto-created" copy unverified) | Yes |
| Teams management | ✅ | ✅ | ✅ | ❌ unusable without auth (H-6) | No (as shipped) |
| Plugins manager | ✅ | ✅ | ✅ | ✅ metadata-only | Partial |
| Provider keys settings | ✅ | ✅ | ✅ | ⚠️ misleading storage copy (M-7) | Partial |
| Export dialog | ✅ | ✅ | ✅ | ⚠️ wrong citationCount (L-6) | Yes |
| Evaluation dashboard | ❌ no UI | — | dead module | — | No |

**Button spot-checks (does it do what it says?):**
- "Add to Library" (graph recommendations): **No** — `alert()` only (`ResearchGraphView.tsx:504`).
- "View PDF Original" (unverified banner): **No** — no onClick (`PdfReader.tsx:352`).
- "Claims verified" header button: **Misleading** — static state, opens panel only.
- Save/theme/project switcher/upload/cite/export/version restore: **Yes**, verified to real APIs.

---

## Backend Audit

- Controllers/routers: real, consistently structured, error envelope middleware, correlation IDs. ✅
- Services: RAG (hybrid search, trust filtering, refusal branch) real; llm_service real cloud+Ollama with honest `None` failure semantics (`llm_service.py` whole file); identifier_resolver real (Crossref/arXiv/PubMed, 24h cache); zotero real; export real (reportlab/python-docx); pdf_extractor GROBID→pdfplumber real; plugin_service metadata-only (no code execution — safe).
- Stubbed/fabricated functions: `ask_paper_ai` (H-1), `intelligence_service.literature_matrix` (H-2), `graph_service.discover_related_work` (H-3), `eval_service.evaluate_system_baseline` (H-4), `_translate_text` prefix hack (M-19), `zotero sync last_synced_version` (M-11), `clear_runtime_cache` no-op (`provider_settings.py:187-189`).
- Swallowed exceptions: collaboration loop (`except Exception: pass` ×4+), contexts' console.warn pattern, papers RAG-indexing failure (M-21).
- Background jobs/queues/workers: none exist (upload processing is synchronous in-request; blocking 20s LLM calls pin threadpool workers).

---

## External Services Audit

| Service | Purpose | Status | Evidence |
|---|---|---|---|
| Crossref api.crossref.org | DOI resolution | ✅ Real | `identifier_resolver.py:79-80` |
| arXiv export.arxiv.org | arXiv lookup | ✅ Real | `identifier_resolver.py:176-177` |
| PubMed E-utilities | PMID lookup | ✅ Real | `identifier_resolver.py` pmid branch |
| Zotero api.zotero.org | Library import/sync | ✅ Real | `zotero_service.py:159-171` (API-key per request; 50-item cap M-11) |
| GROBID :8070 | PDF TEI extraction | ✅ Real w/ pdfplumber fallback | `pdf_extractor.py`; compose service `grobid` |
| Ollama :11434 | Local LLM | ✅ Real, availability-probed | `llm_service.py:33-85` |
| OpenAI-compatible / Anthropic | Cloud LLM | ✅ Real code; **credentials exposure C-3** | `llm_service.py:103-173` |
| Redis | Cache + collab pub/sub | ✅ Real, optional-graceful | `provider_cache_service.py`; `collaboration.py` pub/sub |
| OpenAlex / Semantic Scholar adapters (TS pkg) | Research providers | ❌ Stubs returning empty | `packages/research/src/providers/openalex.ts:10-29` (backend does not use this package) |
| Email provider | — | ❌ None exists | — |
| Payment providers | — | ❌ None (n/a) | — |

---

## Environment & Configuration Audit

- `.env` files are **gitignored** (verified `git ls-files` shows no env/db/log files). ✅ No committed secrets found.
- Both root `.env` and `apps/api/.env` currently ship the **default development SECRET_KEY** (verified byte-equality with `DEFAULT_DEV_SECRET_KEY`). Acceptable for dev; the production validator blocks it (`config.py:75-95`) — but note the validator only fires if `ENVIRONMENT=production` is set correctly.
- `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000/api/v1` (`client.ts:1`) — must be overridden per environment.
- CORS defaults to localhost:3000 only; `allow_credentials=True` (`main.py:68-74`) — tighten per deploy.
- Docs/OpenAPI disabled only when `ENVIRONMENT=production` (`main.py:57-59`) — several behaviors (secret validation, rate-limit-test-bypass) key off this var; mis-set ENVIRONMENT silently weakens posture.
- Selfhost compose requires `SECRET_KEY` and `REDIS_PASSWORD` (`:?` interpolation) and binds infra ports to 127.0.0.1 — good. However it sets `ENVIRONMENT=production` **while C-1 remains**, i.e., the deployed API would still be wide open.
- Placeholder values in `.env.example`: `POSTGRES_PASSWORD=openresearch_secure_password` (documented example, acceptable; still used as compose default fallback at `docker-compose.selfhost.yml:30,49` — should be required like REDIS_PASSWORD).

---

## Security Findings (consolidated)

🔴 C-1 auth bypass · 🔴 C-3 global credential control/plaintext key file/arbitrary base-url exfil · 🟠 H-5 WS bypass+broadcast amplification
🟡 XFF-spoofable rate limits (M-8) · absolute path disclosure (M-9) · debug chunk dump (M-15) · cache-clear without gate (M-16) · BibTeX injection (M-12) · log-forgery via X-Request-ID (M-20) · email enumeration (M-17) · extension token plaintext in `chrome.storage.local` (L-3)
✅ Good practices observed: bcrypt, JWT type separation, upload magic-byte sniffing + size caps + filename sanitization, optimistic locking, masked key responses, production config validator, docs disabled in prod, parameterized ORM queries throughout (no SQL injection found).

---

## Dead Code & Deprecated Implementations

Safe to remove (verified unreferenced):
- `apps/web/src/components/Placeholder.tsx` (`PlaceholderShell`)
- `lib/api/evaluation.ts`, `lib/api/rag.ts` (`search`, `listChunks`), `lib/api/papers.ts` (`getPdfUrl`, `status`, `index`), `lib/api/aiWriting.ts` (`streamAutocomplete`), `lib/api/citations.ts` (`rankContext`)
- `packages/browser-extension/content.js` (handler never invoked), `background.js` (log-only stub)
- `PaperReviewView` `onApplyFix` prop + unused imports; `PdfReader` `'aiThreads'` tab type; `AppShell` `unsupportedClaimsCount` setter (dead state)
- `packages/research` OpenAlex/Semantic Scholar stub providers (unused by backend; decide: implement or cut)
- `provider_settings.clear_runtime_cache` explicit no-op

Latent-but-shipped demo machinery: entire `isOfflineMode` branches in Project/Paper/Document contexts (activate if flag flips).

---

## Feature-by-Feature Verification

Legend: ✅ Real · ⚠️ Partial · ❌ Mocked/Fake/Missing

| Feature | Frontend | API | Backend | Database/Service | Status |
|---|---|---|---|---|---|
| User registration/login/logout | ❌ | ✅ | ✅ | ✅ users table | ❌ (UI missing; auth bypassed) |
| Session across refresh | ❌ | — | — | — | ❌ |
| Projects CRUD | ✅ | ✅ | ✅ | ✅ PostgreSQL/SQLite | ⚠️ (seed data) |
| Documents + autosave | ✅ | ✅ | ✅ | ✅ | ⚠️ (sample seed) |
| Rich-text editing | ✅ | local | — | via documents | ✅ |
| PDF upload & extraction | ✅ | ✅ | ✅ GROBID/pdfplumber | ✅ files+DB | ✅ |
| RAG chat | ✅ | ✅ | ✅ | ⚠️ hash embeddings | ⚠️ |
| Selection Ask-AI | ✅ | ✅ | ❌ templates | — | ❌ |
| Ghost text / continuation / edit | ✅ | ✅ | ⚠️ fallback boilerplate | LLM ext. | ⚠️ |
| Citations & bibliography | ✅ | ✅ | ✅ | ✅ | ✅ |
| Identifier resolution (DOI/arXiv/PMID) | ✅ | ✅ | ✅ | Crossref/arXiv/PubMed | ✅ |
| BibTeX import/export | ✅ | ✅ | ⚠️ escaping | ✅ | ⚠️ |
| Zotero import/sync | ✅ | ✅ | ⚠️ 50-cap, fake version | Zotero API | ⚠️ |
| Annotations & notes | ✅ | ✅ | ✅ | ✅ | ✅ |
| Exports MD/DOCX/PDF/BibTeX | ✅ | ✅ | ✅ | ✅ | ✅ |
| Claim verification | ✅ | ✅ | ⚠️ heuristic | — | ⚠️ (badge fake) |
| Literature matrix | ✅ | ✅ | ❌ fabricated | — | ❌ |
| Research gaps | ✅ | ✅ | ⚠️ heuristic | ✅ chunks | ⚠️ |
| Paper review scoring | ✅ | ✅ | ⚠️ floored heuristics | — | ⚠️ |
| Research graph | ✅ | ✅ | ✅ | ✅ | ✅ |
| Related-work discovery | ✅ | ✅ | ❌ invented papers | — | ❌ |
| Global search | ✅ | ❌ client-only | — | — | ⚠️ |
| Real-time collaboration | ✅ socket client? (see note) | ✅ WS | ⚠️ broadcast-only | ❌ no persistence | ❌ |
| Comments/discussion | ✅ | ✅ | ✅ | ✅ | ✅ |
| Version history/diff/restore | ✅ | ✅ | ⚠️ race | ✅ | ⚠️ |
| Teams & RBAC | ✅ | ✅ | ✅ | ✅ | ❌ (unusable w/o auth) |
| Plugin registry | ✅ | ✅ | ✅ metadata | ✅ | ⚠️ |
| Provider key management | ✅ | ✅ | ⚠️ plaintext/global-write | JSON file | ⚠️/🔴 |
| Evaluation benchmark | ❌ | ✅ | ❌ simulated | — | ❌ |
| Browser extension capture | ✅ | ✅ direct fetch | ✅ | ✅ | ⚠️ (token plaintext, picks projects[0]) |

Note (collaboration frontend): the web app renders a static collaborator avatar; no production WebSocket client wiring was found in `apps/web/src` beyond the fake avatar — the WS endpoint currently has no shipped consumer.

---

## Evidence Index (primary sources)

- `apps/api/app/services/auth.py:86,89,108-129` — local-admin fallback, `is_admin=True`, swallowed invalid tokens
- `apps/web/src/context/AuthContext.tsx:12-36` — hardcoded LOCAL_USER/isAuthenticated
- `apps/web/src/lib/api/client.ts:59-79` + `client.test.ts:71` — no Authorization header ever
- `apps/api/app/api/v1/endpoints/provider_settings.py:39-62` + `services/provider_settings.py:46-76` + `llm_service.py:110-128` — global key writes, plaintext store, bearer-to-arbitrary-URL
- `apps/api/app/api/v1/endpoints/papers.py:494-501` — canned Ask-AI
- `apps/api/app/services/intelligence_service.py:370-385` — fabricated matrix cells
- `apps/api/app/services/graph_service.py:216-253` — invented DOIs `10.1145/3618257.3624801`, `2402.18902`
- `apps/api/app/services/eval_service.py:282-306,400-414` — simulated benchmark, constant 94.5
- `apps/api/app/api/v1/endpoints/collaboration.py:166-176,273-284` — empty-token join; broadcast-only edits
- `apps/web/src/context/DocumentContext.tsx:44-99,200-205` — sample document persisted server-side
- `apps/web/src/context/PaperContext.tsx:165-250,307-361,524-537` — demo paper, timer-simulated pipeline, canned offline AI
- `apps/web/src/components/intelligence/ResearchGraphView.tsx:504` — alert() fake add
- `apps/web/src/components/shell/AppShell.tsx:91,411-413,556-564,595-605,902` — dead claims counter, discarded query, fake collaborator, storage copy
- `apps/api/app/core/rate_limit.py:18-45`, `middleware.py:25-26`, `health.py:45-52` — limiter/XFF, log echo, env leak
- `infrastructure/docker-compose.selfhost.yml:19-41` — production compose (still exposed under C-1)

Secrets policy note: no actual secret values appear in this report. Local `.env` files were compared programmatically and redacted.

---

## Recommended Fixes

1. **Make auth real (C-1/C-2):** fail-closed `get_current_user`; explicit opt-in `LOCAL_MODE` for dev only; build login/register/refresh UI; attach tokens; secure refresh-token storage; token rotation + revocation list.
2. **Lock down provider settings (C-3):** admin-only mutations, encrypted/managed secrets, allow-list custom base URLs.
3. **Replace fabricated outputs (H-1..H-4):** route Ask-AI/Literature-Matrix/Discovery/Evaluation through the existing `llm_service` + real retrieval, or label them honestly in-product and disable by default; delete the eval simulation or move it to tests.
4. **Persist collaborative edits** (server-side merge into `content_json`) before advertising realtime; add WS message bounds and reject empty tokens.
5. **Remove demo seeds** from the server path (sample document, auto-created project name); gate the offline branches behind a build-time flag or delete.
6. **Fix fake-success UX:** real add-to-library call, honest progress polling via `papersApi.status`, wire the claims badge, stop discarding the Find-Sources query, correct the "stored locally" copy, implement or remove documented shortcuts.
7. **Hardening pass:** rate-limit writes/AI routes with proxy-safe IP handling; strip `pdf_path` from responses; escape BibTeX export; bound BibTeX import; require confirmation before cascading team deletes; unique constraint on version numbers; validate team roles; protect last owner.
8. **Embeddings:** adopt a real embedding model + pgvector (schema already intends this) or document hash-embedding limitations prominently.

## Priority Roadmap

### P0 — Fix Immediately
- C-1 authentication bypass (fail-closed + local-mode flag)
- C-3 provider-settings authorization & key storage
- H-5 WebSocket empty-token join
- M-16 unauthenticated cache clear; M-15 debug chunk endpoint

### P1 — Fix Before Production
- C-2 full auth UX (register/login/logout/session)
- H-1/H-2/H-3/H-4 replace or honestly disable fabricated AI features
- H-7/H-8 remove demo seeds & offline fabrication from bundles
- M-8 proxy-safe rate limiting on all mutating/AI routes
- M-9/M-12/M-13 path disclosure, BibTeX escaping/validation, unresolved-row spam
- H-6 teams lifecycle fixes (roles validation, last-owner protection)

### P2 — Improve Before Release
- M-1..M-7 fake-success UI patterns & misleading copy
- M-10 localStorage divergence strategy (sync/conflict UX)
- M-14 real embeddings/pgvector; M-11 Zotero pagination + real sync versions
- M-17..M-22 backend robustness items
- Collaboration edit persistence (if feature kept)

### P3 — Cleanup
- Delete dead code (L-1..L-3 list) and unused TS API methods
- Rename `mockRef`; remove phase badges from UI; fix `citationCount` bug; add missing animation classes
- Reconcile `docs/architecture.md` with actual behavior (JWT enforcement, pgvector, collaboration)

---

## Final Verdict

**Not production-ready for real multi-user deployment.** The engineering core (persistence, extraction, citations, export, RAG chat, external scholarly integrations) is real and competently built — but the security model is currently a mock: every visitor shares one implicit admin account, the login system is orphaned from its own frontend, and four advertised intelligence features return fabricated content. Deployed as-is for real users, the app would *function* as a single-tenant tool whose entire dataset — including uploaded PDFs and any saved LLM API keys — is readable, writable, and deletable by anyone who can reach the API, while several panels confidently display invented academic facts.

With P0+P1 remediation (real auth, locked-down secrets, honest AI labeling or real implementations, removal of seeded demo data), this could realistically reach genuine production quality; the underlying architecture is sound enough to support it.
