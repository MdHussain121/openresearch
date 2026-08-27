# Test-Coverage Audit — OpenResearch Monorepo

**Audit ID:** 21 · **Mode:** READ-ONLY audit-only (no tests written; no production code touched)
**Date:** 2026-08-26
**Backend:** `apps/api` (FastAPI, pytest + pytest-cov) · **Frontend:** root vitest workspace (`apps/web`, `packages/*`)
**Skill applied:** `test-coverage` (audit mode — testing-what contract + strategy resolution only)

---

## Scope & Methodology

| Step | Action | Result |
|---|---|---|
| Skill load | Loaded `test-coverage` skill | Applied in audit-only mode |
| Backend suite inventory | Glob `apps/api/tests/**/*.py` | 44 files + `conftest.py` |
| Collection | `.venv\Scripts\python.exe -m pytest --collect-only -q` | **442 tests collected**, 3.3 s |
| Coverage reality | `.venv\Scripts\python.exe -m coverage report --show-missing --skip-covered` against pre-existing `.coverage` | Loaded successfully: **6,768 stmts / 577 missed / 91%** |
| Gate config | `pyproject.toml` → `[tool.pytest.ini_options] addopts = "--cov=app --cov-report=term-missing:skip-covered --cov-fail-under=94"` | Gate = 94 %, enforced on every bare `pytest` run |
| Frontend inventory | Glob `**/*.{test,spec}.*` excluding node_modules | **11 test files** (2 in `apps/web`, 9 in `packages/*`) + 2 type-level `.test-d.ts` files |
| Frontend run | `npx vitest run` | **175 tests / 11 files, all PASS in ~2 s** |
| CI wiring | `.github/workflows/ci.yml` | Backend job runs bare `pytest` (coverage gate active); Frontend runs `npm test` (**no `--coverage`** → vitest thresholds NOT enforced in CI) |
| Config inspection | Root `vitest.config.ts`, package tsconfigs, `package.json`s | See §Coverage Reality Check and §Test-Quality Defects |

**Side effect disclosed:** running `pytest --collect-only` re-wrote the stale `.coverage` artifact with import-time data (32 % snapshot). The true full-run figures below were captured from the file *before* that overwrite and are reproduced verbatim in this report. The next real `pytest` run regenerates the file; no persistent damage.

**Excluded per instructions:** `node_modules`, `.venv`, `.next`, `__pycache__`, caches, `storage/`, logs. Root `coverage/` directory confirmed to be **JavaScript** v8-coverage HTML output (subdirs: `ai`, `citations`, `editor`, `research`, `ui`) — unrelated to Python coverage despite its name/location.

---

## Executive Summary

1. **The CI backend gate is mathematically guaranteed red.** `--cov-fail-under=94` vs. actual **91.47 %** (577 of 6,768 statements missed). CI's `backend-check` job runs bare `pytest`, so every push/PR fails on the coverage threshold alone.
2. **The gap is concentrated, not diffuse:** ten modules account for 440 of the 577 missed statements (76 %). Covering just **171 more statements** flips the gate green — roughly the size of `llm_service.py`'s untested streaming layer *alone*.
3. **The single biggest hole is also the highest-risk code:** the entire LLM streaming subsystem (SSE parsing for OpenAI-compatible + Anthropic, NDJSON for Ollama, and the `<think>`-tag chunk-boundary state machine) has **zero tests** — 150 missed lines in `llm_service.py` at 56 %. Ironically, the frontend's own SSE parser (`client.test.ts`) has better chunk-boundary tests than the backend that produces those streams.
4. **Citation formatting is under-tested where it matters most:** ~15 of ~20 citation styles in `csl_formatter.py` (75 % coverage) have no assertions. For an academic-writing product, formatted citation/bibliography output *is* the product.
5. **Confirmed quality defects:** the JWT-refresh rotation test is a hard tautology (`... != old or True`), the WebSocket-garbage test asserts a locally-set boolean, and all four "accessibility" tests are self-verifying (they assert over constants defined inside the test itself). No live-network tests exist — that suspicion was checked and cleared; all provider HTTP is mocked.
6. **Frontend posture is thin-but-not-zero and misconfigured:** packages carry 175 passing unit tests (citations ×43, editor ×63), but the actual Next.js app (78 source files, 51 TSX components) has exactly **2** test files, both lib-only. Vitest's 100 % thresholds apply only to `packages/*` paths and only when `--coverage` is passed — which CI never does. Two type-level suites (`.test-d.ts`) are **never executed by vitest** (no `typecheck.enabled`; include globs don't match) and survive only accidentally via `tsc --noEmit`.
7. **Migrations have no safety net:** 4 Alembic revisions, zero migration tests, no CI step.

