# Ruff Recursive Fix — Audit Report (OpenResearch API)

**Mode:** AUDIT-ONLY (no fixes applied, no source files modified)
**Target:** `apps/api` (Python backend, FastAPI + SQLAlchemy 2 + Alembic)
**Date:** 2026-08-26
**Skill:** `ruff-recursive-fix` (workflow executed through Step 1 "Baseline Analysis" only; Steps 2–4 — autofix/format/manual remediation — intentionally **skipped** per audit-only mandate. `--fix` was FORBIDDEN and never passed.)

---

## Scope & Methodology

### Environment

| Item | Value |
|---|---|
| Ruff version | **0.16.4** (verified via `apps\api\.venv\Scripts\ruff.exe --version`) |
| Config source | `apps/api/pyproject.toml` (`[tool.ruff]`, `[tool.ruff.lint]`) |
| Target version | `py311` |
| Alternate configs | None found (no `.ruff.toml` / `ruff.toml` anywhere under `apps/api`) |
| Formatter config | **Absent** — no `[tool.ruff.format]` section; `ruff format` has never been adopted |
| Per-file-ignores | **None configured** |

### Effective configuration (verbatim)

```toml
[tool.ruff]
target-version = "py311"
exclude = [".venv", "alembic"]

[tool.ruff.lint]
select = ["E", "F", "W", "I"]
ignore = ["E501", "E741", "B008"]
```

### Commands executed (all read-only)

```
& .\.venv\Scripts\ruff.exe --version
& .\.venv\Scripts\ruff.exe check app tests alembic --statistics
& .\.venv\Scripts\ruff.exe check app tests alembic                 # full listing
& .\.venv\Scripts\ruff.exe check app --select ALL --statistics
& .\.venv\Scripts\ruff.exe check tests --select ALL --statistics
& .\.venv\Scripts\ruff.exe check alembic --select ALL --statistics
& .\.venv\Scripts\ruff.exe check app --select <targeted sets> --output-format concise   # evidence extraction
```

Targeted evidence passes used: `B023,S314,S324,S603,S105,S106,ASYNC212,ASYNC230,PLW0603,SIM105`; `C901,PLR0912,PLR0913,PLR0915,PERF401,ERA001,C416,FURB171,PIE810,SIM114`; `B904,BLE001,S110,TRY300,TRY301,G004,SLF001,RUF012,PLW2901,PLC0415,FBT003`; `FAST002`; `N802,N806,A003,RUF001,RUF002,RUF005,RUF010,SIM102,SIM108,FURB110,B905,B007`.

### Key methodological note (coverage gap discovered)

`alembic` is excluded in `[tool.ruff]` but **`force-exclude` is not set**, so explicitly passing `alembic` on the CLI still lints it (Ruff default: excludes apply to *discovered* files, not *explicitly enumerated* ones unless `force-exclude = true`). Consequences:

- A bare `ruff check .` (typical CI invocation) **silently skips all migrations**.
- `ruff check app tests alembic` (this audit) lints them.
- Local and CI results can therefore diverge. This inconsistency is itself a finding (see Configuration Review).

### Skill output contract (audit-mode adaptation)

- **Scope/options:** `check app tests alembic` (configured set) + `--select ALL` expansions per directory.
- **Iterations:** 1 baseline pass; no fix loops (forbidden).
- **Autofixed findings:** 0 (none applied).
- **Manual fixes:** 0.
- **Suppressions added:** 0. Pre-existing suppressions reviewed: exactly **two** `# noqa: BLE001` comments, both narrow (single code, not bare `noqa`) with written rationale (`app/core/http_client.py:65`, `app/services/literature_search_service.py:82`). Both are justified — shutdown-path and fan-out-isolation catches where broad catching is correct behavior. Exemplary suppression discipline.
- **Remaining findings & required decisions:** everything below.

---

## Executive Summary

### Headline numbers

| Measurement | Count |
|---|---|
| Violations under **configured rule set** (E, F, W, I) | **7** |
| …of which in `app/` | **0** ✅ |
| …of which in `tests/` | **0** ✅ |
| …of which in `alembic/` | **7** |
| Violations under `--select ALL` — `app/` | **3,769** (1,229 safe-autofixable, +325 unsafe-fixable) |
| Violations under `--select ALL` — `tests/` | **4,719** (202 safe-autofixable, +612 unsafe-fixable) |
| Violations under `--select ALL` — `alembic/` | **79** |
| **Total under `ALL`** | **8,567** |
| Rule families completely unselected | ~30 (B, S, UP, ANN, ASYNC, C90, SIM, RUF, PERF, PL, FBT, TRY, EM, RET, ARG, PTH, TC, PIE, G, N, A, COM, D, CPY, INP, ERA, FURB, BLE, SLF, FAST…) |

The configured gate is extremely narrow: it enforces syntax-level errors, pyflakes, trivial whitespace, and import sorting only. It passes almost vacuously — the codebase carries thousands of latent issues the gate cannot see.

### Severity summary (judgment-weighted, `app/` focus)

| Severity | Count (approx.) | Character |
|---|---|---|
| **CRITICAL** | **1** | XXE-class XML parsing of external service response (S314) |
| **HIGH** | **9** | Late-binding closure bugs (B023 ×6), blocking file I/O & HTTP calls on the event loop (ASYNC230 ×2, ASYNC212 ×1) |
| **MEDIUM** | **≈196** | Silent exception swallowing (BLE001 ×35, S110 ×5, SIM105 ×5), exception chaining loss (B904 ×11), mutable class-state defaults (RUF012 ×2), subprocess surface (S603 ×1), dead parameters (ARG ×31), error-message hygiene (EM ×42, TRY003 ×42), design smells (PLW0603 ×9, PLW2901 ×2, SLF001 ×2) |
| **LOW** | **≈2,900** | Complexity (C901 ×32, PLR09xx ×71), performance idioms (PERF401 ×8), booleans-as-flags (FBT ×46), returns (RET ×29), pathlib (PTH ×17), logging f-strings (G004 ×7), typing modernization backlog (UP ×942), missing annotations (ANN ×148), line length (E501 ×1,401 across app+tests), misc (SIM, C4, RUF, N, A, ERA, B007, B905) |
| **INFO / expected noise** | **≈5,400** | Docstrings (D ×~600), copyright notices (CPY001 ×115), implicit namespace packages (INP001 ×85), FastAPI `Depends()` idiom false-positives (B008 ×171, FAST002 ×189 is real-but-mechanical), test asserts (S101 ×1,564), test fixture passwords (S106 ×16, S105 ×2), pytest style (PT ×~45) |

