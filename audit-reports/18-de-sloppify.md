# De-Sloppify Audit — OpenResearch `apps/api` (Audit-Only, Read-Only)

**Date:** 2026-08-26 · **Mode:** AUDIT ONLY — no file was formatted, removed, or modified. Every command below was a read-only diagnostic.
**Skill:** de-sloppify 7-step pipeline (adapted from .NET to the Python/ruff/mypy toolchain of this repo).

---

## Scope & Methodology

### Scope
| Item | Value |
|---|---|
| Root | `C:\Users\moham\Pictures\OpenResearch\apps\api` |
| Python files | **120** (app: 75, tests: 40, alembic: 5) — `__pycache__` excluded |
| Total lines | **20,489** (`Get-Content | Measure-Object -Line`) |
| Tool versions | ruff 0.16.4, mypy (venv), pytest configured via `pyproject.toml` |
| Lint config | `select = ["E","F","W","I"]`, `ignore = ["E501","E741","B008"]`, `exclude = [".venv","alembic"]` |
| mypy config | `check_untyped_defs = true`, `ignore_missing_imports = true`, excludes alembic/.venv |

### Commands run (all read-only)
```
.\.venv\Scripts\ruff.exe --version
.\.venv\Scripts\ruff.exe check app tests alembic --statistics
.\.venv\Scripts\ruff.exe check app tests alembic                       # full detail
.\.venv\Scripts\ruff.exe check app tests alembic --select F401,F841,I001,W291,W293,E711,E712,E722,B,C4,ARG,RET,SIM,RUF,PLW --output-format concise
.\.venv\Scripts\ruff.exe check app tests alembic --select ... --statistics
.\.venv\Scripts\ruff.exe check app tests alembic --select E501,E741,W29 --statistics
.\.venv\Scripts\ruff.exe format --check app tests alembic              # DRY-RUN only
.\.venv\Scripts\ruff.exe format --check <file>                         # per-file loop (120 files) to count + isolate crash
.\.venv\Scripts\mypy.exe app                                           # read-only type analysis
rg -n "TODO|FIXME|HACK\b|XXX" app / tests / alembic
rg -n "asyncio\.shield|CancelledError|asyncio\.wait_for|asyncio\.timeout|threading\.Event" app
rg -n "while True" app · rg -n "threading\.|Thread\(" app · rg -n "StreamingResponse|text/event-stream" app/api
rg -n "^\s*#\s*(import |from \w|def |class |return |print\()" app      # commented-out code
rg -n "@dataclass|frozen=True|@final|Protocol\b|ABCMeta|\(ABC\)" app tests
rg -oN "^class (\w+)\(([^)]+)\)" app -r '$1 <- $2'                     # inheritance edge map
rg -n "# noqa|# type: ignore" app tests alembic
Custom PowerShell symbol index: every top-level def/class/assignment in app/** (436 symbols)
  → single ripgrep pass `rg -o -w -N -f names.txt app tests alembic` → per-symbol reference counts
    → candidates where refs ≤ definition-sites (+ decorator registration allowance).
Settings-flag audit: 28 fields extracted from config.py → cross-referenced as `settings.<NAME>` repo-wide.
BOM scan (EF BB BF) + CRLF/LF census over all 120 files.
Stale-bytecode scan: *.pyc under app/** whose source no longer exists.
```

### Tooling incident (disclosed)
`ruff format --check` **panicked** (ruff 0.16.4 upstream bug, `ruff_annotate_snippets/source_map.rs:185`,
“Annotation range `0..12320` is beyond the end of buffer `12318`”) when rendering diffs for **4 test files**
(`test_identifier_resolver.py`, `test_pdf_extractor.py`, `test_pdf_extractor_helpers.py`, `test_provider_cache_service.py`).
A per-file loop isolated them; those 4 are **presumed unformatted** (they also carry BOMs and >88-char lines) but their exact diff could not be rendered. Exit code 101 on directory runs is caused solely by this crash.

---

## Executive Summary

The application code (`app/` + `tests/`) is in **excellent lint and type health**: `ruff check app tests` returns **zero violations** under the project's own rule selection, and `mypy app` reports **"Success: no issues found in 75 source files."** The codebase contains **zero TODO/FIXME/HACK/XXX markers** (prior-audit claim independently verified) and **zero commented-out code blocks**.

Debt is concentrated in two places:

