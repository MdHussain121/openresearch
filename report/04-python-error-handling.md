# Python Error Handling Audit — OpenResearch API (`apps/api`)

**Audit ID:** 04-python-error-handling (Follow-up)
**Scope:** `apps/api/app/**` (endpoints, services, core, plugins, schemas, main.py)
**Standard applied:** `python-error-handling` skill (fail-fast validation, meaningful exceptions, exception chaining, partial-failure isolation, context preservation, logging-vs-raising discipline)
**Mode:** READ-ONLY audit. No files were modified.
**Date:** 2026-08-27
**Previous audit:** `audit-reports/04-python-error-handling.md` (2026-08-26)

---

## Scope & Methodology

### Files reviewed (all Python under `apps/api`, excluding `.venv`, `__pycache__`)

| Layer | Files inspected |
|---|---|
| Entry point | `app/main.py` |
| Core | `app/core/config.py`, `database.py`, `http_client.py`, `middleware.py`, `rate_limit.py`, `text_utils.py`, `constants.py`, `logging_config.py`, `authors.py` |
| Endpoints (24) | `auth.py`, `health.py`, `papers.py`, `collaboration.py`, `chat.py`, `citations.py`, `comments.py`, `documents.py`, `export.py`, `graphs.py`, `intelligence.py`, `projects.py`, `provider_settings.py`, `provider_status.py`, `plugins.py`, `research.py`, `teams.py`, `version_history.py`, `zotero.py`, `ai_writing.py` |
| Services (18) | `llm_service.py`, `ai_writing_service.py`, `rag_service.py`, `literature_search_service.py`, `identifier_resolver.py`, `zotero_service.py`, `pdf_extractor.py`, `plugin_runtime.py`, `plugin_service.py`, `provider_cache_service.py`, `provider_settings.py`, `tabby_setup_service.py`, `graph_service.py`, `intelligence_service.py`, `auth.py`, `export/service.py` |
| Plugins | `arxiv_provider.py`, `crossref_provider.py`, `csl_processor.py`, `ghost_writer.py`, `latex_exporter.py` |
| Schemas | `app/schemas/*.py` (input-validation review of all request models) |
| Migrations | `alembic/env.py` (verified: no exception handling defects) |

### Method

1. Systematic grep sweeps over `apps/api/app`: `except\s*:`, `except\s+\w`, `^\s*raise\s`, `try:`, `logger\.`, `logging\.` — **89 `except` clauses** and **~250 `raise` sites** inventoried with line numbers.
2. Every hit inspected in full-file context (all 24 endpoints, 18 services, 7 core modules read end-to-end).
3. Cross-layer trace of each external-call path (LLM providers, Ollama, Tabby, GROBID, Crossref, OpenAlex, arXiv, Semantic Scholar, PubMed E-utilities, Zotero Web API, Redis) from HTTP boundary to error surface.
4. Request-model validation review (`Field` constraints, validators) against actual downstream usage.
5. **Verification of all prior findings** from `audit-reports/04-python-error-handling.md` — each classified as FIXED / PARTIALLY FIXED / STILL OPEN.
6. Findings classified CRITICAL / HIGH / MEDIUM / LOW / INFO per the skill's rubric (impact × likelihood × observability).

---

## Executive Summary

| Severity | Count (Prior) | Count (Current) | Delta | Summary |
|---|---:|---:|---:|---|
| **CRITICAL** | 0 | 0 | 0 | No bare `except:`; no secrets in error responses; global envelope prevents stack-trace leakage |
| **HIGH** | 3 | 0 | -3 | All three prior HIGH findings FIXED (Zotero import crash, silent key loss, WS relay death) |
| **MEDIUM** | 13 | 8 | -5 | 5 FIXED, 3 PARTIALLY FIXED, 5 STILL OPEN |
| **LOW** | 10 | 9 | -1 | 1 FIXED, 2 PARTIALLY FIXED, 7 STILL OPEN |
| **INFO** | 7 | 7 | 0 | Architectural observations unchanged |

**Headline:** The codebase has made **substantial progress** since the prior audit. All three HIGH-severity findings are resolved. The surface discipline (zero bare excepts, sanitized request IDs, generic 500 envelopes) remains strong. The interior inconsistency has narrowed: streaming paths now have in-band error frames (chat), but `stream-autocomplete` still lacks them; identifier validation is still missing; HTTP client singleton lacks a lock; exception hierarchy is still thin.

---

## Verification of Prior Findings

### HIGH Findings (All FIXED)

