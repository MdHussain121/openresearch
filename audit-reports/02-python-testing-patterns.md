# Python Testing Patterns Audit — OpenResearch API (`apps/api/tests/**`)

**Audit date:** 2026-08-26
**Auditor:** ox-alpha (read-only audit, skill: `python-testing-patterns`)
**Repo:** `C:\Users\moham\Pictures\OpenResearch` — scope limited to `apps/api/tests/` + `tests/conftest.py`

---

## Scope & Methodology

### What was audited

| Item | Count |
|---|---|
| Test modules (`tests/test_*.py`) | 39 |
| Shared fixtures (`tests/conftest.py`) | 1 (81 lines, 7 fixtures) |
| Collected tests | **442** (all pass locally in ~105 s on Windows / Python 3.11.15 / pytest 9.1.1) |
| App modules under coverage | 68 source files (`app/**`), 6,768 statements |

### Method (read-only; no files modified)

1. Loaded the `python-testing-patterns` skill and applied its criteria: test-type mix, AAA structure, isolation, fixture design, mocking strategy, parametrization, assertion quality, marker usage, time handling, coverage discipline.
2. Inventoried the suite with `pytest --collect-only -q`.
3. Executed the full suite once to obtain **real** coverage and pass/fail state:
   `442 passed`, total coverage **91.49%**, configured gate `--cov-fail-under=94` → **gate FAILS**.
4. Read conftest + config (`pyproject.toml [tool.pytest.ini_options]`, `[tool.coverage.run]`) line-by-line.
5. Read or deep-sampled all 39 test modules (~9,300 lines of test code), including every file flagged by smell greps.
6. Grepped for smells: `time.sleep` / `asyncio.sleep` (0 hits), `freeze_time`/freezegun (0 hits), `random.`/`uuid4` (1 hit), mock usage per file, parametrize density, broad excepts, tautological asserts (`or True`, `in (a,b)` acceptance), cross-layer file reads, helper duplication.
7. Cross-checked CI behavior against `.github/workflows/ci.yml` (backend job runs bare `pytest`, inheriting addopts).

### Severity definitions used

- **CRITICAL** — Actively breaks the quality pipeline or can silently ship regressions.
- **HIGH** — Tests that do not verify what they claim (fake/tautological assertions), hermeticity violations, failure-masking structures.
- **MEDIUM** — Maintainability/correctness risks: duplication, white-box fragility, inconsistent patterns, real coverage gaps.
- **LOW** — Style/hygiene issues with low blast radius.
- **INFO** — Observations, positive notes, context.

---

## Executive Summary

The suite is **substantially better than average** for an app of this size: it uses a real (in-memory SQLite) database rather than mocking the ORM, tests behavior through the public HTTP surface, contains genuine security/RBAC/regression tests, has zero sleep-based tests, and passes deterministically in ~105 s.

Its two systemic problems are:

1. **A broken quality gate**: `pyproject.toml` pins `--cov-fail-under=94` while actual coverage is **91.49%** → the backend CI job (`ci.yml:72`) fails on *every* run today. A permanently red gate is worse than no gate.
2. **A "coverage-sweep" stratum of tests written to touch lines, not verify behavior** (files named `test_cov_*`, `*_coverage.py`, `_final_sweep.py`, comments citing literal line numbers). Inside that stratum live several **tautological assertions that cannot fail**, including one inside the JWT refresh-rotation security test.

| Severity | Count | Headline items |
|---|---|---|
| CRITICAL | 1 | Coverage gate (94%) unreachable at 91.49% → CI red / gate ignored |
| HIGH | 5 | Tautological asserts (incl. security test); wrong-layer frontend tests that can't fail; live-network unit test; mega-tests masking failures; env-dependent assertion `(200, 503)` |
| MEDIUM | 10 | Coverage-driven naming/weak disjunctive asserts; duplicated helpers & parallel DB infra; alembic never executed; llm_service 56%; no markers; 3 coexisting async strategies; white-box singleton mutation; Postgres never exercised despite prod mandate; TTL/cache tests duplicated across files; provider-store cleanup not fixture-based; TestClient override clobbering |
| LOW | 8 | hash()-based emails, broad excepts, dead branches, unused variables/dicts, deprecated `get_event_loop`, stale pycache of deleted tests, module-level singletons, `raises(Exception)` |
| INFO | 6 | Strong hermetic autouse fixtures; real-DB testing; good security suite; regression-test culture; deterministic runtime; contract smoke test |

---

## Detailed Findings

### CRITICAL

#### C-1. Coverage gate is mathematically unreachable — CI is permanently red