### Violations per rule family — `app/` under `ALL`

| Family | Rules represented | Total | Notes |
|---|---|---|---|
| UP (pyupgrade) | UP006 445, UP045 369, UP035 87, UP017 31, UP037 8, UP008 3, UP007 1, UP041 1 | **945** | Largest single family. `typing.List/Optional/Union` everywhere despite py311 target |
| D (pydocstyle) | D101 131, D212 112, D205 69, D103 58, D100 49, D102 43, D401 36, D200 35, D400/D415/D107/D104/D301 | **~567** | Docstring coverage poor in services layer |
| B (bugbear) | B008 171, B904 11, B023 6, B007 1, B905 1 | **190** | B008 is FastAPI-idiomatic (justified ignore); B023 is the real find |
| PL (pylint) | PLR2004 87, PLR0912 19, PLR0913 16, PLR0917 16, PLR0915 12, PLW0603 9, PLR0911 8, PLR1711 8, PLC0415 8, PLW2901 2, others 5 | **~191** | Magic values pervasive; 5 god-functions >50 statements |
| FAST (FastAPI) | FAST002 | **189** | Non-annotated dependencies; mechanical but large migration |
| ANN (flake8-annotations) | ANN201 102, ANN001 15, ANN401 12, ANN202 9, ANN204 8, ANN002/003 2 | **148** | Untyped public surface |
| COM/Q (formatting) | COM812 214, Q003 2 | **216** | Would vanish under `ruff format` |
| E (pycodestyle) | E501 852, E741 3 | **855** | Line length unmanaged (no formatter, no line-length setting) |
| EM (exception messages) | EM102 25, EM101 17 | **42** | String interpolation in raise sites |
| TRY (tryceratops) | TRY003 42, TRY300 6, TRY301 5, TRY400/401 2 | **55** | Long vanilla exception messages dominate |
| BLE/SLF | BLE001 35, SLF001 2 | **37** | Blind `except Exception` is systemic |
| S (bandit) | S110 5, S105 2, S106 1, S314 1, S324 1, S603 1 | **11** | Low count, high stakes (see Detailed Findings) |
| FBT | FBT001 20, FBT002 18, FBT003 8 | **46** | Positional booleans in export/text APIs |
| ARG | ARG001 28, ARG002 3 | **31** | Dead function parameters |
| PTH (pathlib) | 17 across PTH107/110/118/119/122/123/103/202 | **17** | `os.path` idiom throughout |
| C901 | C901 | **32** | 32 functions exceed cyclomatic complexity 10 |
| RUF | RUF022 5, RUF001 3, RUF002 2, RUF012 2, RUF005/010/059 3 | **15** | RUF012 ×2 are genuine state-safety risks |
| RET | RET504 10, RET505 10, RET501 9 | **29** | Mechanical |
| PERF | PERF401 8 | **8** | Manual list building in hot parsers |
| G (logging) | G004 7 | **7** | f-string logging (eager formatting) |
| SIM | SIM105 4, SIM102/108/114 3 | **7** | |
| C4/PIE/FURB/TCE | 4+2+2+1 | **9** | |
| Misc singletons | ERA001 1, N802/N806 2, A003 1, ASYNC 3, INP001 45, CPY001 75 | **127** | CPY001/INP001 = noise |

### Violations per rule family — `tests/` under `ALL` (top items)

| Rule | Count | Assessment |
|---|---|---|
| S101 (assert) | 1,564 | **Expected** — asserts are the point of pytest; must be per-file-ignored before enabling S |
| E501 | 549 | Style |
| ANN201/ANN001/ANN202/ANN204… | ~774 | Test signatures rarely need annotations; per-file-ignore |
| PLR2004 | 430 | Magic values are normal in assertions; per-file-ignore |
| D102/D103/D101/D100… | ~475 | Docstrings in tests: noise; per-file-ignore |
| ARG005 (unused lambda arg) | 100 | Often intentional stubs (`lambda *_: None`); review subset |
| SLF001 | 99 | Reaching into privates is common in tests; per-file-ignore |
| PT018 (composite assertion) | 32 | Real diagnostic-quality issue — split multi-assert `pytest.raises` guards |
| S106/S105 | 18 | Fake credentials in fixtures — expected; per-file-ignore |
| PT011 (raises-too-broad) | 6 | Worth fixing: `ValueError` matches are loose |

### Violations — `alembic/` (both configured set and ALL overlap)

| Rule | Count | Location |
|---|---|---|
| I001 | 5 | `env.py:1`, three `versions/*.py:8`, `ec9eb70fcc96_initial_schema.py:8` |
| F401 | 1 | `env.py:7` — `import app.models` (⚠️ see Critical caveat below) |
| W291 | 1 | `ec9eb70fcc96_initial_schema.py:4` (`Revises: ` trailing space in docstring) |
| Q000 | 26 | Single-quote style in generated migrations |
| UP007 | 12 | `Optional[X]` in generated headers |
| Others | 34 | E501 6, CPY001 5, INP001 5, D400/D415 8, COM812 4, UP035 4, PLR2004 1, D100 1 |

> ⚠️ **Autofix hazard (validates audit-only mode):** `alembic/env.py:7` reads `import app.models  # Import all models to register them with Base.metadata`. This is a **deliberate side-effect import**. Running `ruff check --fix` (safe fixes!) would delete it as F401, after which `Base.metadata` would be empty of model tables and Alembic autogenerate would produce empty/wrong migrations. The correct treatment is `# noqa: F401` (with reason) or a re-export — never a blind fix. This single case justifies the no-autofix policy for this audit and a caution label for any future fix campaign.