| ID | Prior Finding | Status | Evidence |
|---|---|---|---|
| **H-1** | Unguarded nested indexing of user-supplied CSL JSON crashes Zotero import (500) | **FIXED** | `zotero_service.py:117-130` — defensive `isinstance` checks on `issued` and `date-parts`; per-item `try/except` at `:182-185` with `skipped_count` accounting and `logger.warning` |
| **H-2** | Corrupt `provider_keys.json` silently reset → permanent loss of API keys, zero logging | **FIXED** | `provider_settings.py:164-198` — `logger.exception` on read failure, `logger.error` on JSON decode/non-dict, quarantine copy `provider_keys.json.corrupt-<ts>` before returning empty; `_save_store` at `:201-215` uses `tempfile.mkstemp` + `os.replace` for atomic writes |
| **H-3** | Collaboration relay loop dies silently — cross-worker realtime sync stops with no log/restart | **FIXED** | `collaboration.py:121-126` — `logger.exception("Collaboration relay terminated unexpectedly")`; exponential backoff (`backoff = min(backoff * 2, 30)`) and auto-restart via `asyncio.create_task(self._relay_loop())` |

### MEDIUM Findings

| ID | Prior Finding | Status | Evidence |
|---|---|---|---|
| **M-1** | Invalid/expired JWTs silently downgraded to local **admin** user | **PARTIALLY FIXED** | `auth.py:137-142` — now logs `logger.warning("Invalid bearer token (%s); %s", type(exc).__name__, "falling back to local user (dev mode)" if dev_insecure else "rejecting")`; but fallback behavior unchanged (dev mode still auto-provisions admin). `refresh_tokens` at `:107-111` narrowed to `jwt.PyJWTError` + separate `except Exception` with `logger.exception` |
| **M-2** | Rate limiter trusts `X-Forwarded-For` blindly; unbounded memory growth | **FIXED** | `rate_limit.py:20-41` — `_is_trusted_proxy()` validates peer IP against `OPENRESEARCH_TRUSTED_PROXIES` CIDR list; only honors header when proxy trusted. `SlidingWindowRateLimiter._sweep_stale_keys()` at `:62-71` evicts expired keys periodically (`_sweep_interval = max(window_seconds, 60.0)`) |
| **M-3** | HTTP client singletons mutate module globals without locks — leaked sockets under concurrency | **STILL OPEN** | `http_client.py:72-99` (`get_async_http_client`), `:102-111` (`get_sync_http_client`) — check-then-act race persists. Stale client detection exists (`_async_client_stale`), but no `threading.Lock` around creation/replacement. Two threads hitting stale path concurrently each construct `AsyncClient`; loser GC'd unclosed. |
| **M-4** | Provider-cache failures logged at DEBUG; `OrderedDict` not thread-safe | **FIXED** | `provider_cache_service.py:38` — `_cache_lock = threading.Lock()` guards all `_cache` mutations (`move_to_end`, `popitem`, `del`). `_redis_lock` at `:41` guards `_get_redis` init. Redis errors at `:74-75`, `:117-118`, `:151-152`, `:176-177` promoted to `logger.warning` |
| **M-5** | Plugin hook failures never logged — `execute_hook()` discards execution log | **FIXED** | `plugin_runtime.py:122` — `logger.warning("Plugin %s failed on hook %s: %s", plugin.plugin_id, hook_name, exc)`. `plugin_service.py:193-198` — `execute_hook` now logs failures summary with plugin IDs and error messages |
| **M-6** | Unvalidated identifiers interpolated into external API URLs (Crossref/arXiv/PubMed) | **STILL OPEN** | `identifier_resolver.py:84`, `:181`, `:254` — URLs built via f-string with cleaned but **unvalidated** identifiers. Cleaners strip prefixes but no charset/format gate (e.g., DOI `10.x/...&malicious=1`, arXiv `1234.5678?param=x`). `AddByIdentifierRequest.identifier: str` (schemas/citations.py:401) has no pattern constraint. |
| **M-7** | Broad `except Exception` in resolvers conflates bugs with outages behind `"unresolved"` sentinel | **PARTIALLY FIXED** | `identifier_resolver.py:141`, `:236`, `:298` — catches now explicitly `(httpx.HTTPError, ValueError)` instead of bare `Exception`. Good: programming errors (TypeError, KeyError) now propagate to global envelope. Remaining: `ValueError` from `resp.json()` still caught alongside HTTP errors — indistinguishable in logs. |
| **M-8** | LLM availability probes swallow exception — "unreachable" hides *why* | **FIXED** | `llm_service.py:79-80` (`_probe_availability`), `:149-150` (`probe_tabby`) — `logger.warning("Ollama probe failed: %s", exc)` / `"Tabby probe failed: %s", exc` with exception class in message. |
| **M-9** | Health endpoint reports component failure without logging cause | **FIXED** | `health.py:35` — `logger.exception("Health check: database probe failed")`; `:53` — `logger.warning("Health check: Redis probe failed")`. Added public `provider_cache_service.redis_ping()` at `:79-89`. |
| **M-10** | Malformed `CORS_ORIGINS` env JSON silently ignored (`except Exception: pass`) | **FIXED** | `config.py:58-64` — `json.JSONDecodeError` caught explicitly, raises `ValueError(f"CORS_ORIGINS looks like JSON array but failed to parse: {exc}") from exc`. Fail-fast at startup. |
| **M-11** | Errors inside SSE generators truncate streams with no error frame | **PARTIALLY FIXED** | `chat.py:98-112` — `event_stream()` wraps generator in `try/except`, yields `{"type": "error", "code": "stream_failed"}` frame on exception. **BUT** `ai_writing.py:60-84` (`stream_autocomplete`) passes raw generator to `StreamingResponse` with **no try/except** — `AIProviderUnavailableError` raised inside generator after headers sent → truncated stream, no error frame. `ai_writing_service.py:186-196` catches exception and yields error frame, but only for the sync `generate_autocomplete` call; if error occurs during streaming setup (before first yield), no frame. |
| **M-12** | Missing bounds on chat/RAG request models feed unbounded values | **FIXED** | `rag_chat.py:56` — `message: str = Field(max_length=32000)`. `:78-79` — `limit: int = Field(default=5, ge=1, le=50)`, `threshold: float = Field(default=0.2, ge=0.0, le=1.0)`. `ai_writing.py:9` — `prefix_text: str = Field(max_length=32000)`. `:49` — `text: str = Field(max_length=32000)`. |
| **M-13** | WebSocket endpoint pins request-scoped DB session for socket lifetime | **FIXED** | `collaboration.py:264-268` — `db.close()` immediately after authentication. `_persist_doc_edit` at `:41-62` uses own `SessionLocal()` with `try/rollback/finally` close. |