1. **Formatting drift is near-total:** **98 of 120 files (82%)** would be rewritten by `ruff format` (+4 crash-unknown ⇒ up to 102). This is mechanical churn, entirely safe to autofix in one dedicated commit.
2. **Async cancellation hygiene has real gaps** (the Python analog of Step 7): the SSE chat endpoint streams through a **sync generator**, so client disconnects never cancel the upstream LLM HTTP stream; and shutdown closes the HTTP pools but **never cancels the collaboration Redis relay task nor closes its pubsub connection**.

Additionally: **3 dead Pydantic schema classes**, **1 dead settings flag**, **2 stale `.pyc` artifacts from deleted modules**, **11 `raise … from` omissions**, **2 mutable class-attribute defaults**, and **19 leaf service classes that are safe `@final` candidates**.

| Pipeline step | Finding count | Severity peak |
|---|---|---|
| 1. Format drift | 98–102 / 120 files | MEDIUM |
| 2. Unused imports/vars | F401 ×1, F841 ×0 (app/tests: 0/0); extended RUF059 ×55, ARG ×211 | LOW |
| 3. Analyzer warnings | 0 (configured scope) · 7 w/ alembic · 542 extended ruleset | MEDIUM (B904, RUF012) |
| 4. Dead code | 3 schemas + 1 flag + 2 stale .pyc; 0 functions; 0 comment blocks | MEDIUM |
| 5. TODO/FIXME/HACK | **0** (verified) | INFO ✅ |
| 6. Class design | 19 final-candidates, 1 frozen-candidate, 2 RUF012, 0 misuse | MEDIUM (design hardening) |
| 7. Cancellation analog | 1 HIGH sync-SSE gap, 1 HIGH shutdown leak, 6 lesser findings | HIGH |

---

## Step-by-Step Findings

### Step 1 — Formatting drift (`ruff format --check`, dry-run)

**Severity: MEDIUM** · **Count: 98 confirmed + 4 unknown (crash) = up to 102 of 120 files (85%)**

Per-area breakdown:

| Area | Files | Unformatted | Rate |
|---|---|---|---|
| `app/` | 75 | **62** | 82.7% |
| `tests/` | 40 | ≥31 (+4 unknown) | ≥77.5% (up to 87.5%) |
| `alembic/` | 5 | **5** | 100% |
| **Total** | **120** | **98–102** | **81.7–85%** |

Unformatted app files: `app\main.py`; endpoints `ai_writing, auth, chat, citations, collaboration, comments, documents, export, graphs, intelligence, papers, plugins, projects, provider_settings, teams, version_history, zotero` (17 — note `health.py`, `research.py`, `provider_status.py` are clean); core `config, database, http_client, rate_limit, text_utils` (5 — `constants.py`, `middleware.py` clean); all 12 models; all 5 plugins; `schemas\models.py`; 14 top-level services; all 7 `services/export/*`.

Representative drift patterns (from dry-run diffs):
- Multi-kwargs-per-line constructor calls exploded to one-per-line (dominant pattern; e.g., `tests\test_cov_services_final.py:452-469`, `tests\test_cov_papers_citations.py:97-108`).
- Chained `.status_code == 404` asserts re-wrapped into parenthesized multi-line form (`tests\test_cov_papers_citations.py:85-93`).
- Quote normalization `'` → `"` in Alembic migrations (`alembic\versions\180baac94a46_add_users_is_admin.py:15-17` etc.).
- Blank-line insertion before nested defs (`tests\test_cov_ai_chat…:520-522`).

Encoding anomalies found by byte-level scan:
- **UTF-8 BOM present in 6 test files** (ruff format strips it): `tests\test_cov_final_sweep.py`, `tests\test_cov_services_final.py`, `tests\test_identifier_resolver.py`, `tests\test_pdf_extractor.py`, `tests\test_pdf_extractor_helpers.py`, `tests\test_provider_cache_service.py`.
- Line endings uniform: **LF-only in all 75 app files; zero CRLF** — good.

Suppressed-but-real style debt: **E501 line-too-long ×1407** and **E741 ambiguous name `l` ×3** exist but are silenced by config `ignore = ["E501","E741",…]`. E741 locations (rename `l` → `line`/`ln`, trivially safe): `app\services\intelligence_service.py:269`, `app\services\intelligence_service.py:290`, `app\services\pdf_extractor.py:427`.

Tooling note: the ruff 0.16.4 diff-renderer panic (see Methodology) blocks CI adoption of `format --check` until either ruff is upgraded past the bug or the 4 BOM'd long-line files are pre-formatted once.