---

## Coverage Reality Check

### Gate math (why 94 configured ≠ 91.49 actual)

```
Statements:            6,768
Missed:                  577
Actual coverage:   (6768−577)/6768 = 91.47 %   (report rounds to 91 %; drift vs "91.49 %" is version noise)
Gate:                  --cov-fail-under=94  ⇒ max allowed missed = floor(6768 × 0.06) = 406
Shortfall:             577 − 406 = 171 statements must flip to covered
CI enforcement:        ci.yml → backend-check → bare `pytest` → addopts inject the gate → JOB FAILS
```

The gate fails because of *where* the missing lines are, not because of broad thinness: **37 other app modules are at 100 %** ("37 files skipped due to complete coverage"). The failure is driven by a handful of hard-to-test-looking-but-actually-easily-mockable async/streaming paths.

### Per-module gap matrix (from `coverage report --show-missing`, full-run data)

| Module | Stmts | Miss | Cov % | Missing lines (verbatim) | What the missing code does |
|---|---:|---:|---:|---|---|
| `services/llm_service.py` | 340 | **150** | **56 %** | 57, 284, 334-335, 348-370, 379-422, 426-431, 441-482, 492-536, 552-553, 557-561, 564-582, 585-590 | **Entire streaming layer**: `stream_generate` fallback chain; `_stream_ollama` NDJSON + availability back-off; `_iter_sse_data`; `_stream_openai_compatible` SSE incl. `reasoning_content`; `_stream_anthropic` thinking blocks; `_ThinkTagSplitter` stateful chunk-boundary router |
| `endpoints/collaboration.py` | 227 | **69** | **70 %** | 42-61, 84-85, 89, 95, 113-114, 116, 153-154, 184-185, 190-198, 204, 211-212, 216-217, 220-221, 257-258, 270-271, 276-278, 303-337, 345, 354, 368 | WS protocol handlers: `cursor_move`, `doc_edit` persistence+broadcast, `comment_sync`, presence updates, disconnect cleanup, `GET .../collaborators` authz/404 |
| `services/export/csl_formatter.py` | 116 | **29** | **75 %** | 90-97, 147-150, 153-161, 167-168, 171-173, 176-177, 180-188, 191-198, 201-207 | Citation styles: ama/cse, asa, mhra, oxford, oscola, bluebook, abnt, iso690, gbt7714 (partially), plus fallback branch |
| `endpoints/chat.py` | 46 | **10** | **78 %** | 86-110 | **Whole SSE chat endpoint**: project 404, owner-access 403, `StreamingResponse` `data:` framing |
| `endpoints/papers.py` | 235 | **43** | **82 %** | 77…547, incl. 559-575 block | Ask-paper-AI grounded path & insufficient-evidence branch; numerous error/validation branches |
| `services/rag_service.py` | 323 | **55** | **83 %** | 87, 407, 533-534, **605-732**, 744-751, 779-804, 840 | `stream_chat_response`: general-mode disclaimer path, insufficient-evidence decline, grounded streaming meta/trust frames, blocking-fallback synthesis |
| `services/zotero_service.py` | 104 | 16 | 85 % | 60-61, 95, 174, 195-205, 208-210 | Import/error paths |
| `main.py` | 54 | 7 | 87 % | 44-50, 59 | Startup/lifespan branches |
| `endpoints/version_history.py` | 109 | 12 | 89 % | 45-49, 60, 214-216, 218-220 | Version diff/restore edges |
| `services/pdf_extractor.py` | 347 | 39 | 89 % | 138-139, 157-161, 316-339, 359-369, 501-508, 512-523, 648 | GROBID fallback chains, page-range handling |
| `services/intelligence_service.py` | 203 | 17 | 92 % | 57-59, 66, 229, 341, 387-391, 412, 460, 572-584, 613-623 | Gap-suggestion/error paths |
| `endpoints/citations.py` | 248 | 26 | 90 % | 65, 172…379, 508-518 | Restyle/format edge branches |
| `services/auth.py` | 108 | 6 | 94 % | 97-103 | **Concurrent local-user creation race fallback** (rollback + re-query) |
| `plugins/csl_processor.py` | 93 | 2 | 98 % | 130-131 | Edge |
| 24 further modules | — | 0 | 100 % | — | Fully covered |