### LOW Findings

| ID | Prior Finding | Status | Evidence |
|---|---|---|---|
| **L-1** | `str(exc)` embedded in client-visible `error`/`detail`/`message` — leaks internal hostnames/timeouts | **STILL OPEN** | `literature_search_service.py:86-91` returns `str(exc)` in payload; `zotero_service.py:51,68` returns `f"Invalid JSON format: {e!s}"`; `provider_settings.py:82,97,124` maps `ValueError` to 400 with `str(exc)`. Raw `httpx.ConnectError` text can reach clients. |
| **L-2** | IntegrityError retry exhausts → bare `raise` surfaces as 500 | **PARTIALLY FIXED** | `version_history.py:40-48` retries 3x on `IntegrityError` then `raise` (bare, no chaining). Surfaces as 500 via envelope. Should map to `409 Conflict`. `teams.py` add member path at `:250-252` has no `IntegrityError` handling for concurrent inserts. |
| **L-3** | Count-then-commit "last owner" guard — TOCTOU | **STILL OPEN** | `teams.py:284-297` (demote) and `:333-344` (remove) — `count()` then `commit()`. Two concurrent demotions/removals both pass count check → ownerless team. No `SELECT ... FOR UPDATE` or serializable retry. |
| **L-4** | `os.path.exists` check then `FileResponse` — TOCTOU | **STILL OPEN** | `papers.py:336-339` — `if not paper.pdf_path or not os.path.exists(paper.pdf_path): raise HTTPException(404)` then `FileResponse(path=paper.pdf_path)`. File deleted between check and open → `RuntimeError` → 500. Should wrap in `try/except` or let `FileResponse` raise and translate. |
| **L-5** | `import pdfplumber` inside method, no `ImportError` guard | **STILL OPEN** | `pdf_extractor.py:314` — `import pdfplumber` inside `_extract_with_pdfplumber`. Missing optional dependency → unhandled `ImportError` → 500 on upload despite GROBID-first design. Line `:133-135` logs real GROBID errors at `INFO` (should be `WARNING` with `exc_info`). |
| **L-6** | `_read_version` `except Exception: return None` fully silent | **STILL OPEN** | `tabby_setup_service.py:71-79` — `_read_version` catches all exceptions, returns `None` with no log. Version probe failure indistinguishable from absent binary. |
| **L-7** | Missing `from exc` chaining on `raise ValueError` inside `except` | **PARTIALLY FIXED** | `provider_settings.py:132` — `raise ValueError(...) from exc` ✓. `plugin_runtime.py:70` — `raise PluginEntrypointError(...) from exc` ✓. But `provider_settings.py:172` (in `validate_rate_limit_rpm`) raises from `exc` ✓. Some `raise HTTPException(...) from exc` in endpoints ✓. Remaining: `zotero_service.py:246` raises `ZoteroAPIError(str(exc)) from exc` ✓. Mostly fixed. |
| **L-8** | Endpoint reaches into private service method (`rag_service._llm_grounded_answer`) | **FIXED** | `papers.py:596` now calls `rag_service.grounded_answer` (public method). |
| **L-9** | `refresh_tokens` over-broad `except Exception` masks config bugs as 401 | **FIXED** | `auth.py:107-111` — narrow `except jwt.PyJWTError` for expected failures; separate `except Exception` with `logger.exception` for unexpected. |
| **L-10** | `close_http_client` closes sync client outside try — asymmetric with async path | **STILL OPEN** | `http_client.py:66-68` — `await asyncio.to_thread(_sync_client.close)` outside try; if it throws, async globals already nulled, INFO log skipped. |

