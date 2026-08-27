# OpenResearch — Two-Axis Code Review (Standards + Spec Conformance)

> Audit ID: 11 · Date: 2026-08-26 · Read-only audit, independent of CODEBASE_AUDIT.md
> Repo: `C:\Users\moham\Pictures\OpenResearch` (git repo, branch `master`, **zero commits**)

---

## Scope & Methodology

This audit applies the **two-axis code-review skill** as a whole-repo audit rather than a diff review:

- **Axis A — Standards:** every documented engineering standard was extracted from the repo's own sources and checked against the code:
  - Root `CONTRIBUTING.md` (quality gates, TS/Python style rules, testing guidance)
  - `docs/CONTRIBUTING.md` (licensing, architecture principles incl. design-token discipline, i18n hygiene, WCAG, polymorphic ownership)
  - `apps/web/AGENTS.md` / `apps/web/CLAUDE.md` (auto-generated Next.js agent rules only)
  - `.editorconfig`, `.pre-commit-config.yaml`, `.github/workflows/ci.yml`
  - Fowler smell baseline (judgement-call findings, suppressed where a repo standard endorses the pattern)
- **Axis B — Spec:** every section of `docs/OpenResearch_Spec.md` (§1–§49) plus `docs/architecture.md` was mapped to concrete routes/components/services (`apps/api/app/api/v1/endpoints/*`, `apps/api/app/services/*`, `apps/web/src/**`, `packages/*/src/**`) and classified IMPLEMENTED / PARTIAL / MISSING / DIVERGED with file:line evidence.
- **Git context:** `git log --oneline -30` returns *"your current branch 'master' does not have any commits yet"* — the entire codebase is uncommitted; CI gates have never actually run against this tree.
- Ignored per instructions: node_modules, .venv, .next, __pycache__, coverage, caches, storage, logs.
- Prior audit (`CODEBASE_AUDIT.md`) consulted only to note fixed/regressing items; all findings below were independently re-verified in current code.

---

## Executive Summary

The codebase is substantially real: Owner/Membership polymorphic ownership, role-based authorization on nearly every endpoint, GROBID+pdfplumber extraction with honest `unverified` marking, hybrid retrieval with chunk provenance, four chat modes with a trust legend, six citation styles, four export formats, teams/graphs/plugins/versions/comments/collaboration endpoints, AGPL licensing, and policy docs (VPAT, retention, copyright) all exist and are wired end-to-end.

Three themes dominate the risk picture:

1. **Local-mode auth bypass is load-bearing everywhere (CRITICAL).** `get_current_user` silently auto-provisions an *admin* local user for any unauthenticated request (`app/services/auth.py:108-129`). Every "protected" endpoint — including LLM API-key storage and admin-gated plugin registration (arbitrary module import → RCE) — is callable without credentials by anyone who can reach the API. This contradicts Spec §34 whenever the API binds beyond loopback.
2. **Several "AI" features are templates wearing AI clothing (HIGH, Spec divergence).** The AI Outline Generator never calls an LLM (`ai_writing_service.py:353-431`); the Research Gap Assistant fabricates canned gaps and pads evidence counts (`intelligence_service.py:262-332`); the paper status stepper always reports "ready" (`papers.py:283-290`); PDF processing runs synchronously inside the upload request despite §41's async-pipeline requirement; embeddings are hash-toy vectors, not semantic embeddings (`rag_service.py:30-96`).
3. **Documented standards are not what CI enforces (HIGH).** CONTRIBUTING claims CI enforces a frontend 70% coverage gate via `npm run test:coverage`; CI runs plain `npm test` (no coverage) — the gate does not exist. Three different coverage numbers coexist (docs 70%/90%, vitest thresholds 100% on a narrow include list, pytest `--cov-fail-under=94`). Legacy `typing.List/Dict/Optional` is pervasive despite an explicit ban; hard-coded hex values and residual hard-coded UI strings violate token/i18n discipline.

Counts: **Part A (Standards): 14 findings** (1 CRITICAL-tier security standard breach, 1 HIGH, 6 MEDIUM, 6 LOW/INFO). **Part B (Spec): 49 sections mapped** — see per-section table.
Worst issue per axis — Standards: documented CI coverage gate not enforced (A-1). Spec: unauthenticated admin-level access undermines §34's entire security section (A-2/B-34).

---

## Part A: Standards Review

Each item: documented standard → where it is violated (file:line).