* **Where:** `apps/api/pyproject.toml` (`[tool.pytest.ini_options] addopts = "--cov=app --cov-report=term-missing:skip-covered --cov-fail-under=94"`) × `.github/workflows/ci.yml:69-72`
* **Evidence:** Full local run: `FAIL Required test coverage of 94% not reached. Total coverage: 91.49%`. CI backend job runs bare `pytest` in `apps/api`, so it inherits this addopt.
* **Why critical:** Every push/PR fails the backend job at the pytest step regardless of code quality. Teams respond to permanent red by ignoring the job or merging with `--no-verify` semantics; the gate stops protecting anything. The gap is concentrated and fixable: `llm_service.py` **56%** (150 missed stmts), `csl_formatter.py` 75%, `collaboration.py` endpoint 70%, `chat.py` endpoint 78%, plus scattered guard lines.
* **Fix (choose one, then re-tighten):**
  1. Lower to a truthful ratchet: `--cov-fail-under=91` now, +0.5 per sprint; **or**
  2. Keep 94 but add tests for the named hotspots (llm_service cloud arms lines 348–590 are the single biggest lever); **or**
  3. Split gates: hard floor 85% global + per-file floors for `services/*` ≥ 90%, so one weak module can't hide behind the aggregate.
* Also remove the misleading `94` if it was aspirational — a config that lies is itself a defect.

---

### HIGH

#### H-1. Tautological assertions — tests that cannot fail

Three confirmed instances where the assert expression is always true, i.e., the test verifies nothing:

1. **JWT refresh rotation (security-critical):**
   `tests/test_security_hardening.py:69`
   ```python
   assert new_tokens["access_token"] != old_access or True  # rotation may produce identical bytes only if clock static
   ```
   `X or True` is always `True`. Token rotation is *not verified*. If rotation regresses to reissuing the identical token, this suite stays green.
   **Fix:** freeze time is unnecessary here — assert token *payload* changes: decode both tokens (`jwt.decode(..., options={"verify_exp": False})`) and assert `iat`/`jti` differ; or mint with `freeze_time` and compare. Remove `or True`.

2. **WebSocket garbage-before-auth closure:**
   `tests/test_security_hardening.py:169-173`
   ```python
   with client.websocket_connect(...) as ws:
       ws.send_text("not json at all")
       closed_after_garbage = True
   assert closed_after_garbage
   ```
   The flag is set unconditionally one line before asserting it. Nothing observes whether the server actually closed the socket. A server that accepts anonymous edits after garbage frames passes this "security" test.
   **Fix:** expect the close: `with pytest.raises(WebSocketDisconnect): ... receive()` after sending garbage, or assert `collab_manager.active_connections` does not contain the doc after context exit (the pattern correctly used in `test_ws_rejects_refresh_token_as_auth:197-202`).

3. **Room cleanup branch:**
   `tests/test_cov_services_final.py:295`
   ```python
   collab_manager.disconnect(ws1, "doc-x")  # idempotent / room cleanup branch
   assert collab_manager.get_room_users("doc-x") is None or True
   ```
   Always true. The intended check is almost certainly `get_room_users("doc-x") is None` (room removed after last disconnect).
   **Fix:** delete `or True`; if the implementation doesn't return `None`, that's a product bug to raise, not an assert to neuter.

#### H-2. Wrong-layer "accessibility" tests that structurally cannot fail

`tests/test_phase7_accessibility_and_shortcuts.py` — four tests, three of which test the test file itself:

1. `test_wcag_contrast_ratios` (:46-91) computes WCAG luminance over **hex literals hardcoded inside the test** (`"#FFFFFF"`, `"#1A1A18"` …). It validates arithmetic on constants, not the product's design tokens. Changing the app's theme cannot fail this test; only editing the test can. **Fix:** import the real token source (e.g., parse `apps/web/src/styles/tokens.css` / Tailwind config / `strings.json` theme section) and compute over those values.
2. `test_trust_state_non_color_redundancy` (:94-126) builds a local dict `trust_definitions = {...}` and asserts the dict's own fields are non-empty. Pure self-check. **Fix:** read trust-state definitions from wherever the web app defines them (shared package/config) or move to the web test suite.
3. `test_keyboard_shortcuts_contract` (:5-43) reads `../../web/src/i18n/strings.json` from the **Python** suite — a cross-app filesystem coupling (breaks if `apps/web` moves; wrong owner for the assertion). Additionally `_expected_shortcuts_reference` (:7-21) is defined and **never used** — fake rigor. **Fix:** move to `apps/web` vitest suite; delete the unused dict.
4. `test_vpat_conformance_document_exists` (:129-143) is acceptable as a docs-presence smoke check but belongs in a docs/lint job, not the API suite.