Top-10 offenders sum: **440 missed lines = 76 % of the entire shortfall.**

### Frontend reality

- Root `vitest.config.ts` exists and is wired (`npm test` → 175 passing tests).
- **Coverage scope mismatch:** `coverage.include` lists only `packages/{citations,research,ai,plugins,ui,editor}` globs — **`apps/web/src` is entirely outside measured scope**, so the Next.js app could be 0 % and nothing would notice.
- **Thresholds are decorative in CI:** `thresholds: {lines/functions/branches/statements: 100}` applies only when `--coverage` is used; `ci.yml` runs plain `npm test`. The 100 % bar has never gated anything.
- Contradictory config: `include` lists `packages/editor/src/types.ts` while global `exclude` drops `**/types.ts` — exclude wins; dead line.
- Type-level suites `packages/citations/src/types.test-d.ts`, `packages/editor/src/types.test-d.ts` use `expectTypeOf` but are **never executed as tests** (no `typecheck.enabled: true`; the `include` glob `*.{test,spec}.ts` does not match `.test-d.ts`). They are only *incidentally* validated because package tsconfigs (`include: ["src/**/*"]`) compile them under `tsc --noEmit` in CI's typecheck step. Fragile: renaming the file or tightening an include would silently orphan them.
- `environment: 'node'` globally with a correct per-file `// @vitest-environment jsdom` docblock in `button.dom.test.tsx` — works, but signals component testing was an afterthought.
- Playwright/E2E: absent everywhere (no config, no dependency).

---

## Risk-Ranked Gap Register

Severity reflects production risk if the behavior regresses undetected. Priorities (P0–P3) follow the skill's rule: none were found declared in upstream artifacts for these behaviors, so they are marked UNKNOWN and surfaced for the owner rather than invented.

### CRITICAL

| # | Capability | Current state | Required tests | Priority | Effort |
|---|---|---|---|---|---|
| C1 | **LLM token-streaming correctness** (`llm_service.py:337-590`) | 0 tests for SSE/NDJSON parsing, provider fallback mid-stream, `<think>` routing across chunk boundaries, malformed-frame tolerance, non-200 abort | Unit tests with mocked sync httpx stream objects: golden SSE fixtures per provider; `_ThinkTagSplitter` fed arbitrary split points (property-based: routing(concat(chunks)) invariant); `[DONE]` sentinel; reasoning_content vs content channels; error→Ollama fallback | UNKNOWN | M (0.5–1 d) |
| C2 | **RAG streaming honesty guarantees** (`rag_service.py:605-751`) — insufficient-evidence decline, trust legend counts, general-mode disclaimer | Untested end-to-end | Integration via generator consumption: empty-passages → `done{insufficient_evidence:true}`; general mode emits disclaimer; meta frame precedes content; fallback synthesis when no provider | UNKNOWN | M |
| C3 | **JWT refresh rotation** (`test_security_hardening.py:69`) | Tautological assertion — rotation regression would pass CI | Fix assertion: decode both tokens, compare `iat`/`jti` claims (freeze time or tolerate equality only via claim check); add reuse-detection test if implemented | UNKNOWN | S |
| C4 | **Collab WS doc_edit persistence** (`collaboration.py:303-347`) — concurrent edit relay + DB persist flag broadcast | Only auth handshake tested | WS integration tests: doc_edit round-trip broadcast excludes sender; `persisted` flag true/false; disconnect broadcasts `user_left`; garbage message closes socket (with a *real* assertion) | UNKNOWN | M |

### HIGH