---

## Lint Configuration Review (disabled-rules audit — verdicts)

### Currently selected

| Set | Verdict | Reasoning |
|---|---|---|
| `E` | ✅ Keep | Core correctness-of-syntax. Clean in app except E501/E741. |
| `F` | ✅ Keep | Pyflakes is the highest-value baseline (unused/undefined names). App is **completely F-clean under ALL** — genuinely impressive. |
| `W` | ✅ Keep | Trivial but free. |
| `I` | ✅ Keep | Import sorting enforced; app/tests fully compliant (only alembic drifts). |

### Currently ignored — keep/disable verdicts

| Ignored rule | Verdict | Analysis |
|---|---|---|
| `E501` (line-too-long) | ⚠️ **Keep, conditionally** | Legitimate to ignore **iff** `ruff format` owns line length. Today there is no formatter config and lines reach extreme lengths (852 violations in app alone, worst >150 chars in `pdf_extractor.py`, `csl_formatter.py`). Either adopt `ruff format` + keep E501 off, or set `line-length = 120` and re-enable. Current state = unmanaged. |
| `E741` (ambiguous variable name) | ✅ Keep ignored (low value) | Only 3 occurrences in app; not worth churn. Acceptable standing ignore. |
| `B008` (function call in default argument) | 🚨 **DEAD CONFIG — symptom of unfinished migration** | `B008` is ignored but **`B` is not in `select`**. The ignore does nothing today. Its presence proves someone intended to enable bugbear (and knew the FastAPI `Depends(...)`-in-default idiom needs B008 exempted) but the `select` update never happened. **Action:** enable `B`, retain this ignore (it is the correct FastAPI posture), optionally scope it via per-file-ignores to endpoint modules only. |

### Not selected but consequential — verdicts on "should be enabled"

| Family | Verdict | Justification from observed code |
|---|---|---|
| `B` (bugbear) | 🔴 **Enable immediately** | B023 found 6 latent closure bugs; B904 11 missing `raise from`; B007/B905 minors. Highest ROI family. |
| `S` (bandit) | 🔴 **Enable with per-file-ignores** | Found S314 (XML), S324 (md5), S603 (subprocess), S110 (silent pass), S105/S106. Tests must get `S101`, `S105`, `S106`, `S311` exemptions. |
| `ASYNC` | 🔴 **Enable immediately** | Found real event-loop blockers: ASYNC230 (blocking `open()` inside async upload stream + GROBID upload), ASYNC212 (sync httpx `.close()` in async shutdown). Zero-tolerance family for a FastAPI service. |
| `RUF` | 🔴 **Enable** | RUF012 caught two genuinely dangerous mutable class attributes. Also gives RUF001/2/5/10/22/59 hygiene cheaply. |
| `UP` (pyupgrade) | 🟠 Enable (bulk autofix first) | 945 mechanical violations; py311 target makes `List→list`, `Optional→X \| None`, `datetime.timezone.utc→UTC` free wins. One-shot `--fix` then enforce. |
| `C90` + PLR thresholds | 🟠 Enable with relaxed gates | Default max-complexity 10 flags 32 functions; start `mccabe.max-complexity = 15`, `pylint.max-args = 8`, `max-statements = 60`, and ratchet down. The five worst offenders (see below) deserve refactors regardless. |
| `PERF` | 🟠 Enable | PERF401 in PDF/GROBID hot loops. |
| `SIM`, `RET`, `C4`, `PIE`, `FURB` | 🟠 Enable | Small counts, mechanical fixes. |
| `EM`, `TRY003` | 🟡 Enable selectively | 67 raise-site hygiene issues; pair EM101/EM102 with TRY003 exemption initially (they overlap), or adopt exception classes. |
| `FBT` | 🟡 Enable FBT003 only first | Positional booleans already cause confusion at `export_to_docx(...)` call sites (7-arg exports with bare `True`s). |
| `ARG` | 🟡 Enable app-only via per-file-ignores for tests | 31 dead params indicate API drift. |
| `PTH` | 🟢 Optional/later | Idiomatic preference; 17 sites; no correctness stake. |
| `G` | 🟢 Optional | f-string logging costs nothing unless the level is enabled; lazy `%s` is better practice but low priority. |
| `ANN` | 🟢 Gradual (per-file ratchet) | 148 missing annotations in app; mypy is separately configured with `check_untyped_defs`, so partial mitigation exists. Do not big-bang. |
| `D` (docstrings) | ❌ Don't enable wholesale | ~567 gaps concentrated in services; cost >> benefit mid-project. If desired, enable only `D419` or module-level `D100` later. |
| `CPY001` (copyright) | ❌ Never (unless legal requires) | Pure noise (115 hits). |
| `INP001` | ❌ Skip or fix via packages | `app/tests` lack `__init__.py` by design in places; either add `__init__.py` or ignore. |
| `COM812`/`Q` | ⚠️ Only via `ruff format` | These are formatter concerns; enabling them as lint while hand-formatting creates permanent friction. Adopt `ruff format` and let both disappear. |
| `T10`/`T20` (print/debugger) | ✅ Enable (free) | **Zero current hits** — enforcing costs nothing, prevents accidents. |
| `DTZ` (datetime) | ✅ Enable (free) | **Zero current hits** — great news for a JWT-issuing app (`ACCESS_TOKEN_EXPIRE_MINUTES` math is tz-aware); lock it in. |
| `FLY`, `ICN`, `YTT`, `INT`, `DJ`, `NPY`, `AIR` | ✅ Enable (zero-hit families) | Free insurance. |
| `PT` (pytest) | 🟡 Enable tests-only | PT018 (32) improves failure diagnostics; PT011 (6) tightens `pytest.raises`. |
| `TC` (type-checking imports) | 🟢 Later | 1 hit; runtime-import-cost optimization. |
| `ERA` | ✅ Enable | Commented-out code found in `pdf_exporter.py:60`; dead-comment removal keeps history in git. |