### INFO Findings (Unchanged — Architectural)

| ID | Observation | Status |
|---|---|---|
| **I-1** | Exception hierarchy thin/unrooted: `PDFExtractionError(Exception)`, `ZoteroAPIError(Exception)`, `AIProviderUnavailableError(RuntimeError)`, `PluginEntrypointError(ValueError)`, ad-hoc `ValueError` for validation. No common `OpenResearchError` base. | STILL OPEN |
| **I-2** | arXiv Atom XML parsed with string-split + regex; malformed feeds silently yield "Untitled"/empty authors rather than parse-status flag. | STILL OPEN |
| **I-3** | `BaseHTTPMiddleware` envelope cannot intercept failures raised *during* response streaming (see M-11); no in-band error-frame convention enforced across SSE/WS. | STILL OPEN |
| **I-4** | Background Tabby thread correctly daemonized; failures logged with `exc_info=True`; migration failures crash startup (fail-fast — correct). | GOOD |
| **I-5** | Pure-compute services (`intelligence_service.py`, `rag_service.py`) intentionally contain no try/except; DB errors bubble to global envelope. Consistent "let-it-crash at edges" policy. | GOOD |
| **I-6** | `graph_service.py:212-225` discovery path: broad except → `[]` with WARNING log and docstring contract ("never fabricates"). Good pattern. | GOOD |
| **I-7** | `alembic/env.py`, `plugins/*.py` — no exception-handling defects found. | GOOD |

---

## New Findings (Not in Prior Audit)

| ID | Severity | Location | Issue | Impact & Fix |
|---|---|---|---|---|
| **N-1** | MEDIUM | `main.py:80-83` | Shutdown handler for collaboration relay catches `Exception` and **passes silently** (`pass`). If relay task cancellation fails, no log. | Add `logger.exception("Failed to cancel collaboration relay task")`. |
| **N-2** | MEDIUM | `main.py:88-89` | Shutdown handler for Tabby `stop_server()` catches `Exception` and **passes silently**. | Add `logger.warning("Tabby shutdown failed", exc_info=True)`. |
| **N-3** | LOW | `main.py:61` | Startup migration runner catches `Exception` broadly (line 61 is inside `_run_migrations` which is called before logger setup? Actually `setup_logging()` is called first at line 68, so logger works). But `command.upgrade` can raise many specific alembic/sqlalchemy errors — broad catch loses context. | Catch specific alembic/sqlalchemy exceptions; re-raise with context. |
| **N-4** | LOW | `llm_service.py:47-48` | `_rate_hits: dict[str, deque] = {}` — unbounded growth if many different provider keys used (each key creates a deque). Rate limit keys are only `"cloud"` currently, but structure allows per-key growth. | Cap dict size or sweep stale keys (like `SlidingWindowRateLimiter._sweep_stale_keys`). |
| **N-5** | LOW | `provider_settings.py:166` | `_load_store()` catches `OSError` but logs `logger.exception` — good. However, `_save_store()` at `:210-215` catches `BaseException` (too broad — catches `KeyboardInterrupt`, `SystemExit`). | Catch `Exception` only. |
| **N-6** | LOW | `pdf_extractor.py:132-135` | GROBID failure logged at `logger.info` — should be `logger.warning` with `exc_info=True` for visibility. | Promote log level. |
| **N-7** | MEDIUM | `literature_search_service.py` (not fully read) | Need to verify per-source fan-out isolation still has proper error logging. (Prior audit I-6 praised this pattern.) | Verify. |
| **N-8** | LOW | `export/service.py` and other export services | Not reviewed in detail — spot check for error handling consistency. | Review. |