**Impact:** these four show as green backend tests while verifying nothing about the backend; they inflate confidence and the count of "passing tests."

#### H-3. Live-network call inside the unit suite (hermeticity violation)

`tests/test_phase2_memory_and_lifecycle.py:150-162`
```python
@pytest.mark.asyncio
async def test_identifier_resolver_uses_pooled_client():
    res = await identifier_resolver.resolve("10.1016/j.physletb.2020.135500", "doi")  # REAL Crossref/doi.org hit
    ...
    res_arxiv = await identifier_resolver.resolve("1706.03762", "arxiv")              # REAL arXiv hit
```
No monkeypatching of the HTTP client anywhere in this test. It passed here only because the machine had internet. Consequences: offline/air-gapped dev and CI mirrors fail; rate-limits/latency from real providers leak into unit runs; results depend on third-party data changing over time.
**Fix:** patch `identifier_resolver`'s client getter exactly as done properly in `test_literature_search.py` (mock `get_async_http_client`) or point at a local stub; keep one optional `@pytest.mark.network` integration test if end-to-end reachability is desired (and register the marker).

#### H-4. Mega-tests: single functions whose later steps are silently skipped when an earlier step fails

Files where an entire feature area lives in ONE `def test_...`:

| File | Test function | Lines | Steps chained |
|---|---|---|---|
| `tests/test_phase3_papers.py` | `test_paper_upload_and_pipeline_lifecycle` | 47-190 (144 lines) | upload→status→list/search→detail→stream→annotations CRUD→ask-AI→delete paper |
| `tests/test_phase9_teams.py` | `test_team_workspaces_crud_and_membership_roles` | 1-144 | 3 registrations→team CRUD→RBAC matrix→role promotion→removal |
| `tests/test_phase9_collaboration_and_versions.py` | `test_comments_and_version_history` | 27 asserts, 1 fn | comments + versions lifecycles |
| `tests/test_phase9_research_graphs.py` | `test_research_graphs_and_paper_discovery` | 21 asserts, 1 fn | graph + discovery |
| `tests/test_phase7_integration_workflow.py` | `test_full_academic_researcher_lifecycle` | 13-205 | E2E (acceptable as *one* dedicated E2E) |

When step 4 of 11 raises (e.g., annotations create returns 500), pytest reports one failure and steps 5–11 **never execute** — you lose visibility into how far the breakage cascades, and bisecting takes longer. The teams file alone covers owner/editor/viewer enforcement, promotion, and revocation in one shot: a viewer-RBAC regression and a removal bug would be reported as one opaque failure at whichever line hits first.
**Fix:** split along step boundaries into focused tests sharing a setup fixture (`owner_headers`, `team_with_members`), keeping ONE lifecycle E2E (`phase7_integration_workflow`) as the deliberate journey test.

#### H-5. Environment-dependent acceptance weakens the ask-AI contract

`tests/test_phase3_papers.py:170-178`
```python
assert ask_res.status_code in (200, 503)
if ask_res.status_code == 503: ...
else: ... assert ask_data["grounded"] is True ...
```
The suite elsewhere proves LLM absence is deterministic (see `test_hardening_internals.py:233-241`, which asserts `AIProviderUnavailableError` deterministically). Accepting both outcomes means: if a stray Ollama is running on a dev machine/CI runner, this test exercises a completely different code path than on clean machines — non-hermetic branching hidden in a pass-either-way assert.
**Fix:** force the environment (conftest already blanks `REDIS_URL`; also blank/monkeypatch provider store & probe state) and assert the honest-503 path; add a separate mocked-provider test for the grounded-200 path (the tabby/llm files already contain the fakes needed).

---

### MEDIUM

#### M-1. Coverage-driven authorship layer: names, comments, and residual weak assertions

Six files are explicitly line-chasing artifacts: `test_cov_endpoints_core.py`, `test_cov_final_sweep.py`, `test_cov_papers_citations.py`, `test_cov_services_final.py`, `test_tabby_setup_service_coverage.py`, `test_text_utils_coverage.py`, `test_phase7_services_coverage.py`, `test_phase7_quality_gates.py` (comments like *"closes coverage gaps … (rag_service.py lines 55, 62-64, 76, 83)"*). To their credit, many assertions inside ARE behavioral (AST node matrix, chunker semantics, embedding determinism). But the stratum drags in weak checks:

- `tests/test_cov_services_final.py:52-59` — `test_get_db_yields_and_closes_session`: name promises "closes session", body only checks `session is not None` and swallows `StopIteration` via `try/except: pass`. Session closing is never observed. **Fix:** wrap engine connect/disconnect events or use a recording sessionmaker; assert close happened.
- `:151` — `assert format_authors_summary([...]) in ("Alice Smith & Hopper", "Smith")` — accepts two different behaviors; pick the specified one.
- `:410` — `assert "# " in md_off or "Export" in md_off` — disjunction; near-vacuous.
- `:430` — `assert entry and style.lower()[:2] != "zz"` — second clause is a tautology ("zz" is not a style); reduces to truthiness-only.
- `:317-322` — unauthorized WS path wrapped in `try/except Exception: pass`: if the server *doesn't* reject bad tokens, the exception simply never fires and the test proceeds to pass. Replace with explicit expected-disconnect handling (as `security_hardening` does for refresh-token rejection).
- `test_cov_endpoints_core.py:16` — `_register` accepts `status_code in (200, 201)` (register returns exactly 201; tolerance hides drift).

**Fix:** rename files by domain (not by "cov"), rewrite the six weak spots above as exact assertions, and adopt the rule: *every new test must state the behavior it pins in its name* (most non-sweep files already follow `test_<unit>_<scenario>_<expected>` well).

#### M-2. Helper and infrastructure duplication instead of conftest fixtures

- Auth-header helper duplicated ≥6×: `_reg`/`_register` in `test_cov_final_sweep.py:19`, `test_cov_services_final.py:350`, `test_literature_search.py:610`, `test_cov_papers_citations.py:15`, `test_cov_endpoints_core.py:11`, `test_phase7_quality_gates.py:205`, plus inline re-implementations in ~12 more files (grep "Bearer ": 50+ hits). Password strings differ per copy (`Secure_Password_123`, `SecurePass123`, STRONG_PASSWORD…).
- PDF byte-builders duplicated: `create_sample_pdf_bytes` (`test_phase3_papers.py:4`), `create_transformer_paper_pdf`/`create_bert_paper_pdf` (`test_phase4_rag_and_chat.py:4,47`).
- `FakeClient`/`FakeResponse` hand-rolled twice nearly identically (`test_llm_provider_paths.py:9-28`, `test_tabby_autocomplete.py:19-49`).
- `MockWebSocket`/`FakeWebSocket` defined three separate times (`test_hardening_internals.py:25`, `test_phase2_memory_and_lifecycle.py:169`, `test_cov_services_final.py:266`).
- **Parallel DB infrastructure:** `tests/test_models_and_auth.py:13-27` builds its own engine/sessionmaker/create-drop cycle instead of using conftest's `db` fixture — two divergent "test database" implementations in one suite.
- Setup-user-and-project helpers duplicated (`test_phase4_rag_and_chat.py:86`, `test_phase8_intelligence.py:10`).

**Fix:** add to conftest: `registered_user` (returns email+headers), `auth_headers(registered_user)`, `project(auth_headers)`, `sample_pdf_bytes`, shared `FakeHttpClient`/`FakeResponse`/`FakeWebSocket` in a `tests/fakes.py`. Delete ~250–300 lines of duplication.

#### M-3. Alembic migrations are never executed; production DB engine never tested

Only migration test is `test_run_migrations_all_branches` (`test_cov_services_final.py:98-134`), which **mocks** `alembic.command.upgrade/stamp` entirely. No test ever runs `upgrade head` against a real (even SQLite) database, so model↔migration drift (missing columns/tables in the 4 files under `alembic/versions/`) would pass the whole suite and explode on first real deploy. Compounding: `app/core/config.py` **rejects SQLite in production**, and the docker image targets Postgres+pgvector, yet the entire suite runs only on SQLite — pgvector-specific column types/indexes (if any in migrations) are untested everywhere.
**Fix:** one session-scoped fixture creating a throwaway DB, running `command.upgrade(cfg, "head")`, then `Base.metadata.create_all` diff-check (alembic autogenerate compare) — catches drift cheaply. Add a CI job (service container `postgres:16`) running the suite with `DATABASE_URL=postgresql://…` at least for models/migrations subsets.

#### M-4. `llm_service.py` is the least-covered core service (56%)

340 stmts, 150 missed: lines 348-370, 379-422, 441-482, 492-536, 557-590 (cloud provider arms, streaming, embeddings-related paths per the term-missing report). Given this module mediates every AI feature and holds provider keys, this is the highest-value coverage target in the repo. The existing `FakeClient` pattern in `test_llm_provider_paths.py` extends trivially to these arms.
**Fix:** table-driven tests over each provider arm (openai/custom/anthropic/ollama × {happy, non-200, empty payload, network error, malformed JSON}), mirroring what was already done for Tabby.

#### M-5. No marker taxonomy; suite cannot be sliced