**Proposed action:** run `ruff format app tests` as a standalone commit (Step-1 commit per skill), then re-run pytest. Do not enable E501 enforcement now (1,407 sites would flood review); revisit after formatting lands since most E501s collapse when calls are wrapped.

---

### Step 2 — Unused imports & variables (F401/F841 inventory)

**Severity: LOW**

Under the project's configured rules across `app + tests`: **F401 = 0, F841 = 0.** Clean.

Including `alembic/` (explicitly passed on CLI):

| Rule | Location | Detail |
|---|---|---|
| F401 | `alembic\env.py:7` | `from app.models import …` imported but unused in env (likely intended for `target_metadata` autogenerate support — verify intent before removing; if kept, add `# noqa: F401` with reason) |

Extended hygiene sweep (rules not currently enabled) — mostly intentional DI seams and test-double signatures, listed for completeness:

| Rule | Count | Where | Assessment |
|---|---|---|---|
| ARG005 unused lambda argument | 100 | overwhelmingly `tests\test_tabby_autocomplete.py`, `tests\test_tabby_setup_service_coverage.py`, `tests\test_cov_services_final.py` | Intentional stub lambdas matching call signatures — cosmetic only |
| ARG001 unused function argument | 70 | e.g. `current_user` auth guards in `plugins.py`, `provider_settings.py`, `provider_status.py`, `research.py` | **Intentional** FastAPI security dependencies; do NOT remove parameters (removal would drop the auth side effect). Rename to `_current_user` if desired |
| RUF059 unused unpacked variable | 55 | `tests\test_pdf_extractor_helpers.py` (×34 destructures used positionally), others | Test fixtures discarding tuple slots — acceptable |
| ARG002 unused method argument | 39 | fake clients/test doubles (`args`,`kwargs`,`a`,`k`) | Intentional |
| ARG004 unused static method argument | 2 | `tests\test_tabby_setup_service_coverage.py:183` | Intentional |

One production-code item worth noting: `app\services\tabby_setup_service.py:274` — `RUF059 Unpacked variable base_url is never used` inside a real service path (dead unpack; candidate for removal after verification).

Import-sorting: I001 ×5, **all in alembic** (`env.py` + 4 version files); app/tests fully sorted. W291 trailing whitespace ×1: `alembic\versions\ec9eb70fcc96_initial_schema.py:4` (`Revises: ` header).

**Proposed action:** nothing urgent; optionally fix the single F401 and tabby RUF059 manually; leave ARG-family alone (or configure per-file ignores for tests).

---

### Step 3 — Analyzer warnings summary (by rule)

**Severity: MEDIUM aggregate (a handful of correctness-adjacent rules), otherwise INFO**