| # | Capability | Current state | Required tests | Priority | Effort |
|---|---|---|---|---|---|
| H1 | **Citation style output correctness** (`csl_formatter.py` — ama, cse, nature, cell, science, acm, acs, chicago-notes, turabian, asa, mhra, oxford, oscola, bluebook, abnt, iso690, gbt7714) | 15+ styles with no assertions; 75 % cov | Table-driven parametrized golden tests: one rich Paper fixture → expected string per style; missing-field permutations (no year/no journal/no DOI); inline markers per style | UNKNOWN | S–M |
| H2 | **Chat SSE endpoint contract** (`chat.py:86-110`) | Untested: 404, 403, frame envelope | TestClient streaming reads: first frame is `meta`, frames parse as JSON, `Content-Type: text/event-stream`, 403 for non-owner, 404 unknown project | UNKNOWN | S |
| H3 | **Alembic migrations** (4 revisions, zero tests, not in CI) | Schema drift between models and migrations undetectable | CI job: `alembic upgrade head` against scratch SQLite (or ephemeral Postgres) + `downgrade base`; assert `Base.metadata` ≡ migrated schema via Alembic autogenerate-compare smoke | UNKNOWN | M |
| H4 | **API-key store robustness** (`provider_settings.py` — money-like) | Happy-path roundtrip + masking covered; corrupt-file, concurrent-write, partial-write behavior unknown | Tests: truncated/JSON-corrupted store file → safe default not crash; two writers race; key file permissions; document that keys sit **plaintext at rest** (currently asserted as fact by `test_local_mode_and_providers.py:63`) or fix storage | UNKNOWN | S–M |
| H5 | **Papers ask-AI grounded path** (`papers.py:559-575`) + scattered error branches (43 missed) | Grounded success + insufficient-evidence response shapes untested | Mock `rag_service._llm_grounded_answer`: grounded answer → sources list formatting; sentinel string → `insufficient_evidence=True` payload; 503 when None | UNKNOWN | S |
| H6 | **Auth concurrency fallback** (`auth.py:97-103`) | Race-handling rollback path never exercised | Integration test forcing commit failure (patched commit raises once) → returns existing user, no 500 | UNKNOWN | S |

### MEDIUM

| # | Capability | Current state | Required tests | Priority | Effort |
|---|---|---|---|---|---|
| M1 | Zotero import error paths (`zotero_service.py:195-210`), GROBID fallbacks (`pdf_extractor.py:316-369, 501-523`), intelligence gap paths | Partial | Error-injection unit tests per branch | UNKNOWN | M |
| M2 | Version-history restore/diff edges (`version_history.py:214-220`) | Partial | Restore onto changed doc; missing version 404 | UNKNOWN | S |
| M3 | `main.py` lifespan/startup (44-50, 59) | Missed | TestClient context-manager entry asserting startup side effects | UNKNOWN | S |
| M4 | **Next.js app logic beyond libs** (hooks, state machines, citation-insertion flow, i18n loading — 51 components, 0 component tests) | Effectively untested | jsdom+testing-library unit tests for: citation insertion into TipTap editor, autocomplete settings hook, chat panel state, i18n string fallback | UNKNOWN | L |
| M5 | Browser E2E critical path | Absent | Single minimal Playwright spec: launch → create project → type → insert citation → export DOCX; run nightly/manual, not PR-blocking initially | UNKNOWN | M |
| M6 | OpenAPI drift guard (`test_openapi_schema.py` exists) | Present but shallow? | Snapshot endpoint inventory + response-model names; fail on undocumented removal | UNKNOWN | S |

### LOW

| # | Capability | Current state | Required tests | Priority | Effort |
|---|---|---|---|---|---|
| L1 | Vitest coverage thresholds meaningfulness | 100 % bar, wrong scope, unenforced | Either scope to reality (add apps/web lib dirs) and wire `test:coverage` into CI, or delete thresholds to stop implying a guarantee | UNKNOWN | S |
| L2 | Type-level tests execution | Never run by vitest | Add `typecheck: { enabled: true }` (+ `vitest --typecheck`) or fold assertions into runtime-imported `.test.ts`; keep tsc as belt-and-braces | UNKNOWN | S |
| L3 | Rate limiter Redis backend (`rate_limit.py:37`) | In-memory path only | Redis-backed path behind fake redis (FakeRedis already exists in `test_hardening_internals.py` — extend) | UNKNOWN | S |

### INFO