### Structural configuration gaps

1. **No `force-exclude = true`** → CI/local divergence on `alembic/` (documented above). Set it and decide once whether migrations are linted (recommended: lint them with per-file-ignores `D100,D101,D400,D415,Q000,UP007,I001` for template boilerplate — the F401 side-effect import must stay protected with an explicit `# noqa`).
2. **No `[tool.ruff.format]`** → the project has no canonical formatter. 214 COM812 + quote inconsistencies (Q000 in migrations, double quotes elsewhere) prove drift. Adopting `ruff format` would eliminate entire violation classes and make the E501 ignore honest.
3. **No `per-file-ignores`** → the main reason ambitious rule sets feel "impossible" here. Tests need their own profile; alembic needs another.
4. **No `src = ["app"]`** → affects isort first-party detection heuristics (works today because imports happen to sort correctly in app/, but fragile).
5. **`line-length` unset** (default 88) while actual code routinely runs 100–160 chars — the config and reality disagree invisibly because E501 is ignored.

---

## Detailed Findings

Severity definitions here: **CRITICAL** = exploitable/security-class or data-corruption risk; **HIGH** = latent production bug or event-loop degradation; **MEDIUM** = maintainability/error-handling defect with plausible incident path; **LOW** = style/perf/idiom debt; **INFO** = noise or expected-by-design.

---

### 🔴 CRITICAL

#### CRIT-1 · S314 — `xml.etree` parsing of external-service XML response
- **Where:** `app/services/pdf_extractor.py:165` (inside `_parse_tei_xml`)
- **Evidence:**
  ```python
  def _parse_tei_xml(self, xml_text: str) -> Dict[str, Any]:
      """Parse GROBID TEI XML response into structured research document representation."""
      root = ET.fromstring(xml_text)
  ```
- **Why critical:** `ET.fromstring` is vulnerable to XML External Entity (XXE) and entity-expansion (billion laughs) attacks. The payload originates from a GROBID server (`self.grobid_url`) whose response embeds content extracted from **user-uploaded PDFs** — i.e., attacker-influenced text flows back as XML. If the GROBID endpoint is misconfigured, proxied, or compromised (or if a malicious PDF can steer extracted TEI), crafted entities can be expanded. stdlib `ET` does not resolve external entities by default in modern Python (mitigation), but entity-expansion bombs remain viable, and the bandit rule flags the pattern precisely.
- **Fix:** Swap to `defusedxml.ElementTree.fromstring` (drop-in; add `defusedxml` to `[project.dependencies]`), or explicitly harden: `parser = ET.XMLParser(forbid_dtd=True)` equivalent semantics. One-line change, zero behavioral impact for well-formed TEI.
- **Rule to prevent recurrence:** `S` (bandit) selection.

#### CRIT-1b (borderline, tracked at HIGH) · ASYNC230 in the upload hot path
Included here because of blast radius: see HIGH-2 — blocking disk writes inside the async request handler stall **all** concurrent requests on the worker, which under load is availability-equivalent to a security DoS vector on the upload endpoint.

---

### 🟠 HIGH

#### HIGH-1 · B023 — Function definitions bind loop variables (late-binding hazard) — 6 hits
- **Where:** `app/services/intelligence_service.py:422, 426, 427, 434, 435, 438`
- **Evidence:**
  ```python
  for paper in papers:                       # loop variable
      chunks = (...)                         # loop-local DB fetch
      def make_cell(keywords: List[str]) -> LitMatrixCellSchema:
          value, page_number, section = self._first_matching_sentence(chunks, keywords)  # :422 captures `chunks`
          ...
          paper_id=paper.id,                 # :426/:434 capture `paper`
          paper_title=paper.title,
          source_excerpt=f"{paper.title} — {section or 'General'}, p.{page_number}: ..."  # :438
  ```
- **Analysis:** `make_cell` closes over the **loop variables** `chunks` and `paper`. In the *current* code the closure is invoked within the same iteration (lines 441–443), so behavior happens to be correct — but this is the classic Python late-binding trap: any future refactor that stores `make_cell` (e.g., building a cell-factory list, moving invocation after the loop, or adding async scheduling) silently corrupts every cell to reference the **last** paper. Six separate capture sites amplify the fragility.
- **Fix:** Bind eagerly: `def make_cell(keywords: List[str], *, _chunks=chunks, _paper=paper):` or pass `chunks`/`paper` as explicit arguments, or construct a small dataclass/functools.partial per iteration.
- **Rule:** `B` selection would have caught this at authorship time.

#### HIGH-2 · ASYNC230 — Blocking `open()` in async functions (upload/streaming path) — 2 hits
- **Where 1:** `app/api/v1/endpoints/papers.py:105` — inside nested `async def _stream_to_disk()` called from the paper-upload endpoint:
  ```python
  async def _stream_to_disk() -> None:
      ...
      with open(file_path, "wb") as out:          # blocks event loop
          while True:
              chunk = await file.read(UPLOAD_CHUNK_SIZE_BYTES)
              ...
              out.write(chunk)                     # every chunk write blocks the loop
  ```
- **Where 2:** `app/services/pdf_extractor.py:146` — `_extract_with_grobid` opens the whole uploaded PDF synchronously to multipart-post it:
  ```python
  with open(file_path, "rb") as f:
      files = {"input": (os.path.basename(file_path), f, "application/pdf")}
      resp = await client.post(...)
  ```
- **Impact:** Every `out.write(chunk)` and the entire PDF read run on the event loop thread. With uvicorn's default single loop per worker, one large upload (the limit is configurable MBs) freezes **all** requests — including health checks — for the duration of disk I/O. This degrades p99 latency cluster-wide and can trip upstream timeouts.
- **Fix:** `await asyncio.to_thread(open/write)` wrapping, `anyio.to_thread.run_sync`, or `aiofiles`. For GROBID: pre-read bytes in a worker thread (`await asyncio.to_thread(file_path.read_bytes)`) then post from memory, or use `httpx.AsyncClient` with an async file wrapper.
- **Rule:** `ASYNC` selection.