Zero custom markers registered (`[tool.pytest.ini_options]` has no `markers`), none used besides 4 `@pytest.mark.asyncio`. There is no way to run "fast unit" vs "endpoint integration" vs "network" slices; when the network test (H-3) or future slow tests appear, they can't be excluded cleanly. Also no `filterwarnings` config, so deprecation warnings (httpx/starlette) scroll every run and new numpy/sqlalchemy warnings will hide among them.
**Fix:** register `markers = ["slow", "integration", "network", "e2e"]`, tag the handful of heavier tests, add `-p no:cacheprovider`? (optional), and `filterwarnings = ["error::DeprecationWarning:app.*"]` style policy.

#### M-6. Three coexisting async-execution strategies

1. Autouse `fresh_event_loop_per_test` (conftest:24-33),
2. `@pytest.mark.asyncio` strict-mode tests (`test_phase2_memory_and_lifecycle.py`),
3. Manual `asyncio.run(...)` inside sync tests (`test_hardening_internals.py:106`, `test_phase2_memory_and_lifecycle.py:186-189`),
4. Module-level `run(coro)` helpers using deprecated `asyncio.get_event_loop().run_until_complete` (`test_identifier_resolver.py:11-12`, `test_literature_search.py:21-22`).
Strategy (4) relies implicitly on fixture (1) having installed a loop; `asyncio.new_event_loop().run_until_complete(...)` in `test_cov_services_final.py:297` leaks the created loop (never closed). Works today; breaks on asyncio internals churn.
**Fix:** standardize on `@pytest.mark.asyncio` (set `asyncio_mode = "strict"`, or `"auto"` to drop decorators) and delete manual-loop helpers; keep `asyncio.run` only where deliberately testing fresh-loop semantics.

#### M-7. White-box mutation of module singletons without monkeypatch

- `test_hardening_internals.py:103-108,117-122,144-149,170-196` saves/restores `collab_manager.redis_client` via try/finally and directly injects/removes entries in `collab_manager.active_connections[doc_id]` (:127, :172) — if an intermediate assert raises, finally still runs (good) but the pattern ignores the monkeypatch facility used everywhere else; direct dict surgery can leave rooms registered if a test errors between mutate and cleanup.
- `test_phase2_memory_and_lifecycle.py:105-109` reaches into `app.core.http_client._async_client/_async_client_loop_id = None` as "cleanup" — order-coupling disguised as hygiene: skip this test and later loop-bound tests see different state.
- Cache tests routinely poke privates: `svc._cache["expiring"]["expires_at"] = time.time() - 1` (`test_provider_cache_service.py:27`, `test_phase2_memory_and_lifecycle.py:49`), `svc._provider_stats[...] = ...` (:110,119,127).
**Fix:** prefer monkeypatch (auto-undo), expose a `time_fn` seam in `ProviderCacheService` for TTL advancement (removes private-dict pokes AND enables freezegun-free time travel), and give `CollaborationRoomManager` a reset fixture in conftest.

#### M-8. Production parity: Postgres/pgvector path has zero test execution

Beyond M-3: all repository behavior is validated on SQLite (StaticPool, single connection). SQLAlchemy-dialect differences (JSONB vs JSON, array columns, `RETURNING`, transactional DDL, case sensitivity) are exactly the class of bug this suite cannot see. The prod config guard (`test_sqlite_rejected_in_production`) even documents that Postgres is the mandated engine.
**Fix:** as M-3 CI service-container job; at minimum run models+migrations+one CRUD-per-endpoint slice on Postgres.

#### M-9. Duplicated cache-service coverage in two files drifting apart

`ProviderCacheService` LRU/TTL/stats/quota is tested twice: `test_provider_cache_service.py` (24 tests) AND `test_phase2_memory_and_lifecycle.py:17-73` (same eviction/TTL scenarios re-done, with slightly different expectations, e.g., quota `len(status.providers) == 3` here vs provider-count-agnostic asserts there). Double maintenance; when defaults change, one file updates and the other silently encodes stale behavior.
**Fix:** keep the dedicated file as canonical; reduce lifecycle file to integration wiring (HTTP client pool, resolver pooling).

#### M-10. Provider-config teardown is test-body responsibility; health override restore is lossy

- `test_llm_provider_paths.py:42,64,97` and multiple tabby tests call `provider_settings.delete_provider_config(...)` as the last statement. Any assertion failure above leaks config for the remainder of that test (mitigated across tests by per-test `tmp_path` store redirect in conftest:48-51 — good), but within-test ordering effects remain, and the intent ("clean state") belongs in a fixture.
- `test_health.py:25-33` swaps `app.dependency_overrides[get_db] = BrokenSession` then `pop(get_db)` in finally — this *deletes* the override the autouse `setup_test_db` installed rather than restoring it; any later request in the same test would bypass the test DB. Use `monkeypatch.setitem(app.dependency_overrides, get_db, BrokenSession)` for scoped restore.
**Fix:** `clean_provider_store` autouse-or-explicit fixture wrapping provider tests; convert health override swap to monkeypatch.setitem.