Baseline (project's own select, app+tests): **0 errors**. With alembic included: **7 errors** (5×I001, 1×F401, 1×W291 — see Steps 1–2).

Extended ruleset (`B,C4,ARG,RET,SIM,RUF,PLW,I001,W291,F401,F841`) statistics — **542 findings**:

| Rule | Count | Meaning | Triage |
|---|---|---|---|
| B008 | 171 | `Depends(...)` in argument defaults | Idiomatic FastAPI; already ignored in config — ignore |
| ARG005/001/002/004 | 211 | unused args/lambdas | See Step 2 — intentional |
| RUF059 | 55 | unused unpacked vars | Tests mostly |
| RET504 unnecessary assign before return | 12 | e.g. `papers.py:245,369`, `projects.py:55,66`, `auth.py:44`, `ai_writing_service.py:297`, `version_history.py:79`, `csl_formatter` chain | Cosmetic |
| B904 raise-without-from-inside-except | **11** | `plugins.py:51,78`, `provider_settings.py:82,97,124` (endpoint) + `provider_settings.py:86` (service) | **MEDIUM** — exception chaining lost; add `from exc`/`from None` |
| RET505 superfluous else/elif return | 10 | `config.py:53`, `text_utils.py:49,72,209`, `identifier_resolver.py:65`, `export\service.py:51`, `csl_formatter.py:54`, `provider_cache_service.py:79` | Cosmetic |
| PLW0603 global statement | **9** | `http_client.py:45,61,83,103` (client singletons) | Accepted singleton pattern; encapsulate later if desired |
| RET501 explicit return None | 9 | `papers.py:340,465`, `projects.py:117`, `teams.py:166,296`, `provider_settings.py:322` | Cosmetic |
| B023 function uses loop variable | **6** | `intelligence_service.py:422,426,427,434,435,438` | **Verified benign**: `make_cell` closes over loop vars `chunks`/`paper` but is *invoked within the same iteration* (lines 441-443) before rebinding — late-binding bug cannot trigger. Add `default=` bind or restructure to silence future regressions |
| PLW0108 unnecessary lambda | 6 | test doubles | Cosmetic |
| I001 / RUF022 | 5+5 | unsorted imports / `__all__` | All fixable; alembic + 3 `__init__` files + `export_service.py` |
| SIM105 suppressible exception | 5 | incl. `tests\test_cov_services_final.py:56` | Cosmetic |
| C403 set(list-comp) | 4 | — | Autofixable |
| RUF001/RUF002 ambiguous unicode | 3+2 | Greek letters in `pdf_extractor.py:47-50` regexes (intentional α/γ/σ), en-dash docstring `rag_service.py:510` | Intentional — per-line noqa |
| PLW2901 loop var overwritten | 2 | `llm_service.py:402,427` (`line = line.strip()`) | Benign idiom |
| RUF012 mutable class default | **2** | `ai_writing_service.py:50`, `intelligence_service.py:362` | **MEDIUM** — annotate `ClassVar[...]` or use field factory; shared-mutable risk |
| RUF100 unused noqa | 2 | `http_client.py:65`, `literature_search_service.py:82` (BLE001 not enabled) | Remove or enable BLE |
| PLW1510 subprocess.run without check | 1 | `tabby_setup_service.py:69` (version probe, output inspected) | LOW — add `check=False` explicitly for clarity |
| B905 zip without strict= | 1 | `rag_service.py:95` | LOW — add `strict=False` explicitly |
| SIM102/108/114/300, C416, B007, RUF005/010, W291, F401 | ≤1 each | misc | Autofixable/manual trivial |

**mypy (read-only):** `Success: no issues found in 75 source files.` Type-hygiene is a strength here. Suppression census: only **3 pragmatic suppressions** repo-wide (`# noqa` ×2, `# type: ignore[assignment]` ×1 at `provider_cache_service.py:19`) plus 1 in tests — very low for 20k LOC.

---

### Step 4 — Dead code candidates

**Severity: MEDIUM (schemas), LOW (flag), INFO (bytecode)**

Method: 436 top-level symbols indexed from `app/**` (defs + classes + module assignments), then a single word-boundary ripgrep across `app tests alembic` counted references per symbol; candidates = symbols whose total reference count ≤ number of definition sites (with an allowance for decorator-only registration). Every non-endpoint candidate was then individually verified by reading its site and grepping its exact name repo-wide (appendix below).

Results:

**(a) Dead functions/classes/methods: 0.** All 88 low-ref candidates resolved as FastAPI route handlers registered via decorators (86 single-line decorators + 6 multi-line decorators initially missed by the heuristic — `add_paper_by_identifier`, `create_citation`, `create_comment_reply`, `import_bibtex`, `upload_paper` — all confirmed decorated at `@router.post(...)` spanning multiple lines).

**(b) Dead Pydantic schema classes: 3** — defined in `app\schemas\models.py`, referenced nowhere else in the repo (not even in strings):

| Symbol | Defined | Verdict |
|---|---|---|
| `ExportResponse` | models.py:545 | DEAD — export endpoints stream raw bytes via `StreamingResponse`; this response model was superseded |
| `PaperChunkResponse` | models.py:326 | DEAD — chunk payloads are returned inline inside `RAGSearchResponse.passages`, not via this model |
| `ClaimDismissRequest` | models.py:584 | DEAD — claim verification exists (`ClaimVerificationRequest/Response`), no dismiss endpoint was ever wired |

Caveat: these names could exist in frontend TS types generated earlier, but they are unreachable from this backend and inflate the OpenAPI surface only if actually referenced by routes — they are not.

**(c) Dead settings flag: 1** — `DEFAULT_LLM_PROVIDER` (`app\core\config.py:71`): defined, default `"ollama"`, referenced by **nothing** (no `settings.DEFAULT_LLM_PROVIDER`, no `getattr`). Contrast with `PLUGIN_ALLOWED_MODULE_PREFIXES`, which looked unreferenced by direct attribute but IS consumed via `getattr(settings, …)` at `plugin_runtime.py:32` — so only DEFAULT_LLM_PROVIDER is truly dead. Provider choice is evidently hardcoded per-credential in `llm_service`.

**(d) Stale compiled artifacts: 2** — bytecode for deleted modules still shipped in-tree:
- `app\api\v1\endpoints\__pycache__\evaluation.cpython-311.pyc` (source `evaluation.py` deleted)
- `app\services\__pycache__\eval_service.cpython-311.pyc` (source `eval_service.py` deleted)

Harmless at runtime (Python won't import orphaned pyc in normal mode) but confusing to auditors and grep-based tooling; delete the two files (or nuke all `__pycache__`).

**(e) Commented-out code blocks: 0** — pattern sweep for commented `import/from/def/class/return/print` lines across `app/` returned nothing. Inline explanatory comments abound (healthy).

**(f) Unused endpoint/router wiring: 0** — `app\api\v1\api.py` mounts all 20 endpoint routers (lines 27–46); no orphan router modules.

**(g) Unreachable branches:** none detectable statically; `while True` loops all have exits (WS rate-limit break at `collaboration.py:277-278`, upload EOF break at `papers.py:108-109`, splitter tag-consumption at `llm_service.py:581`).

---

### Step 5 — TODO/FIXME/HACK inventory

**Severity: INFO (none found — positive finding)**

Commands: `rg -n "TODO|FIXME|HACK\b|XXX"` over `app/`, `tests/`, `alembic/` — **zero matches in each**. Case-sensitive sweep covers the standard conventions; combined with Step 4's zero commented-out code, the prior audit's "zero TODOs" claim is **independently CONFIRMED**. No age/context assessment possible or needed. Debt tracking evidently lives outside source comments (issue tracker), which is the preferred discipline.

---

### Step 6 — Class design (Python analog of sealed-class audit)

**Severity: MEDIUM (hardening suggestions), no outright misuse**

Census: **152 classes in `app/`**. Inheritance-edge map (every `class X(Base)` captured):

| Base | Subclasses | Assessment |
|---|---|---|
| `Base` (SQLAlchemy DeclarativeBase) | 13 models | Framework-mandated inheritance — correct |
| `BaseModel` (Pydantic) | ~115 schemas | Correct; exactly **one** intra-schema subclass: `AutocompleteSettingsResponse(AutocompleteSettings)` (models.py:476) |
| `BaseSettings` | `Settings` | Correct |
| `BaseHTTPMiddleware` | `GlobalErrorEnvelopeMiddleware`, `RequestTracingMiddleware` | Correct, but note Starlette BaseHTTPMiddleware interacts poorly with streaming/SSE disconnect propagation (see Step 7, INFO) |
| `RuntimeError/Exception/ValueError` | `AIProviderUnavailableError`, `PDFExtractionError`, `PluginEntrypointError`, `ZoteroAPIError` | Correct custom exceptions |
| `canvas.Canvas` | `NumberedCanvas` (pdf_exporter.py) | Correct reportlab pattern |

Findings:

1. **No ABCs, no Protocols, no virtual-base machinery anywhere** (`rg Protocol|ABC|ABCMeta` → only prose hits). All polymorphism is duck-typed. That keeps things simple but means plugin/provider contracts are convention-only; consider one `typing.Protocol` for the provider/plugin seam when it next changes (INFO).
2. **19 leaf classes never subclassed anywhere** — prime `@typing.final` candidates (the repo has zero uses of `final`/`frozen` today). These are instantiated as module-level singletons or static utility holders, so subclassing is not part of any contract:
   `ResearchGraphService`, `SlidingWindowRateLimiter`, `ParsedBlock`, `LiteratureSearchService`, `PDFValidator`, `PDFExtractorService`, `LLMService`, `_ThinkTagSplitter`, `IntelligenceService`, `AIWritingService`, `IdentifierResolver`, `PluginService`, `ExportService`, `ProviderCacheService`, `EmbeddingService`, `RAGService`, `ZoteroService`, `CollaborationRoomManager`, plus `_SafeRequestId`-style helpers. Marking them `@final` documents intent and enables future devirtualization reasoning (LOW-MEDIUM value, zero risk).
3. **`ExportOptions` is a mutable `@dataclass`** (`export\options.py:8`, 4 plain fields, no defaults mutation downstream) — ideal `@dataclass(frozen=True)` (value object passed into every exporter). Verified consumers: `export_service.py`, `export\service.py`, `docx/markdown/pdf_exporter.py`, 3 test files — none mutate options after construction (MEDIUM-value hardening).
4. **`ParsedBlock` hand-rolls `__init__` with six attributes and a mutable-default guard** (`ast_parser.py:13-25`) — would be cleaner as a plain `@dataclass` (with `field(default_factory=dict/list)`); behavior-preserving refactor (LOW).
5. **Mutable class-attribute defaults flagged by RUF012 ×2**: `ai_writing_service.py:50`, `intelligence_service.py:362` — annotate as `ClassVar` or move into `__init__` to eliminate shared-state risk (MEDIUM).
6. **Inheritance misuse: none found** — no God-bases, no accidental overrides, no subclass-of-singleton abuse.
7. Private-by-underscore conventions are respected (`_ThinkTagSplitter`, `_relay_loop`, `_persist_doc_edit`); only cross-module private touch observed is tests poking `collab_manager._publish_async` / `pdf_extractor._extract_with_pdfplumber` (acceptable white-box tests).

---

### Step 7 — CancellationToken-analog: async cancellation hygiene

**Severity: HIGH (two systemic gaps), plus 5 lower items**

Inventory first (what exists):
- `asyncio.wait_for` ×1 — WS first-frame auth timeout, 10 s (`collaboration.py:177`). ✔
- `except asyncio.CancelledError` ×1 — relay loop (`collaboration.py:115`). ✔ (only cancellation-aware handler in the codebase)
- `asyncio.shield` ×0 — no shielded regions (nothing *needs* shielding today, but nothing protects the WS persist path either).
- `threading.Event` ×0. `threading.Lock` ×2 — both used exclusively via `with` (10 sites: `llm_service.py:54`; `provider_settings.py:95,103,172,183,202,228,253,275,300`) — **no acquire/release imbalance, no deadlock pattern**. ✔
- Daemon threads ×2 — fire-and-forget Tabby autostart (`main.py:59`, `provider_settings.py:128`); daemon=True so JVM-style exit isn't blocked; no join/stop handle (acceptable, LOW).
- Timeouts on outbound I/O — httpx `DEFAULT_TIMEOUT(15s/connect 10s)` + per-stream `_stream_timeout`; redis cache client pinned to `socket_timeout=1.0, socket_connect_timeout=1.0` (`provider_cache_service.py`). ✔ Strong.

Gaps and findings:

| # | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| 1 | **HIGH** | **SSE chat streaming is a *sync* generator → client disconnects never propagate cancellation into the LLM stream.** `event_stream()` is a plain generator wrapping `rag_service.stream_chat_response` → `llm_service._stream_*` which block in `httpx` sync `iter_lines()` inside a worker thread. When the browser aborts the SSE POST, Starlette cancels the response task but the threadpool thread stays blocked in the next `iter_lines()` until the server-side stream ends; tokens keep flowing from the upstream provider (cost/quota leak) and the thread slot is held. | `chat.py:70-114` (sync `def project_chat_stream`, sync gen at :98), `llm_service.py:389-422` (sync `client.stream`), contrast the *correct* async path `ai_writing.py:61-84` (`async def stream_autocomplete` → async generator `ai_writing_service.stream_autocomplete:161`) | Abandoned chats burn provider quota; under load, threadpool exhaustion |
| 2 | **HIGH** | **Shutdown leaks the collaboration background machinery.** `lifespan` closes only the HTTP pools (`main.py:60-62`). `collab_manager._relay_task` (created lazily on first connect, `collaboration.py:90`) is never cancelled, and `collab_manager.redis_client` pubsub is never `aclose()`d. On SIGTERM the process relies on interpreter teardown to kill the pubsub listener mid-frame; with uvicorn reload/worker recycling this can strand a Redis subscription and log noisy task-destroyed-pending warnings. | `main.py:53-62` vs `collaboration.py:74-119` | Unclean restarts, dangling subscriptions in multi-worker deploys |
| 3 | MEDIUM | Relay-loop error path leaves a **stale completed task handle**: on generic `Exception` it sets `self._relay_task = None` *from inside* the coroutine (`collaboration.py:117-118`), but on the normal/CANCELLED exit path `_relay_task` still references a done task, and there is no `finally` reset — `_ensure_relay()` will refuse to restart after a CancelledError-induced stop (`_relay_task is not None`), permanently disabling cross-worker fan-out until process restart. | `collaboration.py:87-118` | Silent degradation of horizontal-scaling broadcast |
| 4 | MEDIUM | Over-broad exception swallow in WS auth: `except (asyncio.TimeoutError, WebSocketDisconnect, json.JSONDecodeError, Exception)` — the trailing `Exception` subsumes the other three (and hides coding errors like `AttributeError`) while closing with policy-violation 1008 regardless of cause; also swallows `CancelledError`'s cousins only accidentally (CE is BaseException, correctly *not* caught). Narrow to the three real cases. | `collaboration.py:179` | Debuggability; masks genuine bugs as auth failures |
| 5 | LOW | Blocking DB persistence off the event loop is correct (`anyio.to_thread.run_sync(_persist_doc_edit…)`, `collaboration.py:321-323`; `papers.py:86`), but once dispatched it is **not cancellable** — a disconnect during a slow write lets the write finish (fine) while broadcast afterwards targets a disconnected socket and is swallowed (`except Exception: pass`, `collaboration.py:151-154`). Behavior is acceptable; document that `to_thread` regions are cancellation barriers. | cited lines | INFO-level semantics |
| 6 | LOW | Upload streaming loop is well-formed (`papers.py:101-132`): size-bounded `while True` with EOF break, partial-file cleanup on failure (`os.remove` guarded by `OSError`), header validation on first chunk. Only nit: `HTTPException` raised inside `_stream_to_disk` is caught by its own broad `except Exception:` cleanup clause and re-raised — works, but a `finally`-based cleanup would be clearer. | `papers.py:104-130` | Clarity |
| 7 | INFO | Both observability middlewares derive from `BaseHTTPMiddleware` (`middleware.py:21,~60`), which historically buffers/breaks disconnect propagation for streaming responses; with the current sync-SSE design (#1) the combination guarantees no cancellation reaches the LLM layer. Moving chat streaming to the async-generator pattern (#1's fix) largely neutralizes this. | `middleware.py` | Architectural note |

Positive cancellation behaviors worth keeping: async-gen autocomplete path; explicit httpx timeouts everywhere including streams; bounded WS frame size (512 KB) and sliding-window message rate limit (120/10 s) with clean `break`+close (`collaboration.py:266-279`); locks always via context manager; redis cache timeouts pinned to 1 s.

---

## Dead-Code Verification Appendix

Format: **symbol → searched-where → verdict**. Search = `rg -w <name>` (word-boundary) across `app/ tests/ alembic/` excluding `__pycache__`, plus manual file reads.

| Symbol | Searched where | Raw refs | Verdict |
|---|---|---|---|
| `ExportResponse` | app, tests, alembic (whole-repo rg) | 1 (=def models.py:545) | **DEAD** — no route, no import, no string ref |
| `PaperChunkResponse` | same | 1 (=def models.py:326) | **DEAD** |
| `ClaimDismissRequest` | same | 1 (=def models.py:584) | **DEAD** |
| `DEFAULT_LLM_PROVIDER` | app, tests (incl. `getattr(settings,…)` variants) | 1 (=config.py:71) | **DEAD FLAG** |
| `PLUGIN_ALLOWED_MODULE_PREFIXES` | app, tests | 4 (def + getattr runtime.py:32 + test monkeypatch ×2) | ALIVE (indirect getattr) — keep |
| `add_paper_by_identifier` | citations.py read @250-274 | def + multi-line `@router.post` | ALIVE (route) — heuristic false positive |
| `create_citation` | citations.py read @160-168 | same | ALIVE (route) |
| `create_comment_reply` | comments.py read @117-128 | same | ALIVE (route) |
| `import_bibtex` | citations.py read @313-323 | same | ALIVE (route) |
| `upload_paper` | papers.py read @55-64 | same | ALIVE (route) |
| remaining 83 ep-flagged candidates (`get_health`, `list_projects`, `websocket_collaboration`, …) | api.py include_router map (all 20 routers mounted, lines 27-46) + decorator presence | def(+tag refs) | ALIVE (decorator-registered routes) |
| `evaluation` / `eval_service` (modules) | glob sources vs `__pycache__` contents | sources absent | **STALE BYTECODE** ×2 — delete pyc |
| TODO/FIXME/HACK/XXX | rg app/tests/alembic | 0 | Confirmed none |
| commented-out code (`^\s*#\s*(import\|from \|def \|class \|return \|print\()`) | rg app | 0 | Confirmed none |
| `asyncio.shield` / `threading.Event` | rg app | 0 | Absence documented in Step 7 |

Heuristic limitation (disclosed): a symbol used *only* elsewhere within its own defining module can exceed the refs≤defs threshold and escape detection; manual spot-checks of services/__init__ re-export chains surfaced no such case beyond the schema trio above.

---

## Positive Observations

1. **Zero lint violations in app+tests under the project's own ruleset**; mypy fully clean across 75 files with `check_untyped_defs` — rare discipline at this LOC scale.
2. **Zero TODO/FIXME/HACK/XXX and zero commented-out code** — debt is tracked externally, exactly as de-sloppify prescribes.
3. **Only 3 suppression comments in 20k LOC** (2 noqa, 1 type-ignore), each with a written justification.
4. Security-minded WS design: first-frame JWT auth with 10 s timeout, 512 KB frame cap, sliding-window rate limit, server-owned identity fields, membership re-verification.
5. Bounded resource handling everywhere: capped uploads with partial-file cleanup, LRU cache with max_entries, 1 s redis timeouts, pooled httpx clients with loop-affinity rebinding guards.
6. Uniform LF line endings; imports fully sorted in app/tests; consistent module-singleton service pattern.
7. Honest, well-scoped docstrings referencing spec sections (§-anchors) — high navigability.

---

## Prioritized Cleanup Plan

### Safe to autofix (single dedicated commits, run pytest between)
1. **Commit A — `chore: apply ruff format`**: `ruff format app tests` → resolves Step 1 wholesale (98–102 files). First strip the 6 UTF-8 BOMs (format does this automatically). ⚠️ Upgrade ruff past 0.16.4 first or pre-format the 4 panic files individually, else CI `--check` will crash.
2. **Commit B — `chore: sort imports and __all__`**: `ruff check --fix --select I001,RUF022,C403,RUF010,SIM300,SIM114` (35 auto-fixables incl. alembic quote normalization via format).
3. **Commit C — `chore: remove dead code`** (manual-but-trivial deletions): `ExportResponse`, `PaperChunkResponse`, `ClaimDismissRequest` from `schemas/models.py`; `DEFAULT_LLM_PROVIDER` from `config.py`; `base_url` dead unpack `tabby_setup_service.py:274`; 2 stale `.pyc` files; unused `noqa: BLE001` ×2 (or enable BLE001).
4. Re-run gates after each commit: `ruff check app tests && ruff format --check app tests && mypy app && pytest`.

### Manual (small, ordered by risk-reduction value)
5. **Cancellation fixes (Step 7 #1/#2/#3)** — highest value:
   - Convert `chat.py` SSE to an `async def` endpoint + async generator (mirror `ai_writing.py` pattern), or wrap the sync stream with `anyio.to_thread` + a cancellation event checked per frame; ensures disconnect cancels the upstream `httpx` stream.
   - In `lifespan` shutdown: `if collab_manager._relay_task: _relay_task.cancel(); await asyncio.gather(task, return_exceptions=True)` and `await collab_manager.redis_client.aclose()`.
   - Reset `_relay_task` in a `finally` inside `_relay_loop` so `_ensure_relay` can restart.
   - Narrow `collaboration.py:179` except-tuple to `(asyncio.TimeoutError, WebSocketDisconnect, json.JSONDecodeError)`.
6. **B904 ×11** — add `raise … from exc`/`from None` in plugins/provider_settings except blocks (mechanical, low-risk).
7. **RUF012 ×2** — `ClassVar` annotations for mutable class defaults (`ai_writing_service.py:50`, `intelligence_service.py:362`).
8. **Class hardening (Step 6)** — `@dataclass(frozen=True)` on `ExportOptions`; convert `ParsedBlock` to dataclass; add `@typing.final` to the 19 leaf service/utility classes; bind loop vars in `intelligence_service.make_cell` (default-arg or local capture) to retire B023.
9. **Cosmetics batch** — RET501/RET504/RET505 (31 sites), E741 rename `l` ×3, `zip(strict=False)`, explicit `check=False` on the subprocess probe, B905/B007/SIM leftovers.
10. **Policy decisions (config, not code)** — keep `ignore=["E501"]` for now (revisit post-formatting; ~most long lines vanish after wrapping); consider enabling `B`, `RET`, `SIM` selectively with per-file ignores for tests' ARG/RUF059 noise; add `__pycache__/` cleanliness to `.gitignore` audit if not ignored.

*Nothing in this plan was executed — repository untouched.*