### A-1 [HIGH] CI does not enforce the documented coverage gates
- **Standard:** root `CONTRIBUTING.md:53-64` — "All pull requests must pass CI… `npm run test:coverage` # Vitest with 70% coverage threshold gate" and "`pytest --cov=app` # Test suite with 90% coverage target"; line 66 "frontend packages must maintain >= 70%… backend targets >= 90%".
- **Reality:** `.github/workflows/ci.yml:31-32` runs plain `npm test` (no `--coverage`), so the Vitest thresholds in `vitest.config.ts:23-28` are never evaluated in CI. The frontend 70% gate exists nowhere.
- **Config/docs three-way mismatch:** `vitest.config.ts:24-28` sets lines/functions/branches/statements thresholds to **100** (not 70) but only over a narrow include list (`vitest.config.ts:29-40`: citations/research/ai/plugins/ui src + editor extensions — `apps/web/src` components excluded entirely); `apps/api/pyproject.toml:65` sets `--cov-fail-under=94` (not the documented 90) — this one *does* take effect in CI because pytest reads `[tool.pytest.ini_options]`.
- **Impact:** the coverage promise is unenforced everywhere except backend pytest; UI code (PdfReader.tsx ~783 lines, WorkspaceContext.tsx ~647 lines, AiResearchChat.tsx ~599 lines) has no coverage gate at all.
- **Also divergent:** `ci.yml:64-67` (mypy), `ci.yml:34-35` (npm audit), `ci.yml:74-78` (pip-audit), `ci.yml:80-104` (docker builds) are real gates CONTRIBUTING never mentions — docs lag config in both directions.

### A-2 [CRITICAL — security standard] Local-mode auth fallback makes every endpoint effectively unauthenticated, including admin operations
- **Standard:** Spec §34 "Secure authentication", "Per-user authorization", "Never expose another user's documents". `docs/architecture.md:102` documents local-mode auth as a decision, but the implementation exceeds any reasonable reading of that trade-off.
- **Evidence chain:**
  - `app/services/auth.py:108-129` — `get_current_user` decodes a bearer token if present; **otherwise calls `get_or_create_local_user(db)`**, which creates and returns an `is_admin=True` user (`auth.py:84-90`) for *any* anonymous request.
  - `app/api/v1/endpoints/provider_settings.py:66-69,93,102,117-119,152` — storing/replacing cloud LLM API keys, changing global rate limits, deleting providers, running Tabby setup require only `get_current_user` → anonymous callers can overwrite provider credentials.
  - `app/api/v1/endpoints/plugins.py:69-70,82-85,98-101` — plugin registration/toggle/config gated by `get_current_admin_user`; but since the anonymous fallback user *is* admin (`auth.py:89`), anyone can register a plugin whose entrypoint is imported via `importlib.import_module` (`plugin_runtime.py:51-58`) → arbitrary code execution in the server process for any network-reachable caller.
  - `app/core/config.py:20` defaults `ENVIRONMENT=development`, so the production validator (`config.py:90-110`, checking only SECRET_KEY/DATABASE_URL) never engages by default.
- **Assessment:** prior audit flagged this (its C-1/C-3); current code still exhibits it. The architecture doc sentence "auth optional in local mode" does not cover anonymous *admin* privileges or arbitrary-import plugin registration.

### A-3 [MEDIUM] Legacy typing imports banned by CONTRIBUTING are pervasive in apps/api
- **Standard:** `CONTRIBUTING.md:84` — "modern typing (`list[str]`, `X | None`), no legacy `typing.List`".
- **Violations (60+ occurrences, representative):**
  - `app/core/config.py:2` (`from typing import List, Union`), used :36,:43,:55
  - `app/models/chunk.py:5,30`; `app/models/owner.py:5,37-41`; `app/models/project.py:5,38-42`; `app/models/paper.py:5,22-27`
  - `app/schemas/models.py:3` plus ~40 usages (:144,:159,:174,:210,:241,:292,:311-320,:343,:351,:367,:385,:414,:432,:451,:457,:493,:512-530,:573,:619-666)
  - `app/services/auth.py:2`; `rag_service.py:8`; `pdf_extractor.py:6`; `llm_service.py:22`; `intelligence_service.py:5`; `graph_service.py:4`; `provider_settings.py:13`; `endpoints/papers.py:4`; `endpoints/collaboration.py:7`
- **Note:** SQLAlchemy models correctly use 2.0 `Mapped[]`/`mapped_column` (standard `CONTRIBUTING.md:88` followed — e.g., `models/owner.py:27-41`); only the generics are legacy.

### A-4 [MEDIUM] "Zero any" rule violated in the API client layer and components
- **Standard:** `CONTRIBUTING.md:76` — "Strict typing only. Zero `any` in API client layers; prefer discriminated unions over loose object shapes."
- **Hard violation (client layer):** `apps/web/src/lib/api/graphs.ts:14` — `metadata?: Record<string, any>`.
- **Loose-shape violations (judgement calls under the same bullet):**
  - `apps/web/src/components/shell/LeftNavigation.tsx:28-30` — `documents: any[]`, `activeDocument: any`, `setActiveDocument: (doc: any)`
  - `apps/web/src/components/shell/TopBar.tsx:32-34` — `projects: any[]`, `activeProject: any`, `setActiveProject: (proj: any)`
  - `apps/web/src/components/intelligence/PaperReviewView.tsx:221,262,278` — `as any` casts
  - `apps/web/src/i18n/index.ts:17` — `let current: any`
  - `packages/citations/src/styles.ts:504,522,536` — `(item: any)` etc.
  - `packages/editor/src/components/AcademicEditor.tsx:500` — `(action: any)`
  - Test-file `as any` casts (`extensions.test.ts` ×13) noted but not counted.