#### HIGH-3 · ASYNC212 — Blocking sync httpx call inside async function — 1 hit
- **Where:** `app/core/http_client.py:72` (in `close_http_client`, an `async def`):
  ```python
  if _sync_client is not None and not _sync_client.is_closed:
      _sync_client.close()        # synchronous socket teardown on the loop
  ```
- **Impact:** Sync-client teardown performs blocking socket closes during app shutdown (lifespan hook) — brief stall, worse if pooled connections are open (up to 20 keepalive sockets).
- **Fix:** `await asyncio.to_thread(_sync_client.close)` — consistent with the careful `aclose()` handling already present four lines above.
- **Rule:** `ASYNC`.

---

### 🟡 MEDIUM

#### MED-1 · BLE001 — Blind `except Exception` — 35 hits (systemic)
Concentrated in: `llm_service.py` (×8: 78, 118, 147, 208, 228, 364, 419 + graph 224), `provider_cache_service.py` (×4: 63, 94, 120, 134), `collaboration.py` (×6), `identifier_resolver.py` (×3: 139, 234, 299), `pdf_extractor.py` (×3), `tabby_setup_service.py` (×3), plus singles across endpoints/services.
Representative:
```python
# app/services/provider_cache_service.py:63
except Exception:            # swallows serialization AND programming errors alike
    return None
```
**Risk pattern:** cache/read paths convert *every* failure — including `TypeError`, `AttributeError`, and other coding bugs — into silent `None`/fallback behavior, masking regressions. Several sites already log; several do not.
**Fix direction:** Catch concrete exceptions (`httpx.HTTPError`, `json.JSONDecodeError`, `redis.RedisError`, `sqlalchemy.exc.SQLAlchemyError`); where breadth is truly required, keep `except Exception` **with logging** and an explanatory comment (the two existing `# noqa: BLE001` sites show the house pattern). Enable `BLE` or rely on `B902`-adjacent coverage; realistically: enable `BLE001` and ratchet.

#### MED-2 · B904 — Raise without `from` inside `except` — 11 hits
Locations: `auth.py:102`, `export.py:56,109`, `papers.py:114,137`, `plugins.py:51,78`, `provider_settings.py:82,97,124`, `services/provider_settings.py:86`.
Representative:
```python
# app/api/v1/endpoints/papers.py:113-114
except PDFExtractionError as pe:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(pe))
```
**Impact:** Lost causal chain (`__context__` suppressed in client-visible tracebacks, confusing server logs, harder Sentry triage). Note papers.py:114 additionally raises an HTTPException from a *worker-thread-shaped* nested function — fine at runtime, but chaining matters for the 500-path.
**Fix:** Append `from pe` (or `from None` where leaking internals is undesirable). Mechanical, safe.

#### MED-3 · S110 + SIM105 — `try/except/pass` silent swallows — 5 + 5 hits
- `collaboration.py:113,145,153,353` (WebSocket message-handling: presence updates, cursor broadcasts silently die)
- `core/config.py:50` — **notable:** malformed `CORS_ORIGINS` JSON env var is swallowed and falls through to comma-splitting, so `["https://app.example.com", "https://x"]`-style typos degrade *silently* to wrong origins instead of failing fast at boot:
  ```python
  try:
      return json.loads(v)
  except Exception:
      pass                      # ← bad CORS config becomes mysterious browser errors
  ```
- SIM105 siblings (same lines + `papers.py` adjacency): prefer `contextlib.suppress(SpecificError)` with a comment.
**Fix:** At minimum `logger.debug/warning("...", exc_info=True)`; for config parsing, **raise** on invalid JSON — fail-fast beats silent fallback for deployment safety.

#### MED-4 · RUF012 — Mutable class-attribute defaults — 2 hits
- `app/services/ai_writing_service.py:50`: `RUF012 Mutable default value for class attribute` (a `ClassVar[list/dict]` candidate holding editable state)
- `app/services/intelligence_service.py:362`: same pattern
**Risk:** Shared mutable default across instances → cross-request state bleed if ever mutated (services are typically singletons here, which *currently* saves you — until someone instantiates twice or the attribute mutates).
**Fix:** Annotate `ClassVar[...]` or move to instance `__init__`/`Field(default_factory=...)`.

#### MED-5 · PLW0603 — Global statement — 9 hits (single file: `core/http_client.py:45,61,83,103` groups)
Module-singleton client caching via `global`. The implementation itself is thoughtful (loop-id staleness checks, closed-client detection, documented rationale). Globals are the pragmatic pattern here, BUT: (a) untestable without monkeypatching, (b) race-prone under concurrent first-use (two coroutines can both construct clients), (c) ASYNC212 above shows the seam. 
**Direction (not urgent):** encapsulate in a small holder object or `functools.cache`-per-loop factory; add an `asyncio.Lock` around first initialization.

#### MED-6 · S603 + PLW1510 — Subprocess surface — 2 hits
- `app/services/tabby_setup_service.py:69`: `subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=10)` — `binary` derives from `shallow.which("tabby")` / winget registry fallback. Shell is off (list argv) and input is environment-derived, so exploitability is low, but PATH hijacking yields arbitrary execution under the API's account. Mitigations: pin absolute path from settings, validate binary hash/name allowlist, keep `S603` enabled with `# noqa: S603 - trusted install location, argv list form` if accepted.
- `subprocess.run` without `check=` elsewhere (PLW1510 ×1) — return-code handling gap.

#### MED-7 · S105/S106 — Hardcoded credentials — 3 hits in app, 18 in tests
- `app/core/config.py:7`: `DEFAULT_DEV_SECRET_KEY = "openresearch_dev_secret_key_change_in_production_32bytes"` — **acceptable dev default**: it exists precisely to be detected, and `KNOWN_COMPROMISED_DEFAULT_SECRETS` (lines 9–13) plus validators enforce rejection in production. Recommend a targeted `# noqa: S105 - dev-only default, rejected in production by validator` to document intent.
- `auth.py:47` / `schemas/models.py:45`: `"token_type"` assignments — **false positives** (`token_type="bearer"` is OAuth2 vocabulary). Suppress narrowly or accept as noise.
- tests ×16–18: fake passwords in fixtures — expected; per-file-ignore.