| # | Observation |
|---|---|
| I1 | Root `coverage/` directory holds stale JS v8 HTML reports — confusingly named alongside Python coverage; consider gitignoring or renaming output dir. |
| I2 | `vitest.config.ts:35` includes `editor/src/types.ts` while `exclude` drops all `types.ts` — dead config. |
| I3 | Suite-wide `--cov-fail-under` lives in `addopts`, so even targeted debug runs (`pytest -k x`) pay coverage cost; consider moving gate to CI command line instead. |
| I4 | No `hypothesis`/`freezegun`/`respx` in env — property-based and time-control tooling would need adding before recommendations P2/P3 below. |

---

## Test-Quality Defects

Verified by direct reading; each is reproducible at the cited location.

| # | Severity | Location | Defect | Why it matters |
|---|---|---|---|---|
| Q1 | CRITICAL | `tests/test_security_hardening.py:69` | `assert new_tokens["access_token"] != old_access or True  # rotation may produce identical bytes only if clock static` | Cannot fail under any circumstance. The test named `test_refresh_endpoint_rotates_tokens` verifies nothing about rotation. A regression that returns the *same* access token passes. |
| Q2 | HIGH | `tests/test_security_hardening.py:170-173` | `closed_after_garbage = True` set unconditionally inside `with client.websocket_connect(...)`, then `assert closed_after_garbage` | Constant-true assertion. The only real signal is that the `with` block didn't raise — the assert adds false assurance about server-side close behavior. Should assert against observed close/receive behavior (e.g., expect `WebSocketDisconnect` on subsequent receive). |
| Q3 | HIGH | `tests/test_phase7_accessibility_and_shortcuts.py:94-126` | `trust_definitions` dict is built **inside the test** and asserted to contain non-empty fields | Self-verifying: asserts its own literals. Removing the symbol/icon from the actual UI changes nothing here. |
| Q4 | HIGH | `tests/test_phase7_accessibility_and_shortcuts.py:46-91` | WCAG contrast computed over hex values **hard-coded in the test**, duplicating design tokens by hand | If the real theme tokens change, the test still passes (and may then describe a false guarantee). Must read tokens from source-of-truth (`packages/tokens`). |
| Q5 | MEDIUM | `tests/test_phase7_accessibility_and_shortcuts.py:129-143` | "VPAT conformance" test = file-exists + substring checks on a Markdown doc | Documentation presence, not accessibility. Fine as a lint-style check; misleading as a conformance test. |
| Q6 | MEDIUM | `tests/test_phase7_accessibility_and_shortcuts.py:7-21` | `_expected_shortcuts_reference` dict defined, **never referenced** | Dead fixture suggesting intended binding-verification that was never written; docstring claims shortcuts are "documented **and bound**" — binding is never checked. |
| Q7 | LOW | `tests/test_literature_search.py:417-418` | `def test_singleton_exists(): assert literature_search_service is not None` | Tautological import-check masquerading as a test. |
| Q8 | LOW | `tests/test_cov_services_final.py`, `test_cov_papers_citations.py`, `test_cov_final_sweep.py`, `test_cov_endpoints_core.py`, `*_coverage.py` | Names advertise coverage-chasing provenance | Content quality is actually reasonable (real assertions), but naming erodes trust in intent; rename by behavior. |
| Q9 | LOW | `tests/conftest.py:24-33` + `run()` helpers in several files | `asyncio.get_event_loop().run_until_complete()` pattern relies on the autouse fresh-loop fixture | Works today; breaks under `asyncio.run`-strict or pytest-asyncio strict mode refactors. Prefer `anyio`/`pytest-asyncio` idioms. |
| Q10 | INFO | `tests/test_local_mode_and_providers.py:61-63` | Test asserts raw API key equals plaintext in store file | Correctly documents current behavior — but enshrines plaintext-at-rest as expected behavior. Flag for product decision (H4). |

**Suspicion checked and cleared:** no live-network unit tests exist. All Crossref/arXiv/OpenAlex/Semantic Scholar/GROBID interactions in tests go through patched `get_async_http_client`/`get_sync_http_client` factories or mock clients (verified by grep for unmocked `httpx.get/post`, `requests.*`, `.stream(` — zero hits in `tests/`; URL strings appear only as fixture data/expected values). Conftest additionally forces `REDIS_URL=""` and resets all rate limiters per test — good hermeticity.