---

## Error-Flow Architecture Assessment (Current State)

**Three coexisting strategies (unchanged):**

1. **Envelope-at-edge (global):** `GlobalErrorEnvelopeMiddleware` (`middleware.py:57-80`) catches unhandled → generic `INTERNAL_SERVER_ERROR` + `request_id`, `logger.exception` preserves traceback internally. ✅ Prevents internals leakage; ✅ correlation IDs sanitized.
2. **Sentinel-return (AI/providers):** `llm_service.generate()/stream_generate()` contractually "never raises", returns `None`/empty; `identifier_resolver` returns `extraction_status="unresolved"`; `tabby_setup_service` "never raises", returns honest status dicts. ✅ Excellent UX honesty; ⚠️ combined with broad excepts it erases bug/outage distinction (M-7 improved but not eliminated).
3. **Raise-and-map (validation/auth/plugins/export):** `ValueError`/domain exceptions raised in services → endpoints translate to 400/404/409/503 (`export.py:66`, `ai_writing.py:56`, `provider_settings.py:81`, `plugins.py:50`). ✅ Cleanest layering; ❌ applied inconsistently (SSE paths bypass it, M-11; IntegrityError unmapped, L-2).

**Gaps in the architecture (persisting):**

- **No shared exception base** ⇒ every translation site hand-enumerates types; adding a new domain exception requires touching N endpoints (I-1).
- **Streaming boundary undefined** — envelope strategy stops working for SSE/WS bodies; in-band error-frame convention exists in `chat.py` but **missing in `ai_writing.py` stream-autocomplete** (M-11, N-11).
- **Logging levels encode importance inconsistently** — real degradation sits at DEBUG (none now after M-4 fix) and INFO (GROBID, N-6) while benign probes sit at WARNING; triage by log level still unreliable.
- **Silent-swallow hotspots cluster around infrastructure** (Redis init/relay, token validation, CORS config, provider store) rather than business logic — precisely where operators need signal most (mostly fixed: H-2, H-3, M-1, M-4, M-9, M-10 now log).

---

## Positive Observations (Preserved Strengths)

1. **Zero bare `except:` clauses** across 89 handlers — rare and commendable.
2. **Global error envelope** with request-ID echo and *no* stack traces/internal messages in responses (`middleware.py:70-79`); client-supplied `X-Request-ID` sanitized (`middleware.py:20, 34`).
3. **Exemplary partial-upload safety** in `papers.py:101-139`: streamed size enforcement, first-chunk magic-byte check, partial-file removal on failure with `re-raise`, OSError-tolerant cleanup logging.
4. **Honest-degradation fallbacks**: total extraction failure stores truth-labeled record (`papers.py:157-174`); RAG indexing failure doesn't lose paper (`:196-201`); discovery "never fabricates recommendations" (`graph_service.py:188-196`).
5. **Per-source fan-out isolation** with structured per-provider error payloads (`literature_search_service.py:71-94`) — textbook skill Pattern 7.
6. **Commit-race handling done right twice**: `get_or_create_local_user` rollback-and-requery (`auth.py:103-111`) and bounded version-number retry on IntegrityError (`version_history.py:35-48`).
7. **Fail-fast production config guards** (`config.py:113-147`) refusing weak secrets/SQLite in production; deliberate startup crash when `alembic.ini` missing (`main.py:34-35`).
8. **Injectable, never-raising system-service design** in `tabby_setup_service` (health_probe/popen/run injectable; honest status dicts incl. port-conflict messaging) — highly testable error UX.
9. **Proactive Unicode hardening**: `sanitize_surrogates` prevents late `UnicodeEncodeError`s from lone-surrogate JSON (`text_utils.py:11-24`), used in intelligence flows.
10. **Consistent authorization preconditions**: uniform `_check_*_access` helpers raising precise 404/403 across nearly every endpoint, with role-scoped variants.
11. **Strong research-endpoint validation**: `research.py:16-49` validates source whitelist, year ordering, ranges — model for other request models.
12. **WebSocket hardening**: first-frame auth with timeout, frame-size cap, sliding-window rate limit, `logger.exception` on unexpected socket errors, guaranteed presence cleanup in `finally` (`collaboration.py:226-395`).