#### MED-8 · PLW2901 — Loop variable overwritten — 2 hits
`app/services/llm_service.py:402,427` — SSE-stream parsing reassigns `line` inside the loop body (`line = line.decode().strip()`-style chains). Works, but obscures raw-vs-parsed state and invites off-by-one-line bugs in stream handling. Rename (`raw_line`/`payload`).

#### MED-9 · SLF001 — Private member access across module boundaries — 2 hits in app
- `health.py:33`: `client._get_redis` — reaches into another component's internals for the health probe; add a public accessor instead.
- `papers.py:549`: accesses `service._llm_grounded_answer` — promotes a private method to de-facto API; extract to a shared service method.
(99 further hits in tests — normal, per-file-ignore.)

#### MED-10 · ARG001/ARG002 — Unused function/method arguments — 31 hits in app
Signals API drift: parameters kept for signature compatibility but ignored (e.g., provider hooks, exporter kwargs like the 7-arg `export_to_docx`). Each is either (a) dead weight to remove, (b) a TODO of unwired behavior — both worth knowing. Prefix intentionally-unused with `_`.

#### MED-11 · EM101/EM102/TRY003 — Raise-site hygiene — 84 hits
Dynamic f-string messages in raises (EM ×42) and long vanilla messages (TRY003 ×42) across endpoints/services. Costs: untranslatable, untestable error taxonomy, log-grep unfriendliness. Introduce domain exception classes (`PaperTooLargeError(max_mb)` etc.) progressively; exempt TRY003 initially if adopting EM-first.

#### MED-12 · PLC0415 — Imports outside top level — 8 hits
`main.py:45-46`, `config.py:46`, `health.py:31`, `collaboration.py:81`, `pdf_extractor.py:294`, `tabby_setup_service.py:177,215`. Mostly circular-import avoidance or optional-dependency guarding — legitimate reasons each, but undocumented. Standardize with comments or restructure; don't blanket-ignore.

#### MED-13 · S324 — `hashlib.md5` — 1 hit
`intelligence_service.py:140`: `claim_id = hashlib.md5(sent.encode()).hexdigest()[:12]` — **non-cryptographic** deterministic ID generation. Not a vulnerability (no security property claimed), but: (a) FIPS-enabled environments throw, (b) 48-bit IDs invite collisions on large corpora. Use `hashlib.md5(..., usedforsecurity=False)` (documents intent, silences S324 correctly) or blake2b digest_size=6.

---

### 🔵 LOW (selected representative clusters; full counts in Executive Summary tables)

#### LOW-1 · C901 / PLR0915 — God functions — 32 complex / 5 mega
Worst offenders by complexity (value > threshold 10):

| Function | File:Line | Cmplx | Branches | Stmts |
|---|---|---|---|---|
| `format_authors_bibliography` | `core/text_utils.py:81` | **38** | 26 | 54 |
| `export_to_docx` | `services/export/docx_exporter.py:25` | **29** | 29 | **147** |
| `export_to_pdf` | `services/export/pdf_exporter.py:77` | 26 | 26 | 88 |
| `format_bibliography_entry` | `services/export/csl_formatter.py:33` | 22 | 22 | 88 |
| `parse_tiptap_node` | `services/export/ast_parser.py:71` | 22 | 21 | — |
| `_extract_metadata_from_text` | `services/pdf_extractor.py:423` | 22 | 23 | 57 |
| `export_to_markdown` | `services/export/markdown_exporter.py:18` | 24 | 23 | 62 |
| `_parse_tei_xml` | `services/pdf_extractor.py:163` | 21 | 20 | 57 |
| `build_project_graph` | `services/graph_service.py:37` | 20 | 19 | 67 |
| `hybrid_search` | `services/rag_service.py:332` | 20 | 21 | 56 |
| `websocket_collaboration` | `endpoints/collaboration.py:227` | 17 | 17 | 59 |
| `upload_paper` | `endpoints/papers.py:58` | 18 | — | 62 |

Pattern: the entire `services/export/*` subsystem and citation/text utilities are monolithic procedural blocks — the highest-value refactor targets in the codebase (dispatch-table/node-handler refactors fit naturally). Also note `websocket_collaboration` combining auth+loop+broadcast in one 59-statement body.