**Order-dependence scan:** module-level singletons (`service = LiteratureSearchService()`, `resolver = IdentifierResolver()`) share state across tests within a file, but the cache layer is patched per-test and rate limiters reset autouse; the per-test `create_all/drop_all` + StaticPool isolates DB state. No concrete order-dependence defect found; risk noted for future cache-singleton tests.

---

## Test Spec & Strategy Recommendations

Per the skill's economics: capability-before-cost, spend expensive modalities only at highest priority, prefer defense-in-depth for P0-ish behaviors. Priorities remain UNKNOWN pending owner declaration — the effort column is the lever until then.

### Capability table

| Capability | Current state | Required tests (modality) | Priority | Est. effort |
|---|---|---|---|---|
| LLM streaming (all providers + think-splitter) | None | **Unit** w/ fake httpx streams; **property-based** splitter invariant | UNKNOWN (treat P0) | 0.5–1 d |
| RAG stream_chat_response semantics | None | **Integration** (consume generator, assert frame sequence) | UNKNOWN (P0) | 0.5 d |
| Refresh-token rotation & single-use | Tautological | **Contract** via API + claim decoding | UNKNOWN (P0) | 2 h |
| Collab WS protocol (edit/cursor/comment/left) | Auth-only | **Integration** over TestClient websocket + collab_manager introspection | UNKNOWN (P0) | 0.5–1 d |
| Chat SSE endpoint | None | **Contract** (streaming TestClient reads) | UNKNOWN (P1) | 2 h |
| CSL citation styles (17 styles) | ~15 untested | **Unit**, parametrized goldens + missing-field matrix | UNKNOWN (P1) | 0.5 d |
| Alembic migrations | None | **Integration**: upgrade head/downgrade base on scratch DB in CI | UNKNOWN (P1) | 0.5 d |
| Provider key store edge cases | Happy path only | **Unit/integration** incl. corruption + concurrency | UNKNOWN (P1) | 0.5 d |
| Papers AI endpoint paths | Partial | **Contract** w/ mocked rag service | UNKNOWN (P1) | 2 h |
| Auth race fallback | None | **Integration** w/ injected commit failure | UNKNOWN (P2) | 1 h |
| PDF/GROBID/Zotero/intelligence edges | Partial | **Unit** error injection | UNKNOWN (P2) | 0.5–1 d |
| Frontend app logic (hooks/components/i18n) | 2 lib files | **Component** jsdom+RTL for citation-insert, autocomplete hook, chat panel; i18n fallback | UNKNOWN (P1–P2) | 2–3 d |
| Type-level contracts | Orphaned | Enable `vitest --typecheck` (or migrate into runtime tests) | UNKNOWN (P3) | 1 h |
| Browser E2E happy path | None | **E2E**: one Playwright spec (project→cite→export); scheduled, later PR-gated | UNKNOWN (P2) | 1 d |
| Contract drift | openapi test exists | Strengthen: snapshot operation inventory | UNKNOWN (P2) | 2 h |

### Tooling choices (lowest-cost-highest-value)

1. **Close the gate with pure-logic units first.** `llm_service` streaming (150 lines) + `csl_formatter` styles (29) + `chat.py` (10) ≈ 189 > 171 needed. All are deterministically mockable without new infra except one small addition: build fake `httpx.Response`-like stream objects (the repo already favors MagicMock clients — follow that pattern; `respx` optional, not required).
2. **Add `hypothesis`** (dev extra) solely for `_ThinkTagSplitter`: property = for any chunk partitioning, concatenated `(channel, text)` outputs equal single-shot routing. ~20 lines, kills the entire class of chunk-boundary regressions.
3. **Do not chase 100 % frontend coverage now.** First make existing thresholds honest: either (a) add `apps/web/src/lib/**` to coverage.include and enforce ≥85 % via a new CI step `npm run test:coverage -- --coverage.thresholds...`, or (b) drop thresholds. Then grow component tests around the citation-insertion flow (highest product value).
4. **Enable vitest typecheck** (`typecheck: { enabled: true, include: ['packages/**/*.test-d.ts'] }`) so type tests execute as designed instead of riding on tsc coincidence.
5. **Migration smoke job:** `alembic upgrade head && alembic downgrade base` against a disposable SQLite/Postgres container in CI. Note: pgvector-bearing migrations may require Postgres — if so, mark sqlite-partial and use the docker-compose Postgres already present in `infrastructure/`.
6. **Mutation-testing spot check (optional, post-gate):** `mutmut` scoped to `app/services/export/` + `app/services/llm_service.py` only, run monthly — validates that golden citation tests actually pin behavior rather than merely execute lines.
7. **Fix the four tautologies/self-verifying tests before adding volume** — they currently inflate confidence in exactly the security/a11y areas users will assume are covered.
8. **Contrast test should import real tokens** from `packages/tokens/src` (single source of truth) instead of duplicated hex strings.