### A-5 [MEDIUM] Hard-coded hex colors violate design-token discipline
- **Standard:** `CONTRIBUTING.md:79` — colors come from `@openresearch/tokens`, "never hard-code hex values"; `docs/CONTRIBUTING.md:40` principle 2.
- **Violations:** `apps/web/src/components/intelligence/ResearchGraphView.tsx:280` (`#8A8985`), `:300` (`#2C5F4A`/`#E4E2DE`), `:315` (`#2C5F4A`), `:316` (`#3B82F6`), `:317` (`#D97706`), `:330` (`#FFFFFF`,`#E4E2DE`).
- **Acceptable exception:** `apps/web/src/app/icon.svg:4-10` (brand asset).
- All other sampled styling uses token classes (`bg-canvas text-text-primary` in `WorkspaceLayout.tsx`) — violation localized to the graph view.

### A-6 [MEDIUM] Residual hard-coded UI strings violate i18n hygiene
- **Standard:** `docs/CONTRIBUTING.md:41` — "Externalize all UI strings in `apps/web/src/i18n/strings.json` from day one (§49)"; Spec §49 "no hard-coded strings in components".
- **Infrastructure is real:** `strings.json` (~633 lines), broad `t()` usage (e.g., `ExportModal.tsx:121-136`, chat mode toasts `AiResearchChat.tsx:114-115`).
- **Violations found:** `AiResearchChat.tsx:343` ("No papers in project yet. Upload a PDF first."), `:390` ("Grounded across all … research papers…"), `DocumentsView.tsx:146` ('Claims verified'), `SettingsView.tsx:414` ("Cloud rate limit"), `SettingsView.tsx:533` ("Toggle between Light and Dark palette").

### A-7 [LOW] File/function length guidance exceeded
- **Standard:** `CONTRIBUTING.md:89` — files ≲500 lines, functions ≲50 lines.
- Files: `rag_service.py` (900), `pdf_extractor.py` (742), `intelligence_service.py` (681), `llm_service.py` (593), `endpoints/papers.py` (583); frontend: `PdfReader.tsx` (~783), `WorkspaceContext.tsx` (~647), `AiResearchChat.tsx` (~599), `EditorToolbar.tsx` (~594), `SettingsView.tsx` (~552), `AcademicEditor.tsx` (548).
- Functions: `ask_paper_ai` (`papers.py:471-583`, ~112 lines); `generate_ai_outline` (`ai_writing_service.py:325-444`); `review_paper` (`intelligence_service.py:503-678`, ~175 lines).

### A-8 [LOW] Cross-module private-method call (encapsulation smell)
- `papers.py:549` calls `rag_service._llm_grounded_answer(...)` — underscore-private service method reached from the endpoint layer. Judgement call; fix with a public wrapper or move ask-AI orchestration into the service.

### A-9 [LOW] Triple source of truth for Python dependencies
- `pyproject.toml:7-24` (dependencies), `requirements.txt` (dev-facing per `CONTRIBUTING.md:33`), `requirements.lock` (CI-only, `ci.yml:51-57`). Nothing verifies lock↔pyproject consistency; drift silently diverges CI from local dev.

### A-10 [INFO] Pre-commit narrower than documented claims
- `CONTRIBUTING.md:68` says hooks run "ruff and formatting checks on staged files" — true only for `^apps/api/` (`.pre-commit-config.yaml:17-24`). No ESLint/typecheck pre-commit stage for TS; no commit has ever existed to exercise any hook.

### A-11 [INFO] `.ruff_cache/` missing from `.gitignore`
- `.gitignore` covers `.pytest_cache/`, `coverage/`, `*.log`, `storage/`, `*.tsbuildinfo`, but not `.ruff_cache/` (present at repo root). First `git add .` would ingest it.

### A-12 [INFO] Runtime artifacts confirm gitignore coverage, with one stray file
- `openresearch_dev.db(-shm/-wal)`, `api.log`, `.coverage`, hundreds of `storage/uploads/<uuid>/` dirs, `web.log` — all matched by `.gitignore`. Root file `Starting` (stray launcher transcript fragment) matches nothing and would be committed.

### A-13 [INFO] Editorconfig compliance verified on sample
- LF/utf-8/final-newline hold across sampled core files (README, CONTRIBUTING, `main.py`, package.json). Compliant.

### A-14 [POSITIVE COMPLIANCE] Standards that ARE followed (verified)
- Radix+CVA mandate (`CONTRIBUTING.md:78`): modals compose `Dialog*` from `@openresearch/ui` (`ExportModal.tsx:19-24,154-169`); `packages/ui/package.json:13-19` wraps Radix.
- Mandated error helper exists and is used: `lib/errors.ts:5` `getErrorMessage(error: unknown …)`; typed `ApiError` (`client.ts:3-12,71`).
- Backend tests follow documented naming/layout (`tests/test_phase7_export.py`, `test_phase9_teams.py`, …); blocking work pushed off the event loop via `anyio.to_thread.run_sync` (`papers.py:86,190`; `pdf_extractor.py:134`; `ai_writing_service.py:172-174`), honoring `CONTRIBUTING.md:86`.
- WS hardening: bounded frames (512 KB), message-rate window, 10 s first-frame auth timeout (`collaboration.py:17-20,171-187`).
- Correlation-ID middleware sanitizes client IDs against log injection (`middleware.py:18,30`).