---

### LOW

#### L-1. Nondeterministic unique emails via `hash()`
`test_security_hardening.py:117` — `f"weak_{abs(hash(weak_password))}@..."`. PYTHONHASHSEED randomization makes emails differ run-to-run (fine) but collisions across params are theoretically possible and the intent is obscured. Use the param value directly: `f"weak_{weak_password[:6]}_{i}@..."` via `request.node` indexing or enumerate.

#### L-2. Overly broad exception expectations
`test_security_hardening.py:127` `pytest.raises(Exception)` for Settings validation (pydantic raises `ValidationError` — assert it specifically); `test_cov_services_final.py:56-59` swallowing `StopIteration`; `:321` `except Exception: pass` around WS rejection (promoted in H/M-1 fixes).

#### L-3. Dead branches / unused constructs
`test_phase7_auth_enforcement.py:64-71` PUT/else arms unreachable (endpoint list contains no PUT); `test_phase7_accessibility_and_shortcuts.py:7-21` unused shortcuts dict (H-2); `router  # noqa: F401` import-for-nothing in `test_hardening_internals.py:156-158`.

#### L-4. Stale bytecode of deleted tests
`tests/__pycache__/test_zz_probe.cpython-311.pyc`, `test_phase7_eval_baseline.cpython-311.pyc` exist with no corresponding sources — evidence of deleted debug/baseline tests. Harmless but signals untracked churn; ensure `.gitignore` covers pycache and consider `pytest -p no:cacheprovider` in CI.

#### L-5. Module-level service singletons in tests
`resolver = IdentifierResolver()` (`test_identifier_resolver.py:15`), `service = LiteratureSearchService()` (`test_literature_search.py:25`). Currently safe because tests don't mutate them, but any future cached state becomes cross-test leakage. Instantiate in fixtures.

#### L-6. `run()` helper rides on autouse loop fixture
`asyncio.get_event_loop()` is deprecated-with-warning territory on 3.12+; pin the pattern to `asyncio.run` or pytest-asyncio before the 3.12 bump (requires-python allows >=3.11 open-ended).

#### L-7. Assertion-count imbalance inside sweep files
E.g., `test_cov_final_sweep.py` 5 tests/15 asserts vs `test_tabby_autocomplete.py` 38/136 — fine individually, but sweep files often end multi-arm tests with a single trailing isinstance assert after exercising dozens of branches (see M-1 list), reducing fault localization.