---

## Positive Observations

- **Strong hermeticity discipline:** autouse fixtures reset rate limiters, force `ENVIRONMENT=test`, blank Redis, redirect provider-key store to `tmp_path`, and provide a pristine event loop per test (`conftest.py:24-67`). Many mature codebases lack this.
- **No live-network tests anywhere** — external-provider mocking is consistent and correct across literature-search, identifier-resolver, and provider tests.
- **37 modules at 100 % coverage**, including schemas (99 %), exporters (96-98 %), tabby setup, plugin runtime/builtins — the fully-covered tail is genuinely large.
- **Frontend package tests are high quality:** `client.test.ts` covers SSE frame reassembly across chunk boundaries, trailing-frame flush, error envelopes, 204 mapping, header absence; citations package carries 43 style/parser tests; editor extensions 63 tests. 175/175 green in ~2 s.
- **Security suite covers real attacker behaviors:** login rate-limit 429 + Retry-After, refresh-as-access confused-deputy, enumeration-safe duplicate registration, password policy, prod-config guards (SQLite rejection), refresh-token-as-WS-auth rejection.
- **WS auth model is thoughtfully tested** where it exists (valid auth room_state; refresh token rejected into anonymous identity).
- **CI is otherwise well-rounded:** ruff + mypy + pip-audit + npm audit + docker builds; pinned lockfile installs.
- Export pipeline (`ast_parser`, docx/pdf/markdown/bibtex) enjoys a genuine node-matrix test (`test_cov_final_sweep.py`) despite its coverage-chasing name.

---

## Prioritized Action Plan

**Phase 0 — stop the bleeding (≤ half day)**
1. Fix Q1 (`test_security_hardening.py:69`) and Q2 (`:170-173`) to be falsifiable.
2. Delete or rewrite Q3/Q4/Q6 (accessibility self-verifications; read real tokens; verify bindings or drop the claim).
3. Decide gate posture explicitly (owner): temporarily set `--cov-fail-under=91` with a tracking issue, OR land Phase 1 immediately — do not leave CI permanently red.

**Phase 1 — flip the gate honestly (~2–3 dev-days total, mostly mechanical)**
4. Unit-test `llm_service` streaming (fake streams; golden SSE/NDJSON per provider; think-splitter property test) → +~140 lines.
5. Parametrized golden tests for all 17 CSL styles + missing-field matrix → +~29.
6. Chat SSE endpoint contract tests (404/403/frame envelope) → +~10.
7. RAG `stream_chat_response` frame-sequence integration tests → +~40 (buffer above threshold).
8. Result: ≥94 % with *meaningful* tests; restore `--cov-fail-under=94` (or raise to 93 floor + per-module floors on services).

**Phase 2 — de-risk the product (~1 week spread)**
9. Collaboration WS protocol integration tests (doc_edit persistence, cursor, comment_sync, disconnect, collaborators authz).
10. Migration upgrade/downgrade CI smoke.
11. Provider-key-store robustness tests; make an explicit product decision on encryption-at-rest (Q10/H4).
12. Papers AI + auth-race + zotero/GROBID/intelligence edge tests.
13. Make vitest thresholds real (scope + CI `test:coverage` at sane bars) and enable vitest typecheck.

**Phase 3 — confidence beyond line coverage (ongoing)**
14. Component tests for the citation-insertion flow and chat panel; i18n fallback tests.
15. One Playwright E2E happy-path (project→write→cite→export), scheduled first, PR-gating later.
16. Optional mutmut spot-check on export + llm_service; strengthen OpenAPI snapshot.

**Bottom line:** the failing 94 % gate is ~171 deliberate statements away from green, the fixes double as the highest-risk coverage in the codebase, and four existing tests actively lie about security/accessibility guarantees — fixing those costs hours and buys more trust than any quantity of new line coverage.