---

## Part B: Spec Conformance Review

Status legend: ✅ IMPLEMENTED · 🟡 PARTIAL · ❌ MISSING · ⚠️ DIVERGED

| Spec § | Feature | Status | Evidence & notes |
|---|---|---|---|
| 1–5 | Overview/workflow | ✅ | Full loop upload→read→ask→write→cite→review→export exists across routers in `app/api/v1/api.py:27-46`. |
| 6 | Five app areas | ✅ | Workspace routes `(workspace)/library\|documents\|citations\|chat\|intelligence\|settings` + shell `WorkspaceLayout.tsx`. |
| 7 | Projects contain docs/papers/citations/conversations | 🟡 | Project CRUD (`endpoints/projects.py`); cascades `models/project.py:38-42`. **AI conversations are stateless** — client passes `conversation_history` (`endpoints/chat.py` uses it at :64,:106); no server-side conversation storage, so projects don't durably contain chat history. |
| 8 | Editor node types | ✅ | TipTap via `packages/editor`; extensions citation/math/ghostText/trustMarker/claimVerification (`editor/src/extensions/*`). |
| 9 | Autocomplete strategy | 🟡/⚠️ | Two tiers ✅ (`ai_writing_service.py:94`), 700 ms debounce ✅ (`AcademicEditor.tsx:307-331`, within §9's 600–800 ms), provider-aware fast-tier gating ✅ (`AcademicEditor.tsx:308`), configurable RPM cap ✅ (`provider_settings.py:72-107`). Divergences: cap is per-minute not per-session/hour; ghost tier raises HTTP 503 when no fast provider (`ai_writing_service.py:129-137`) instead of silently disabling the tier; default ghost path falls back to cloud/Ollama chain with an 8 s timeout — incompatible with <300 ms unless Tabby is opted in (off by default, `config.py:79-85`). |
| 10 | Source-grounded answers w/ clickable sources | ✅ | `GroundedPassage(paper_id,page_number,section,paragraph,chunk_id)` (`rag_service.py:455-469`); SourcePanel opens locations; exact §33 Rule-3 refusal string (`rag_service.py:567`). |
| 11 | PDF library extraction | ✅ | GROBID default + pdfplumber fallback (`pdf_extractor.py:118-141`); tables/equations separate structured path (`rag_service.py:228-291`); confidence + `unverified` status on total failure (`papers.py:139-161`); retrieval penalty for unverified chunks (`rag_service.py:411-415`). |
| 11a | Page anchors / extraction honesty | 🟡 | Tables/equations carry pages; **GROBID body sections hard-coded `page_number=1`** (`pdf_extractor.py:237`) — TEI coordinates unused, degrading page-level traceability on the primary path. |
| 12 | PDF reader features | ✅ | Nav/search/selection/highlights/notes (`PdfReader.tsx:39-99`; annotation CRUD `papers.py:346-465`) + selection/page/paper Ask-AI (`papers.py:471-583`). |
| 13 | Chat modes document/library/project/general | ✅ | Four modes enforced server-side (`rag_service.py:365-370,519-550`); general explicitly marked "not grounded in your library papers" (`rag_service.py:533-537`); UI switcher with toasts (`AiResearchChat.tsx:37,110-115`). |
| 14 | `@` citation search | ✅ | Trigger + popover query tracking (`AcademicEditor.tsx:240-301`); insertion replaces `@query` with CitationNode (`:342-394`). |
| 15 | Six v1 styles | ✅ | APA/Harvard/MLA/Chicago/IEEE/Vancouver (+notes) in `packages/citations/src/styles.ts:29-88,146-302`; backend mirror `export/csl_formatter.py:22-33`. |
| 16 | Auto bibliography add/remove | ✅ | Removed citations detected via node diffing → `onCitationDeleted` (`AcademicEditor.tsx:270-283`); style changes propagate to existing nodes (`:396-399`). |
| 17 | DOI/arXiv/PMID lookup + preview | ✅ | `services/identifier_resolver.py`, `/citations/resolve-identifier`, `AddByIdentifierModal.tsx`. |
| 18 | BibTeX import/export | ✅ | `citations/src/bibtex.ts` (+366-line test file); export `export/bibtex_exporter.py` + project/document routes; `BibtexModal.tsx`. |
| 19 | Provider abstraction + cache + quota surfacing | ✅ | OpenAlex/Crossref/arXiv/Semantic Scholar providers (`research/src/providers/*`), LRU+optional Redis cache (`provider_cache_service.py`), `/system/provider-status` + cache-clear endpoint; abstraction swappable per §19. |
| 20 | Literature matrix w/ cell refs | ✅ | Real chunk scan per dimension with per-cell paper/page/section excerpt and honest `"Not stated in extracted text"` fallback (`intelligence_service.py:362-498`). |
| 21 | Gap assistant v1 scope | ⚠️ | Confidence correctly deferred everywhere (`intelligence_service.py:71,188,345,355` `confidence_scoring_status="deferred"`); limitations/future-work extraction implemented (:194-260). **Divergence:** `_synthesize_potential_gaps` returns three hard-coded ML-domain gap templates regardless of corpus, fabricates `unsupported_claims` strings, and **pads evidence counts** with `max(count+1, 2)` (:270-331) — presents evidence that may not exist, violating §21's raw-evidence contract and §47.1/.6. Also all limitation excerpts hard-coded to page 1 (:241,:254). |
| 22 | AI editing, original preserved | 🟡 | Original returned untouched + accept/reject flow (`ai_writing_service.py:212-221`); rule-based fallbacks honestly labeled `[Rule-based]` (:232-255). **Bug:** `explain` is declared (endpoint docstring ai_writing.py:96; llm_only set :225) but absent from `EDIT_ACTION_INSTRUCTIONS` (:50-59) → can never reach the LLM and always 503s even with a provider configured. |
| 23 | AI outline generator | ⚠️ | **Never calls an LLM.** Static 7-section template interpolating the topic string (`ai_writing_service.py:353-431`); "regenerate" yields identical output; grounded_sources are just abstracts attached as decoration (:334-351). Misrepresented as AI vs §23. |
| 24 | Review engine 5 dimensions | 🟡 | Structure/citations/writing/argumentation/sources present (`intelligence_service.py:503-678`) but heuristic-only (keyword section check :520-546, >35-word sentence :567-584, unhedged absolutes :586-604, citation density :606-623). §24's citation-mismatch & outdated-source checks absent. Category scores are formulaic floors (:626-669). |
| 25 | Claim verification v1 | ✅ | Mechanical zero-citation flag with char offsets, dismissals, suggested query; strength scoring deferred exactly per scope (`intelligence_service.py:50-189`). Quality note: citation regex hard-codes four author surnames as markers (`:117`). |
| 26 | Source traceability chain | ✅/🟡 | Claim→segment→source→paper→page→passage delivered via GroundedSegment/GroundedPassage/TrustLegend (`schemas/models.py:292,319-320,451-457`); degraded by GROBID page=1 (§11a). |
| 26a | Clause-level attribution | 🟡 | `attribution_scope` modeled end-to-end (schema :292; citation nodes `attributionScope` always `'sentence'` — `AcademicEditor.tsx:365,382`). Clause splitting exists only in the deterministic fallback (`rag_service.py:833-871`); **the LLM path collapses all retrieved sources into one sentence-scope segment** with `source_indices=[1..n]` (`rag_service.py:808-814`), so the primary path implements neither clause attribution nor decline-to-synthesize. |
| 27 | Export formats v1 | ✅ | docx/pdf/markdown/bibtex exporters (`export/*_exporter.py`); UI offers exactly the four (`ExportModal.tsx:46,120-140`). V2 tex/html correctly absent. |
| 28 | LLMProvider abstraction | ✅ | OpenAI-compatible + custom base URL, Anthropic, Ollama, Tabby local (`provider_settings.py:17-54`; `llm_service.py:214-304`); TS mirror `packages/ai/src/providers/*`; honest None-on-failure semantics (`llm_service.py:12-14`). |
| 29/30 | Stack: pgvector, background jobs | ⚠️ | **No pgvector**: embeddings are JSON columns of hash vectors; architecture doc admits "pgvector-ready schema, migration pending" (`architecture.md:41,101`); postgres extra unused (`pyproject.toml:26-30`). **No Celery/queue**: Redis used only for collab pub/sub + optional provider cache. |
| 31 | Owner/Membership data model | ✅ | `Owner(owner_type)` (`owner.py:18-41`); reserved-but-active `Membership` w/ unique constraint (`membership.py:17-34`); uniform authz helper `verify_user_access_to_owner` (`auth.py:164-177`) applied across endpoints (e.g., `teams.py:127,161,203,238,276`). Minor textual deviation: `owner_type` lives on Owner, not Project — functionally equivalent. |
| 32 | RAG pipeline + chunk metadata | 🟡 | Pipeline shape and required metadata present (`rag_service.py:293-330`; hybrid search :332-470). **Embeddings are a 128-dim BLAKE2b feature-hash construction** (`rag_service.py:30-96`), not an embedding model — semantic similarity ≈ lexical overlap; the §46 core differentiator rests on placeholder math (disclosed in `architecture.md:101`). |
| 33 | Hallucination rules 1–5 | ✅ | Prompt-constrained no-invented-citations (`rag_service.py:481-486`); exact insufficient-evidence string; trust legend distinguishing source/inference/general; evidence inspection via SourcePanel + passages in every response. |
| 34 | Security requirements | 🟡 | Login/register rate limits (`rate_limit.py`; `config.py:30-33`); upload size/header validation + filename sanitization (`papers.py:88-137`; `pdf_extractor.py:104-111`); WS caps. **Fails:** "Encrypt sensitive data at rest" — LLM API keys stored **plaintext** in `storage/provider_keys.json` (`provider_settings.py:110-133`); per-user authorization undermined by A-2; no explicit editor-content sanitizer beyond TipTap JSON rendering. |
| 34a | Retention/deletion/training/disclosure | 🟡 | `DATA_RETENTION_POLICY.md` published; deletion stronger than spec (paper delete removes PDF immediately + cascades chunks/citations/annotations, `papers.py:315-340`; `models/paper.py:47-56`). **Missing:** required in-product payload disclosure ("This message will be sent to [Provider]") — string absent from entire frontend. |
| 34b | Copyright posture | ✅ | `COPYRIGHT_AND_LEGAL_POSTURE.md` + `LEGAL_REVIEW_CHECKLIST.md`; cross-user access blocked by ownership checks on every paper route (`papers.py:204,259,304,…`); no redistribution feature. |
| 35a | AGPL license | ✅ | `LICENSE` = AGPL-3.0 (verified header); `package.json` `"license": "AGPL-3.0-or-later"`; in place before any commit, as §35a demands. |
| 35b | Local-first funding default | ✅ | Ollama/Tabby keyless defaults (`config.py:71-85`); `SELF_HOSTING.md`; docker-compose infra; zero required hosted services. |
| 36 | MVP contents | ✅ | All MVP bullets verifiable: editor + interval autosave (`AcademicEditor.tsx:36-37,103-105`); upload/reader/library/search; chat/ask/autocomplete/editing; DOI lookup/insertion/APA-IEEE-MLA/bibliography; DOCX/PDF/MD export. |
| 37 | Phase 2 features | ✅ | Lit matrix/gaps/claims/Zotero live sync (`zotero_service.py:164-218`, api.zotero.org)/BibTeX/extra styles/browser extension (`packages/browser-extension/manifest.json`, MV3). Semantic search quality caveat per §32. |
| 38 | Phase 3 features | ✅ (early) | Collaboration WS + Redis fan-out (`collaboration.py` incl. `_persist_doc_edit` :30-53 — prior audit's H-5 persistence issue addressed); comments CRUD; versions list/create/get/restore/diff; teams RBAC; research graphs from real data (`graph_service.py:35-185` — prior audit's fabricated-DOI discovery now live Crossref, `graph_service.py:187-271`); plugin system. Self-host installer = docker-compose only (🟡). Note: Phase-3 built while §32 embeddings remain placeholder — inverted priority vs §45 Risk 5/§47.7. |
| 39 | UI direction | ✅ | Tokens-based palette, serif headings, low-noise shell, keyboard-friendly (`packages/tokens/src/tokens.css`; shell components). |
| 40 | Keyboard shortcuts | 🟡 | Ctrl+S (`AcademicEditor.tsx:457`), Ctrl+/ (:222), @ (:245-249), undo/redo native Tiptap; extras Ctrl+K/E/Shift+C/backslash, `?` help (`WorkspaceLayout.tsx:59-80`). **Ctrl+F Find not bound anywhere** — search lives on Ctrl+K; §40 lists Ctrl+F. |
| 41 | Async processing / responsive UI | ⚠️ | **PDF processing runs synchronously inside the upload request** (`papers.py:134-190` awaits extraction inline); the §41 stepped indicator is faked — `/papers/{id}/status` always returns `step="ready", step_index=4` (`papers.py:283-290`). No queue/worker anywhere. Contradicts "PDF processing should happen asynchronously." |
| 42 | Unit/integration/E2E tests | 🟡 | Strong backend suite (~44 files incl. integration workflows, auth-enforcement, security-hardening); TS unit tests across packages. **E2E missing:** root `tests/` dir documented in `docs/CONTRIBUTING.md:34` does not exist; no Playwright/Cypress config. |
| 43 | AI evaluation methodology | ❌ | No Recall@K/Precision@K/citation-correctness harness, datasets, or scripts. Notable because §21/§25 defer confidence scoring *until* this exists — the gate is not being built. |
| 44 | Success metrics / OSS health | 🟡 | No instrumentation/metrics collection found (acceptable pre-launch), but nothing tracks even the §44 OSS-health items; INFO-level. |
| 45 | Risks/mitigations | 🟡 | Hybrid search implemented (Risk 3 ✅); Risk 1 mitigations prompt-level only; Risk 2 handled honestly via unverified marking. |
| 46 | Final MVP definition | ✅/🟡 | The full loop answers §46's question affirmatively *mechanically*; quality of "understand papers" limited by §32 embeddings. Core differentiator (traceability) genuinely implemented. |
| 47 | Development principles | 🟡 | Most followed; #1/#6 violated by gap-template fabrication (§21 row) and #7/#10 tension from early Phase-3 build-out. |
| 48 | Accessibility WCAG 2.1 AA | 🟡 | `VPAT_CONFORMANCE_STATEMENT.md` exists in docs (required artifact ✅); Radix primitives + focus handling; shortcuts modal; dark/light tokens. Not verified: screen-reader announcement of AI suggestions, contrast measurements, PDF-reader AT behavior. Treat conformance as claimed-not-proven. |
| 49 | i18n scope | 🟡 | Externalization infrastructure shipped day one (`i18n/strings.json` + `t()`), Unicode surrogate sanitization in text pipeline (`text_utils.sanitize_surrogates` used in `intelligence_service.py:63,515`); residual hard-coded strings (A-6); non-English UI correctly deferred. |

---

## Detailed Findings (severity-ranked)

### CRITICAL

**C-1. Unauthenticated requests receive admin privileges; admin-gated plugin registration becomes arbitrary code execution** *(Standards A-2; Spec §34)*
- `app/services/auth.py:108-129` + `auth.py:84-90` (`is_admin=True` fallback user).
- `app/api/v1/endpoints/plugins.py:69-70` (`register_plugin` → admin gate defeated by C-1) with `plugin_runtime.py:51-58` importing attacker-named modules under configurable prefixes.
- `provider_settings.py:66-69,93,102,117-119,152`: anonymous overwrite of LLM credentials/rate limits/Tabby setup.
- Exploitability: any process able to reach the API port (default bind via uvicorn in dev is all interfaces). Local-only posture is undocumented as a hard guarantee and unenforced.

### HIGH

**H-1. Documented CI coverage gates are not enforced; three conflicting coverage policies coexist** *(A-1)*
- `ci.yml:31-32` vs `CONTRIBUTING.md:53-66` vs `vitest.config.ts:24-40` vs `pyproject.toml:65`.

**H-2. AI Outline Generator is a static template presented as AI output** *(Spec §23 DIVERGED)*
- `ai_writing_service.py:325-444`; no LLM call on any code path; regeneration deterministic-identical.

**H-3. Research Gap Assistant fabricates gap content and evidence counts** *(Spec §21/§33/§47 DIVERGED)*
- `intelligence_service.py:262-332` — canned ML-specific gaps for arbitrary corpora; `raw_evidence_count=max(n+1, 2)`; invented `unsupported_claims`; page numbers hard-coded 1 (:241,:254).

**H-4. "Semantic" retrieval is hash-vector pseudo-semantics on the product's core differentiator** *(Spec §10/§30/§32/§46)*
- `rag_service.py:30-96` BLAKE2b feature hashing, dim=128; no embedding provider anywhere in backend deps (`pyproject.toml:7-24`); `architecture.md:41,101` admits migration pending. All grounded features inherit this ceiling.

**H-5. PDF pipeline is synchronous; status endpoint fabricates progress state** *(Spec §41)*
- `papers.py:134-190` inline extraction; `papers.py:283-290` always-ready stepper; no queue despite Redis/Celery in the documented stack.

### MEDIUM

**M-1. LLM API keys stored in plaintext at rest** *(Spec §34; `provider_settings.py:110-133`).*

**M-2. Clause-level attribution absent from the primary (LLM) chat path** *(§26a; `rag_service.py:808-814` vs fallback :833-871; citation nodes hard-code `'sentence'`, `AcademicEditor.tsx:365,382`).*

**M-3. `explain` AI-edit action can never succeed even with a configured provider** *(missing map entry, `ai_writing_service.py:50-59` vs :225-228).*

**M-4. Legacy typing imports pervasive** *(A-3; ~60+ sites).* 

**M-5. `any` in API client layer + loose component prop types** *(A-4; `graphs.ts:14` et al.).*

**M-6. Hard-coded hex colors in ResearchGraphView** *(A-5; token-discipline breach in one feature area).*

**M-7. Residual hard-coded UI strings** *(A-6; i18n hygiene §49/docs CONTRIBUTING).*

**M-8. GROBID sections lose page numbers (page=1)** *(§11a/§26 traceability degradation; `pdf_extractor.py:237`).*

**M-9. In-product third-party payload disclosure missing** *(§34a; required string absent — verified by repo-wide search).*

**M-10. E2E test layer absent though documented** *(§42; docs/CONTRIBUTING.md:34 promises `tests/`; none exists; no browser-test tooling).*

### LOW

**L-1. File/function length guidance exceeded** *(A-7; 11 files, 3 giant functions).*
**L-2. Endpoint reaches into service private method** *(A-8; `papers.py:549`).*
**L-3. Triple Python dependency manifest without reconciliation** *(A-9).*
**L-4. Ctrl+F shortcut from §40 not implemented** *(search bound to Ctrl+K instead; `WorkspaceLayout.tsx:60-63`).*
**L-5. Chat history not persisted server-side** *(§7 "AI conversations" as project content; client-held only).*
**L-6. Claim-verification citation regex hard-codes four author surnames** *(quality of mechanical check; `intelligence_service.py:117`).*
**L-7. `.ruff_cache/` ungated by .gitignore; stray root file `Starting` would be committed** *(A-11/A-12).*
**L-8. Pre-commit TS-side coverage absent vs doc phrasing** *(A-10).*

### INFO

**I-1. Zero commits on `master`** — branch model (`develop` base, PR flow, CI green-before-review) in CONTRIBUTING is entirely aspirational until an initial commit lands; also means pre-commit hooks and CI have never validated this tree.
**I-2. Docs lag config both directions** — mypy/npm-audit/pip-audit/docker gates undocumented; test:coverage gate documented but nonexistent.
**I-3. `owner_type` placement differs cosmetically from §31's sketch** (on Owner vs Project) — functionally sound.
**I-4. Architecture diagram edge `AI_PKG --> AI_SVC` is conceptual** — the TS `packages/ai` is not consumed by the FastAPI service (separate language runtimes); harmless documentation imprecision.
**I-5. Prior-audit regression check:** collaboration persistence fixed (`collaboration.py:30-53`), discovery fabrication fixed (live Crossref, `graph_service.py:187-271`), auth-bypass finding **still open** (C-1).

---

## Positive Observations

1. **Polymorphic ownership done right, day one:** Owner/Membership/role checks uniformly applied across projects, papers, documents, citations, teams, versions, comments, graphs, plugins — exactly what §31 demanded to avoid the Phase-3 migration trap.
2. **Honest-failure AI semantics are systematic:** every AI path returns explicit refusal ("Insufficient evidence found in your sources."), `grounding_state`, trust legend, or typed exceptions (`AIProviderUnavailableError`) instead of inventing content — rare discipline.
3. **Extraction honesty per §11a:** confidence scoring, `unverified` marking, retrieval penalties for unverified chunks, tables/equations as first-class chunk types.
4. **Upload security is genuinely careful:** declared-length pre-check, streamed bounded writes, magic-header validation mid-stream, partial-file cleanup, sanitized filenames (`papers.py:88-137`).
5. **Real citation engine:** six v1 styles + variants implemented with tests (`styles.test.ts` 549 lines, `bibtex.test.ts` 366 lines), style switching across existing nodes, bibliography add/remove diffing.
6. **WS collaboration hardened:** bounded frames, message-rate limiting, first-frame auth, Redis fan-out with origin de-duplication, edit persistence with own sessions.
7. **Docs suite matches spec obligations:** VPAT, retention policy, copyright/legal posture, legal review checklist, self-hosting guide, security policy, roadmap — the §34a/34b/48 artifacts exist.
8. **Test volume and structure:** phase-mapped backend suites covering success *and* authorization-failure paths, matching the CONTRIBUTING testing contract.

---

## Prioritized Recommendations

1. **[P0] Close the auth bypass (C-1).** Make `get_current_user` require a valid token unless an explicit `LOCAL_MODE_NO_AUTH=true` setting is set; never auto-provision admin. Re-gate plugin registration behind real credentials, and restrict `PLUGIN_ALLOWED_MODULE_PREFIXES` imports to reviewed code. Add a startup warning when binding non-loopback with auth disabled.
2. **[P0] Encrypt API keys at rest (M-1)** — OS keyring or Fernet with a machine-local key file; never plaintext JSON.
3. **[P1] Replace outline & gap synthesis with real implementations or honest labels (H-2, H-3):** either wire the LLM into `generate_ai_outline` and `_synthesize_potential_gaps`, or rename endpoints/UI copy ("template outline", "heuristic gaps") and remove fabricated evidence counts — the current state violates the product's own §47 principles.
4. **[P1] Adopt a real embedding model + pgvector (H-4)** — even a small local model via Ollama `/api/embeddings` with the existing pgvector-ready schema closes the biggest quality gap; keep hash vectors as offline fallback.
5. **[P1] Move PDF processing to a background task (H-5)** — FastAPI BackgroundTasks/arq/Celery with real status transitions wired to the existing stepped indicator; stop returning hardcoded `step="ready"`.
6. **[P1] Align CI with CONTRIBUTING (H-1):** run `npm run test:coverage` in CI with an explicit threshold; pick one number per stack (docs 70/90 or config 100/94) and update the other; add mypy/npm-audit/pip-audit/docker jobs to CONTRIBUTING's gate list.
7. **[P2] Implement §26a clause attribution on the LLM path** (per-clause citation markers or explicit AI-inference labeling; enforce decline-to-synthesize) and set citation-node `attributionScope` accordingly at insertion time.
8. **[P2] Fix the `explain` action (M-3)** by adding its instruction entry; add a regression test asserting all nine actions resolve instructions.
9. **[P2] Preserve GROBID page coordinates (M-8)** — parse TEI `<pb/>`/coords so sections carry real page anchors; feeds §26 traceability directly.
10. **[P2] Mechanical standards cleanup** — codemod `List[X]→list[X]`, `Optional[X]→X | None` (A-3); type the client-layer metadata field and shell props (M-5); move graph-view colors into tokens (M-6); sweep remaining literal strings into `strings.json` (M-7).
11. **[P3] Stand up an E2E suite** (Playwright against docker-compose) satisfying §42 and docs/CONTRIBUTING's promised `tests/`; begin the §43 eval harness (golden-set Recall@K + citation correctness) since it gates §21/§25 future scope.
12. **[P3] Repo hygiene before first commit** — add `.ruff_cache/` to .gitignore, delete root `Starting`, reconcile requirements.txt↔lock↔pyproject, then make the initial commit so CI/pre-commit actually engage.

---

*End of report — Audit 11. No repository modifications were performed during this audit.*