#### L-8. Minor naming/structure nits
`json_msg`/`_reg` defined mid/bottom-of-file far from use (`test_cov_services_final.py:342-355`); `import pytest as _pytest` inside a test body (`:455`) instead of top-level import; `__import__("app.main", fromlist=["app"])` gymnastics (`:138`) where a plain top-level import works (it's imported by conftest anyway).

---

## Coverage Gap Matrix

Real executed coverage: **91.49%** (6,768 stmts / 576 missed). Legend: ✅ dedicated test file exists · 🟡 partial (indirect/exercise-only or <90%) · ❌ no meaningful direct tests.

### Endpoints (`app/api/v1/endpoints/`)

| Module | Cov | Status | Notes |
|---|---|---|---|
| auth.py | 96% | ✅ | phase2, security_hardening, local_mode; misses logout-ish arms 106,109 |
| ai_writing.py | 37%→95%* | 🟡 | covered via service-level tests; endpoint bodies thin (*final-run figure 95%) |
| chat.py | 78% | 🟡 | document/library/project/general modes tested; streaming arm 86-110 untested |
| citations.py | 90% | 🟡 | phase5 + cov sweep; rank/import guards partially (508-518 missing) |
| collaboration.py | 70% | 🟡 | relay internals + ws auth tested; presence/undo paths 303-337 untested |
| comments.py | 93% | 🟡 | thread CRUD via cov_endpoints_core; reply-resolution edge 92-98 missing |
| documents.py | 96% | ✅ | phase2 + cov_endpoints_core |
| export.py | 98% | ✅ | phase7_export full format matrix |
| graphs.py | 60%→100%* | ✅ | phase9_research_graphs |
| health.py | 97% | ✅ | incl. 503 db-down and redis-degraded paths |
| intelligence.py | 58%→100%* | ✅ | phase8 four features + dismiss flow |
| papers.py | 82% | 🟡 | upload/pipeline/status/stream/annotations yes; error arms 559-575 etc. missing |
| plugins.py | 91% | ✅ | phase9_plugins incl. security-relevant entrypoint validation |
| projects.py | 91% | ✅ | guards/list/owner_id scoping |
| provider_settings.py | 97% | ✅ | roundtrip, validation, masked keys |
| provider_status.py | 83%→100%* | ✅ | lifecycle + auth_enforcement |
| research.py | 39%→100%* | ✅ | literature_search endpoint class (validation, aggregation) |
| teams.py | 93% | ✅ | RBAC lifecycle + error paths (quality_gates) |
| version_history.py | 89% | 🟡 | full lifecycle + diff arms; restore edges 214-220 missing |
| zotero.py | 60%→100%* | ✅ | import/sync/dedup/invalid-json |

### Core (`app/core/`)

| Module | Cov | Status | Notes |
|---|---|---|---|
| config.py | 98% | ✅ | CORS validator, prod guards, secret-key rules |
| constants.py | 100% | ❌ | trivial constants; no dedicated file (acceptable) |
| database.py | 57% | 🟡 | pragma listener + get_db tested; engine init/url branching untested |
| http_client.py | 32%→100%* | ✅ | pool lifecycle, dead-loop survival, loop rebinding |
| middleware.py | 47%→100%* | ✅ | envelope 500 shape |
| rate_limit.py | 97% | ✅ | sliding window, XFF extraction, dependency wrapper |
| text_utils.py | 96% | ✅ | 21 dedicated style tests + sweep arms |

### Models (`app/models/`)

All models: 🟡 indirect. Only `test_models_and_auth.py` (3 tests) touches them directly (user/owner/membership/project/paper/document/citation basics). **❌ dedicated tests:** annotation.py, chunk.py, comment.py, plugin.py, version.py (exercised only through endpoints). Property/cascade/constraint behaviors (FK cascade on project delete, unique constraints, JSON column round-trip fidelity) are untested at model level.

### Schemas (`app/schemas/models.py`, 99%) — 🟡 implicit via endpoint validation; no dedicated validator/serializer tests (acceptable given density, but 783-798 misses are validator branches).

### Services (`app/services/`)

| Module | Cov | Status | Notes |
|---|---|---|---|
| ai_writing_service.py | 95% | ✅ | 9 actions, reversibility, LLM-only honesty |
| auth.py | 94% | ✅ | tokens, authenticate, local fallback |
| export/* (ast_parser, bibtex, docx, markdown, pdf, service, options) | 94-98% | ✅ | strong matrices; csl_formatter 75% 🟡 (styles 167-207 partially swept) |
| graph_service.py | 91% | 🟡 | happy paths; centrality/co-citation arms 223-225 etc. |
| identifier_resolver.py | 98% | ✅ | exhaustive parsing; ⚠ one live-net test (H-3) |
| intelligence_service.py | 92% | ✅ | claims/gaps/matrix/review + surrogate regression |
| literature_search_service.py | 13%→~95%* | ✅ | dedicated 29-test file, providers mocked at boundary |
| **llm_service.py** | **56%** | 🟡 | **worst core gap** — cloud arms 334-590 (M-4) |
| pdf_extractor.py | 89% | 🟡 | TEI/GROBID fallbacks yes; pdfplumber-heavy arms 316-369 untested |
| plugin_runtime.py / plugin_service.py | 19%→~95%* | ✅ | security validation excellent (os:system rejected etc.) |
| provider_cache_service.py | 22%→97%* | ✅ | but duplicated across two files (M-9) |
| provider_settings.py | 17%→~95%* | ✅ | store roundtrip, corrupt-store arms |
| rag_service.py | 83% | 🟡 | chunking/hybrid-search strong; synthesis arms 605-732, 779-804 untested |
| tabby_setup_service.py | 19%→97%* | ✅ | platform matrices, spawn/poll flows |
| zotero_service.py | 17%→85%* | 🟡 | import/sync/dedup yes; fetch/pagination 195-210 missing |

### Infra

| Area | Status |
|---|---|
| Alembic migrations (4 version files) | ❌ never executed (mocked only) — M-3 |
| `app/main.py` lifespan/startup | 🟡 root+lifespan smoke yes; middleware ordering/startup-failure paths no |
| WebSocket collaboration E2E | 🟡 first-message-auth + message types yes; concurrent-edit merge behavior no |

\* Where two numbers appear: first = collect-only artifact seen during inventory (imports only), second = final full-suite run. Trust the final-run figures quoted in prose.

---

## Positive Observations

1. **Real persistence, not mocked ORM.** In-memory SQLite with per-test create/drop and `dependency_overrides` means CRUD/RBAC tests exercise actual SQL, transactions, and constraints — the single biggest credibility win of this suite (conftest.py:53-67).
2. **Strong hermetic foundation.** Three autouse fixtures kill ambient Redis, force `ENVIRONMENT=test`, redirect provider-key storage into per-test `tmp_path`, reset rate limiters, and give each test a pristine event loop (conftest.py:24-51). This is textbook suite-level isolation.
3. **Genuine security testing.** Refresh-vs-access token separation (confused-deputy check `test_security_hardening.py:76-84`), WS first-message auth, registration-enumeration-safe errors (asserting the email does NOT appear), login 429 with Retry-After, plugin entrypoint allowlisting rejecting `os:system`/`subprocess:run` (`test_plugin_runtime_and_builtins.py`). These are behavior-pinning, adversarial tests — rare and valuable.
4. **Zero sleep-based tests; deterministic runtime** (105 s, 442/442 green, repeated collect stable). Time passage simulated by mutating expiry metadata instead of sleeping (correct instinct, needs the M-7 seam refinement).
5. **Excellent boundary mocking where it counts.** Literature search, LLM chain, and Tabby tests replace HTTP clients with hand-rolled fakes that record calls — enabling URL/header normalization assertions (`//chat` dedup check, Bearer key masking) that MagicMock-only styles miss.
6. **Regression-test culture.** Lone-surrogate UTF-8 500 regression (`test_claim_verification_tolerates_unpaired_surrogates`), arXiv October-ID disambiguation (`test_arxiv_october_month_not_doi`), winget-links fallback, dead-event-loop client close — these encode real incident history.
7. **Behavior-rich RAG verification.** Chunker semantics (abstract synthesis, overlap sub-chunking, table/equation chunks, idempotent re-index) and grounding rules (four chat modes, insufficient-evidence fallback, source-inspection contract) are asserted semantically, not just status-code-wise (`test_phase7_quality_gates.py:93-130`, `test_phase4_rag_and_chat.py:166-264`).
8. **CI is comprehensive beyond tests**: ruff, mypy (with `check_untyped_defs`), pip-audit, npm audit, docker builds — the ecosystem around the suite is healthy; it's the gate constant and a few fake asserts that betray it.

---

## Prioritized Recommendations

**P0 — this week**
1. Fix the gate (C-1): set `--cov-fail-under=91` immediately OR land llm_service arm tests (M-4) to clear 94 honestly; add a comment linking the ratchet policy. CI must be green-on-main again before any other quality work matters.
2. Kill the three tautological asserts (H-1) — 30 minutes of work, restores meaning to the security suite.
3. Quarantine the live-network test (H-3): mock the client (pattern already exists in `test_literature_search.py`), or mark `@pytest.mark.network` + default-deselect.

**P1 — next sprint**
4. Rewrite or relocate the accessibility quartet (H-2): contrast math must consume real web tokens; shortcut/i18n checks move to `apps/web` vitest.
5. Split the five mega-tests along step boundaries (H-4); pin ask-AI to the deterministic 503 path and add a mocked-200 sibling (H-5).
6. Purge the six weak/disjunctive assertions listed in M-1 and rename `test_cov_*`/`*_coverage` files to domain names.
7. Conftest consolidation (M-2): `registered_user`/`auth_headers`/`project`/`sample_pdf_bytes` fixtures + shared `tests/fakes.py`; delete the parallel engine in `test_models_and_auth.py`.

**P2 — next quarter**
8. Migration-drift test + Postgres CI leg (M-3/M-8): `upgrade head` on scratch DB + autogenerate-compare; service-container job for models/endpoints subset.
9. Register marker taxonomy (`unit/integration/network/slow/e2e`) and `filterwarnings` policy (M-5).
10. Standardize async on pytest-asyncio strict/auto; delete manual-loop helpers (M-6).
11. Introduce `time_fn` seam into `ProviderCacheService`; replace private-dict time-travel and enable precise TTL tests (M-7); monkeypatch-based resets for `collab_manager` and `http_client` singletons.
12. Close remaining 🟡 service gaps in descending risk order: `llm_service` cloud arms → `rag_service` synthesis (605-732) → `collaboration` endpoint undo/presence (303-337) → `zotero_service` pagination → `pdf_extractor` pdfplumber arms.

**Target end-state:** gate honest and green, zero non-verifying asserts, one async idiom, one DB-infra definition, migrations executable, and the strong behavioral core (security, RBAC, RAG, exporters) preserved intact — it is genuinely good and worth protecting from the coverage-sweep habits that grew around it.