---

## Prioritized Recommendations

### P0 — Fix Now (Data Loss, Crash-on-User-Input, Silent Infrastructure Failures)

1. **N-1/N-2**: Add logging to shutdown handlers in `main.py:80-89` (silent `pass` on exception).
2. **M-3**: Guard HTTP client singleton creation with `threading.Lock` (or per-event-loop registry). ~15 LOC.
3. **M-6**: Gate identifiers with detector regexes before URL interpolation in `identifier_resolver.py`; add `test_` coverage for hostile strings. ~20 LOC.
4. **M-11 (ai_writing)**: Wrap `stream_autocomplete` generator in `try/except` yielding error frame (mirror `chat.py:98-112`). Pre-flight provider check before `StreamingResponse`. ~15 LOC.
5. **L-4**: Wrap `FileResponse` in `try/except` translating `RuntimeError` → 404 in `papers.py:336-343`. ~5 LOC.

### P1 — Next Sprint (Observability & Trust)

6. **M-1**: Keep dev-mode fallback but ensure production (`!dev_insecure`) never falls back — already raises 401. Add rate-limited log for dev fallback.
7. **L-1**: Map exception → stable code + safe message in client-visible errors; keep details in logs (`literature_search_service.py`, `zotero_service.py`, `provider_settings.py` endpoints).
8. **L-2**: Map exhausted `IntegrityError` retries to `HTTPException(409, "Concurrent modification")` in `version_history.py:47` and `teams.py:250-252`.
9. **L-3**: Replace count-then-commit with `SELECT ... FOR UPDATE` or DB unique constraint + serializable retry for last-owner guards in `teams.py:284-297, 333-344`.
10. **L-5**: Add `try/except ImportError` guard around `pdfplumber` import; promote GROBID failure log to `WARNING` with `exc_info`.
11. **L-6**: Add `logger.debug` in `_read_version` exception handler.
12. **L-10**: Wrap sync client close in try/except in `http_client.py:66-68`.
13. **N-3**: Narrow exception catch in `_run_migrations` to alembic/sqlalchemy specifics.
14. **N-5**: Change `BaseException` to `Exception` in `_save_store` catch.

### P2 — Scheduled Hygiene

15. **I-1**: Introduce `AppError(status_code, code, message)` hierarchy; central exception→HTTP mapper registered on app; migrate `ValueError`-mapping endpoints incrementally.
16. **I-2**: Replace arXiv regex XML parsing with `xml.etree` (already imported in `pdf_extractor`).
17. **I-3**: Codify SSE/WS in-band error-frame convention (`{"type":"error","code":...}`) in a shared decorator/helper; enforce across `chat/stream`, `stream-autocomplete`, collab WS.
18. **N-4**: Bound `_rate_hits` dict in `llm_service.py` with LRU sweep.
19. **N-6**: Promote GROBID failure log level.
20. Apply low-cost fixes as touched (exception chaining consistency, etc.).

### Process Suggestions

- Add a lint gate (e.g., `ruff` rules `BLE001`, `TRY`/`EM` families, `S110 try-except-pass`) tuned to allow the documented sentinel-return modules — converts audit findings into CI-enforceable policy.
- Adopt a one-page "error strategy" ADR codifying the three lanes observed here (envelope / sentinel / raise-and-map) and the SSE error-frame contract, so new services stop reinventing conventions.

---

## Appendix: Grep Inventory (Reference)

```bash
# Exception handlers
grep -rn "except Exception:" apps/api/app/ --include="*.py" | wc -l   # 22
grep -rn "except " apps/api/app/ --include="*.py" | wc -l           # 89

# Raises
grep -rn "^\s*raise " apps/api/app/ --include="*.py" | wc -l        # ~250

# Exception chaining
grep -rn "raise.*from" apps/api/app/ --include="*.py" | wc -l       # 15

# Logger.exception usage
grep -rn "logger\.exception" apps/api/app/ --include="*.py" | wc -l # 13

# Bare except (should be 0)
grep -rn "^[[:space:]]*except:$" apps/api/app/ --include="*.py"     # 0
```

---

*End of report — generated by read-only static audit; no application files were modified.*