#### LOW-2 · PLR2004 — Magic values — 87 hits in app (+430 tests)
Threshold literals scattered through scoring/ranking logic (e.g., `rag_service.py:404`'s `0.68`/`0.55` blend weights surfaced by SIM108). Extract named constants — especially retrieval-scoring weights, which researchers will ask to tune.

#### LOW-3 · PLR0913/PLR0917 — Argument count — 16 + 16 hits
Exporter entry points (`export_to_docx/markdown/pdf`, 7 args), `research.py:17` (8 args), `rag_service.hybrid_search` (8 args), `comments.py:54`, `literature_search_service` (five 6–7-arg searchers). Combined with FBT (below), call sites read as positional-boolean soup: `export.py:76-77` passes bare `True, True`. Introduce param objects/dataclasses for exporter options.

#### LOW-4 · FBT001/002/003 — Boolean traps — 46 hits
Same cluster as LOW-3. Keyword-only enforcement (`*, include_toc: bool = True`) is a near-zero-risk modernization.

#### LOW-5 · UP family — 945 hits (mechanical)
- UP006 ×445 / UP045 ×369: `typing.List/Dict/Optional/Union` throughout (`config.py:2` `from typing import List, Union` is representative) — py311 makes native generics free.
- UP035 ×87: deprecated imports from `typing` (`Sequence, Union` in every alembic header).
- UP017 ×31: `timezone.utc` → `datetime.UTC`.
One `--fix` session (post-audit) retires ~95% safely.

#### LOW-6 · ANN family — 148 hits in app (+774 tests)
Public endpoint/service functions missing return annotations (ANN201 ×102). Partially compensated by mypy `check_untyped_defs`. Ratchet: require annotations on `app/api/**` first.

#### LOW-7 · E501 — 852 app + 549 tests
Unmanaged line length (see Configuration Review). Worst concentrations: `pdf_extractor.py`, `csl_formatter.py`, `intelligence_service.py`. Resolve via formatter adoption.

#### LOW-8 · PERF401 / RET / SIM / C4 / PIE / FURB — ~60 combined mechanical hits
Manual comprehension opportunities in parser hot loops (`pdf_extractor.py:178,231,610`, `identifier_resolver.py:92`, `ai_writing_service.py:340`, `literature_search_service.py:146`, `markdown_exporter.py:77`); useless-return/superfluous-else patterns; `startswith` tuple merge (`ast_parser.py:171`); ternary candidates (`rag_service.py:404`). All safe-autofixable.

#### LOW-9 · PTH — 17 hits
`os.path.*` / builtin `open` / `os.remove/makedirs/getsize` idioms. Fine on Windows-targeted dev; pathlib adoption is stylistic.

#### LOW-10 · G004 — f-string logging — 7 hits
`middleware.py:41,57` (request timing logs — evaluated per request even when INFO disabled), `pdf_extractor`, `zotero_service`, `rag_service`. Convert to `%s` laziness.

#### LOW-11 · Assorted singles (each self-explanatory)
`B007` unused loop var `pdf_extractor.py:343`; `B905` zip-without-strict `rag_service.py:95`; `C416` `teams.py:73`; `FURB171` `service.py:65`; `PIE810` `ast_parser.py:171`; `SIM114` `text_utils.py:218`; `ERA001` commented-out code `pdf_exporter.py:60`; `N802` camelCase `showPage` (reportlab API shadow — needs noqa); `N806` TEI tag var `persName` (domain term — noqa or rename); `A003` `id` attr shadow `models/comment.py:55` (SQLAlchemy convention — noqa); `RUF001/2` Greek letters/en-dashes in academic strings (`pdf_extractor.py:47-50` α/γ/σ — **false positives for a citations product**, configure `allowed-confusables`); `PLR5501`, `RUF005`, `RUF010`, `RUF059`, `UP037` ×8 quoted annotations, `UP008` ×3, `TC006`, `D301`.

---

### ⚪ INFO (noise / expected-by-design — do NOT chase)

| Cluster | Count | Disposition |
|---|---|---|
| D-family docstring gaps | ~600 app + ~475 tests | Services-layer documentation debt; schedule, don't gate |
| CPY001 missing copyright | 115 | Noise unless legal mandates headers |
| INP001 implicit namespace package | 85 | Add `__init__.py` to test roots or ignore |
| B008 Depends-in-default | 171 | **Correct FastAPI idiom** — the standing ignore is right; keep |
| FAST002 non-Annotated deps | 189 | Real modernization backlog (Annotated enables parameter-level test overrides cleanly) but purely mechanical; batch-migrate with codemod, then enable rule |
| S101 asserts (tests) | 1,564 | The point of pytest |
| S105/S106 fixture creds (tests) | 18 | Expected |
| PT018/PT011/PT006/PT003/PT013/PT017 | ~45 | Diagnostic quality; enable `PT` for tests only |
| SLF001 (tests) | 99 | Normal white-box testing |
| ARG005 lambda stubs (tests) | 100 | Mostly intentional `lambda *_: None` |
| ANN/D/PLR2004 (tests) | ~1,700 | Per-file-ignore territory |
| RUF001 α/γ/σ confusables | 3 | False positives for scholarly content — add to `allowed-confusables` |

### Rules passing cleanly under `ALL` (notable zeros in `app/`)

Zero findings — and therefore cheap to lock in via selection:

- **Entire pyflakes F family** (F401 unused imports, F811 redefinitions, F841 unused vars, F821 undefined names) — outstanding baseline hygiene.
- **DTZ** (naive datetimes) — zero; important for JWT expiry arithmetic.
- **T10/T20** (debugger/print) — zero.
- **E711/E712/E713/E714/E722** (comparison/bare-except) — zero.
- **B006** (mutable default args), **B012**, **B015** — zero.
- **S102** (exec), **S301/S307** family beyond S314, **S506** (yaml.load) — zero.
- **ISC** (implicit string concat), **RSE**, **ICN**, **YTT**, **INT**, **DJ**, **NPY**, **AIR**, **FLY** — zero.
- **W-family in app** — zero (only alembic W291).

---

## Rules-to-Enable Priority List

### Phase 0 — structural (do first, unblocks everything)
```toml
[tool.ruff]
target-version = "py311"
line-length = 100            # match reality; formatter will own it
force-exclude = true         # make CI == local
extend-exclude = []          # keep alembic linted w/ per-file profile

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101", "S105", "S106", "S311", "ANN*", "D1*", "PLR2004", "SLF001", "ARG005", "PT013"]
"alembic/**" = ["D100", "D101", "D103", "D400", "D415", "Q000", "UP007", "I001", "INP001", "CPY001"]

[tool.ruff.format]
quote-style = "double"       # adopt the formatter; kills COM812/Q/W291 classes
```

### Phase 1 — correctness & safety (enable now, ~50 new findings, all actionable)
| Add to select | New findings unlocked | Rationale |
|---|---|---|
| `B` (keep `B008` ignored) | B023 ×6, B904 ×11, B007, B905 | Latent bugs + chaining |
| `S` (with test ignores) | S314, S324, S603, S110, S105 | Security gate |
| `ASYNC` | ASYNC212, ASYNC230 | Event-loop integrity |
| `RUF` | RUF012 ×2 + hygiene set | State safety |
| `T10`, `T20`, `DTZ`, `ERA` | 0–1 | Free insurance, already clean |
| `BLE001` | 35 | Force logged-or-narrowed catches |

### Phase 2 — modernization sweep (one autofix PR, then enforce)
`UP`, `SIM`, `RET`, `PERF`, `C4`, `PIE`, `FURB`, `TC` — retires ≈1,100 findings, ~90% machine-fixable.

### Phase 3 — architecture pressure (thresholds, ratchet downward)
```toml
[tool.ruff.lint.mccabe] max-complexity = 15        # from 10; ratchet to 12
[tool.ruff.lint.pylint]
max-args = 8          # ratchet to 6
max-statements = 60   # ratchet to 50
max-branches = 15     # ratchet to 12
```
Plus selective: `PL` (keep PLR2004/PLW0603/PLW2901/PLR0915), `FBT003`, `ARG` (app-only), `EM101/EM102`, `PTH`, `G004`, `FAST002` after Annotated migration, `PT` (tests-only), `ANN` via per-file ratchet starting at `app/api/**`.

### Explicitly do-not-enable (current judgment)
`CPY001`, `D` (wholesale), `COM812`/`Q` (until/unless formatter rejected), `INP001` (unless `__init__.py` added), blanket `ANN` big-bang, `E501` (while formatter owns length), `VOT`/preview-gated exotica.

---

## Positive Observations

1. **Immaculate pyflakes cleanliness.** Zero F-family findings across `app/` even under `--select ALL` — no unused imports, undefined names, shadowed bindings, or f-string-without-placeholder issues. Rare for a codebase this size.
2. **Clean E/W core.** Beyond line length, pycodestyle is spotless: no bare excepts, no identity-comparison errors, no trailing whitespace in app.
3. **Datetime discipline.** Zero DTZ findings in a service doing token-expiry math — naive-datetimes have been avoided consistently.
4. **Exemplary suppression hygiene.** Exactly two `# noqa` in the codebase, both narrow (specific code), both carrying written justification comments. Many larger projects drown in bare `noqa`.
5. **Thoughtful concurrency-aware infrastructure.** `http_client.py`'s event-loop-staleness detection for the shared AsyncClient is sophisticated and correct in intent (globals notwithstanding); the two noqa'd broad catches there are the *right* calls.
6. **Security-conscious config design.** `KNOWN_COMPROMISED_DEFAULT_SECRETS` + production rejection of default secrets is a pattern most projects lack; rate-limit knobs are env-tunable.
7. **Strong verification culture.** mypy configured with `check_untyped_defs`, pytest with `--cov-fail-under=94` — the lint gate is the weakest link, not the norm.
8. **Honest test volume.** ~4.7k test-side findings are overwhelmingly benign categories (asserts, fixtures, magic values), indicating real coverage rather than lint-driven theater.
9. **Import ordering holds in app/tests.** All I001 drift is confined to Alembic-generated boilerplate.

---

## Prioritized Recommendations

1. **[NOW] Fix CRIT-1:** replace `ET.fromstring` with `defusedxml` in `pdf_extractor.py:165` (add dependency). One line, closes the only critical finding.
2. **[NOW] Fix HIGH-2/3:** wrap blocking disk I/O (`papers.py:105` stream writer; `pdf_extractor.py:146` GROBID upload) and `_sync_client.close()` (`http_client.py:72`) in `asyncio.to_thread`/`aiofiles`. Restores event-loop responsiveness under load.
3. **[NOW] Defuse HIGH-1:** bind `chunks`/`paper` eagerly in `intelligence_service.make_cell` (default-args or explicit params) before any refactor touches that loop.
4. **[THIS WEEK] Repair the config's dead signal:** add `B`, `S`, `ASYNC`, `RUF`, `BLE001`, `T10`, `T20`, `DTZ`, `ERA` to `select`; keep `E501`/`E741`/`B008` ignores; add the `per-file-ignores` profiles for `tests/**` and `alembic/**` from Phase 0. Set `force-exclude = true`. This converts the gate from decorative to protective at the cost of ~65 actionable findings.
5. **[THIS WEEK] Protect the side-effect import:** `alembic/env.py:7` gets `import app.models  # noqa: F401 — registers models on Base.metadata` **before** anyone runs a fix campaign; add a warning comment to the team docs that blind `ruff --fix` on `alembic/` breaks migrations.
6. **[SPRINT] Silence-swallow cleanup:** give every S110/SIM105 site either a concrete exception type or a logged fallback; make `config.py:50` raise on malformed `CORS_ORIGINS` JSON (fail-fast at boot). Add `raise ... from` to all 11 B904 sites (mechanical).
7. **[SPRINT] Adopt `ruff format`** with `line-length = 100`; commit the one-time reformat in isolation; delete COM812/Q/W291/E501 debate permanently. Follow with the `UP` autofix PR (≈900 findings retired) and enable Phase 2 families.
8. **[ROADMAP] Decompose the export subsystem:** `docx_exporter.export_to_docx` (147 stmts), `csl_formatter.format_bibliography_entry` (88), `text_utils.format_authors_bibliography` (complexity 38) — introduce node-handler/dispatch architectures; enforce via `mccabe.max-complexity = 15` ratcheting to 12. Same pass: convert exporter boolean-flag params to keyword-only/options dataclasses (kills FBT + PLR0913 clusters together).
9. **[ROADMAP] FAST002 Annotated migration** via codemod (174 unsafe-fixes available), then enable `FAST`. Pair with extracting `hybrid_search`'s 8 params into a search-options model.
10. **[ROADMAP] Error taxonomy:** introduce domain exception hierarchy for papers/export/zotero flows (retires EM/TRY003 organically), keeping `str(exc)`-style HTTP detail mapping centralized.
11. **[ONGOING] Ratchet discipline:** treat new findings in enabled families as build-breaking; revisit thresholds quarterly. Never widen `ignore` without a dated comment explaining why.

---

### Audit-mode compliance statement

No `--fix`, `--unsafe-fixes`, or `format` commands were executed. No file under `apps/api` (or anywhere in the repository) was modified. The only artifact produced is this report. All 8,567 identified findings remain open for the team's disposition; the Phase-1 subset (~65 findings) constitutes the recommended immediate remediation queue.

*— End of report —*
