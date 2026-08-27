# Python Error Handling Audit — OpenResearch API (`apps/api`)

**Audit ID:** 04-python-error-handling
**Scope:** `apps/api/app/**` (endpoints, services, core, plugins, schemas, main.py)
**Standard applied:** `python-error-handling` skill (fail-fast validation, meaningful exceptions, exception chaining, partial-failure isolation, context preservation, logging-vs-raising discipline)
**Mode:** READ-ONLY audit. No files were modified.
**Date:** 2026-08-26

---

## Scope & Methodology

### Files reviewed (all Python under `apps/api`, excluding `.venv`, `__pycache__`)

| Layer | Files inspected |
|---|---|
| Entry point | `app/main.py` |
| Core | `app/core/config.py`, `database.py`, `http_client.py`, `middleware.py`, `rate_limit.py`, `text_utils.py`, `constants.py` |
| Endpoints (24) | `auth.py`, `health.py`, `papers.py`, `collaboration.py`, `chat.py`, `citations.py`, `comments.py`, `documents.py`, `export.py`, `graphs.py`, `intelligence.py`, `projects.py`, `provider_settings.py`, `provider_status.py`, `plugins.py`, `research.py`, `teams.py`, `version_history.py`, `zotero.py`, `ai_writing.py`, … |
| Services (18) | `llm_service.py`, `ai_writing_service.py`, `rag_service.py`, `literature_search_service.py`, `identifier_resolver.py`, `zotero_service.py`, `pdf_extractor.py`, `plugin_runtime.py`, `plugin_service.py`, `provider_cache_service.py`, `provider_settings.py`, `tabby_setup_service.py`, `graph_service.py`, `intelligence_service.py`, `auth.py`, `export/service.py`, … |
| Plugins | `arxiv_provider.py`, `crossref_provider.py`, `csl_processor.py`, `ghost_writer.py`, `latex_exporter.py` |
| Schemas | `app/schemas/models.py` (input-validation review of all request models) |
| Migrations | `alembic/env.py` (verified: no exception handling defects) |

### Method

1. Systematic grep sweeps over `apps/api/app`: `except\s*:`, `except\s+\w`, `^\s*raise\s`, `try:`, `logger\.`, `logging\.` — **89 `except` clauses** and **~250 `raise` sites** inventoried with line numbers.
2. Every hit inspected in full-file context (all 24 endpoints, 18 services, 7 core modules read end-to-end).
3. Cross-layer trace of each external-call path (LLM providers, Ollama, Tabby, GROBID, Crossref, OpenAlex, arXiv, Semantic Scholar, PubMed E-utilities, Zotero Web API, Redis) from HTTP boundary to error surface.
4. Request-model validation review (`Field` constraints, validators) against actual downstream usage.
5. Findings classified CRITICAL / HIGH / MEDIUM / LOW / INFO per the skill's rubric (impact × likelihood × observability).

---

## Executive Summary

| Severity | Count | Summary |
|---|---:|---|
| **CRITICAL** | 0 | No bare `except:`; no secrets in error responses; global envelope prevents stack-trace leakage |
| **HIGH** | 3 | User-input crash (500) in Zotero import; silent credential-store destruction; silent death of WebSocket relay |
| **MEDIUM** | 13 | Silent token-failure downgrade to admin; rate-limit bypass/memory growth; thread-unsafe singletons; DEBUG-only Redis failures; unlogged plugin failures; URL-injection into academic APIs; SSE streams that die without error frames; missing schema bounds |
| **LOW** | 10 | Internal-detail echoes in client-visible errors; unchained re-raises; TOCTOU file/owner checks; missing-dependency 500s |
| **INFO** | 7 | Sparse custom-exception hierarchy; regex XML parsing brittleness; layering observations |

**Headline:** The codebase has an unusually disciplined *surface* (zero bare excepts, sanitized request IDs, generic 500 envelopes) but suffers from an inconsistent *interior*: several `except Exception: pass`-style swallows with no logging, one user-controllable crash, and streaming paths whose error contracts break after headers are sent.

---

## Detailed Findings

Severity legend:
- **CRITICAL** — exploitable or data-destructive with no mitigation
- **HIGH** — likely production incident, data loss, or misleading security behavior
- **MEDIUM** — degraded reliability/debuggability; fails skill best-practices materially
- **LOW** — hygiene issue; minor impact today, compounds later
- **INFO** — observation / architectural note

---

### [H-1] Unguarded nested indexing of user-supplied CSL JSON crashes the whole Zotero import (HTTP 500)

- **File:** `apps/api/app/services/zotero_service.py:107`
- **Severity:** HIGH
- **Snippet:**
  ```python
  date_str = str(data.get("date") or data.get("issued", {}).get("date-parts", [[""]])[0][0] or "")
  ```
- **Impact:** `ZoteroImportRequest.csl_json_content` (apps/api/app/schemas/models.py:708–712) accepts arbitrary JSON with **no size cap or shape validation**. If an item's `issued` is `{}`→OK, but `{"date-parts": []}` → `[0]` raises `IndexError`; if `issued` is a list/string → `.get` raises `AttributeError`. One malformed item **aborts the entire batch** after some rows were already `db.add()`-ed (line 149), violating the skill's partial-failure rule (Pattern 7). The raw exception escapes to `GlobalErrorEnvelopeMiddleware` → opaque 500.
- **Secondary:** `creators` loop (lines 86–100) does `"lastName" in c` on items that may be strings — substring test silently yields wrong author data instead of skipping.
- **Fix:** Validate/coerce per item inside the loop:
  ```python
  issued = data.get("issued")
  parts = issued.get("date-parts") if isinstance(issued, dict) else None
  year_raw = (parts[0][0] if parts and parts[0] else "") if isinstance(parts, list) else ""
  ```
  Wrap the per-item body in `try/except Exception` that increments `skipped_count` and logs, mirroring the `_guarded` pattern already used in `literature_search_service.py:71–92`.

---

### [H-2] Corrupted/unreadable provider-key store is silently reset — permanent loss of saved API keys, zero logging

- **File:** `apps/api/app/services/provider_settings.py:114–127` (load) and `:130–133` (save)
- **Severity:** HIGH
- **Snippet:**
  ```python
  try:
      data = json.loads(path.read_text(encoding="utf-8"))
  except Exception:
      return {"providers": {}, "active": None, "rate_limit_rpm": None}   # silent!
  ...
  def _save_store(store):
      path.parent.mkdir(parents=True, exist_ok=True)
      path.write_text(json.dumps(store, indent=2), encoding="utf-8")      # non-atomic
  ```
- **Impact:** Any transient problem (partial write from crash/power loss, permission error, disk-full during a prior save) makes `_load_store()` return the empty default **without logging**. The very next `set_provider_config` / `set_autocomplete_settings` call persists that empty store, **irreversibly overwriting every stored cloud API key** (the product's core configuration). Nothing appears in logs; the user just sees providers "not configured". This is exactly the "swallowed error without logging → silent data loss" anti-pattern.
- **Fix:**
  1. Log at `logger.exception`/`error` when parsing/reading fails, including path.
  2. Never auto-overwrite on load failure: keep a quarantine copy (`provider_keys.json.corrupt-<ts>`) before any subsequent `_save_store`.
  3. Make saves atomic: write temp file + `os.replace`.
  4. Distinguish `FileNotFoundError` (legit first run) from other `OSError`/`JSONDecodeError`.

---

### [H-3] Collaboration relay loop dies silently — cross-worker realtime sync stops with no log and no restart signal

- **File:** `apps/api/app/api/v1/endpoints/collaboration.py:92–118`
- **Severity:** HIGH
- **Snippet:**
  ```python
  except asyncio.CancelledError:
      pass
  except Exception:
      self._relay_task = None          # swallowed: NO logger call
  ```
- **Impact:** Any Redis pub/sub hiccup (connection drop, timeout) raises inside `_relay_loop`; the task resets its own handle so a *future* `connect()` may recreate it, but until then **every worker-to-worker broadcast is black-holed** while same-process sockets keep working — a maddening, invisible split-brain for multi-user editing. Violates "log with context" (#9) and "preserve context" fundamentals.
- **Fix:** `logger.exception("Collaboration relay terminated")` in the handler; add exponential-backoff reconnect inside the loop rather than relying on the next WebSocket connection.

---

### [M-1] Invalid/expired JWTs are silently downgraded to the auto-provisioned local **admin** user

- **Files:** `apps/api/app/services/auth.py:116–129`; related `endpoints/auth.py:99–102`
- **Severity:** MEDIUM (security-adjacent error handling)
- **Snippet:**
  ```python
  try:
      payload = decode_token(auth.credentials, expected_type="access")
      ...
  except jwt.InvalidTokenError:
      pass                                   # silent
  return get_or_create_local_user(db)        # ...who is_admin=True
  ```
- **Impact:** A client presenting an expired/tampered/wrong-type token receives **no 401 feedback** and is transparently re-identified as the local admin account. By design for "single-user local mode", but the *swallow* means: (a) ops cannot distinguish attack traffic from local mode in logs; (b) any future tightening of this function inherits the silent fallback. `refresh_tokens` (endpoint auth.py:101) likewise maps **every** exception class to a generic 401 without logging, hiding e.g. key-misconfiguration bursts.
- **Fix:** Keep the fallback, but `logger.info("Invalid bearer token (%s); falling back to local user", type(exc).__name__)` — rate-limited to avoid spam. In `refresh_tokens`, narrow the catch to `jwt.PyJWTError` and log unexpected classes separately.

---

### [M-2] Rate limiter trusts `X-Forwarded-For` blindly and grows memory without bound

- **File:** `apps/api/app/core/rate_limit.py:18–22, 29–45`
- **Severity:** MEDIUM
- **Snippet:**
  ```python
  forwarded_for = request.headers.get("x-forwarded-for")
  if forwarded_for:
      return forwarded_for.split(",")[0].strip()
  ...
  self._hits: Dict[str, deque] = defaultdict(deque)   # never evicted per-key
  ```
- **Impact:** (a) Any client can rotate a spoofed `X-Forwarded-For` header per request and **completely bypass** login/register rate limiting (defeats the abuse control the limiter exists for). (b) Each unique spoofed IP creates a `deque` entry that is never removed (windows are pruned lazily per-key only when that key is seen again) → unbounded memory growth = cheap DoS vector.
- **Fix:** Only honor `X-Forwarded-For` when the peer is a configured proxy (`settings.TRUSTED_PROXIES`); cap `self._hits` (LRU with max-size + periodic sweep like `provider_cache_service.max_entries`).

---

### [M-3] HTTP client singletons mutate module globals without locks — leaked sockets under concurrency

- **File:** `apps/api/app/core/http_client.py:43–56, 77–95`
- **Severity:** MEDIUM
- **Snippet:**
  ```python
  def get_async_http_client():
      global _async_client, _async_client_loop_id
      ...
      fresh = httpx.AsyncClient(...)
      _async_client = fresh            # check-then-act, no lock
      _async_client_loop_id = loop_id
  ```
- **Impact:** Two threads hitting the stale-path concurrently each construct an `AsyncClient`; one reference wins, the loser is garbage-collected unclosed → **leaked connection pools** (socket warnings at GC). Same pattern in `init_http_client`. Under uvicorn workers with background threads (Tabby autostart uses sync client; lit-search uses async), interleavings are realistic. The dead-loop close guard (`close_http_client`, line 65) shows awareness of the lifecycle hazard, but creation is unprotected.
- **Fix:** Guard with `threading.Lock` around create/replace; or use a per-event-loop registry keyed by `loop_id`.

---

### [M-4] Provider-cache failures are logged at DEBUG — invisible in production; cache structures are not thread-safe

- **File:** `apps/api/app/services/provider_cache_service.py:52–66, 68–121`
- **Severity:** MEDIUM
- **Snippets:**
  ```python
  except Exception as e:
      logger.debug("Redis not available, using in-memory LRU cache: %s", e)   # :63–64
  except Exception as e:
      logger.debug("Redis get error for key %s: %s", key, e)                   # :94–95
  ```
  plus unlocked `OrderedDict` mutation (`move_to_end`, `popitem`, `del`) at :72–113.
- **Impact:** (a) If Redis is configured but flaky, prod logs (INFO+) show nothing while every lookup silently double-misses → quota counters inflate, latency rises; operators have no signal. Skill rule: *"Log with context"* — a degraded dependency deserves ≥ WARNING (with dedup/throttle). (b) `OrderedDict.move_to_end/popitem` from multiple FastAPI threadpool threads can raise `RuntimeError` (dict changed size) or corrupt LRU order; there is no lock anywhere in the class. (c) `_redis_checked` flag (:53) is a check-then-act race that can construct two Redis clients.
- **Fix:** Promote Redis errors to `logger.warning` with periodic suppression; wrap `_cache` mutations in a `threading.Lock`; guard `_get_redis` initialization identically.

---

### [M-5] Plugin hook failures are never logged — `execute_hook()` discards the execution log entirely

- **File:** `apps/api/app/services/plugin_runtime.py:98–110` (+ `plugin_service.py:177–184`)
- **Severity:** MEDIUM
- **Snippet:**
  ```python
  except Exception as exc:
      executions.append({"plugin_id": plugin.plugin_id,
                         "status": "error", "error": str(exc)})    # no logger.*
  ...
  result, _executions = dispatch_hook(db, hook_name, payload)       # discarded
  ```
- **Impact:** The docstring promises "a failing plugin never breaks the dispatch loop" (good isolation), but nothing records the failure server-side unless a caller happens to use `execute_hook_detailed`. All built-in enrichment paths (`PluginService.execute_hook`) throw away the log → broken plugin entrypoints produce silent data degradation (e.g., missing `doi_url`, missing LaTeX transform) that is undiscoverable from logs.
- **Fix:** `logger.warning("Plugin %s failed on hook %s: %s", plugin.plugin_id, hook_name, exc)` inside the handler; optionally include `executions` summary at DEBUG in `execute_hook`.

---

### [M-6] Unvalidated identifiers interpolated into external API URLs (Crossref / arXiv / PubMed)

- **File:** `apps/api/app/services/identifier_resolver.py:82, 179, 252` (also `resolve_pmid` reachability from `add-by-identifier` endpoint, `endpoints/citations.py:270`)
- **Severity:** MEDIUM
- **Snippets:**
  ```python
  url = f"https://api.crossref.org/works/{doi}"                     # :82
  url = f"http://export.arxiv.org/api/query?id_list={clean_id}"     # :179
  url = f"...esummary.fcgi?db=pubmed&id={pmid}&retmode=json"        # :252
  ```
- **Impact:** The cleaners strip known prefixes but perform **no charset validation**: a "PMID" of `12345&term=x` or an "arXiv id" containing `?`/`#` alters the upstream query. The resolver is fed directly from `AddByIdentifierRequest.identifier: str` (models.py:401–404, no pattern constraint). Consequences: SSRF-shaped parameter manipulation against fixed hosts (limited blast radius since scheme/host are hardcoded), cache-key pollution (`f"pmid:{pmid}"`), and junk records. Skill: *"Validate inputs early… Convert to domain types at boundaries."*
- **Fix:** Enforce canonical formats post-clean and reject otherwise: DOI `^10\.\d{4,9}/\S+$`, arXiv `^\d{4}\.\d{4,5}(v\d+)?$`, PMID `^\d{1,9}$` (the detector already has these regexes — reuse them as gatekeepers, returning `extraction_status="unresolved"` or 422).

---

### [M-7] Broad `except Exception` in resolvers conflates bugs with outages behind an "unresolved" sentinel

- **File:** `apps/api/app/services/identifier_resolver.py:139, 234, 299`
- **Severity:** MEDIUM
- **Snippet:**
  ```python
  except Exception as exc:
      logger.warning("Crossref resolution failed for DOI %s: %s", doi, exc)
  return self._unresolved(...)
  ```
- **Impact:** Logging exists (good), but `TypeError`/`KeyError` from a refactor lands in the identical warning channel and identical `extraction_status="unresolved"` payload as a genuine Crossref outage. Callers (`endpoints/citations.py:272`) then tell users "Verify the identifier" for what is really a server bug — misleading diagnosis, suppressed alerts.
- **Fix:** Catch `httpx.HTTPError` (and `(ValueError)` around `resp.json()`) explicitly; let programming errors propagate to the envelope; tag unresolved results with a coarse `reason` (`timeout` / `http_{status}` / `parse`).

---

### [M-8] LLM availability probes swallow the exception itself — "unreachable" hides *why*

- **File:** `apps/api/app/services/llm_service.py:74–79, 143–148` (and INFO-level fallback log :81–86, :151–152)
- **Severity:** MEDIUM
- **Snippet:**
  ```python
  try:
      resp = client.get(f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/tags", timeout=2.0)
      self._available = resp.status_code == 200
  except Exception:
      self._available = False                # exc discarded
  ```
- **Impact:** DNS failure vs connection-refused vs TLS error vs bug are indistinguishable; the follow-up INFO line says only "unreachable". During incident triage of AI features you cannot tell whether Ollama is down, slow, or misconfigured. Generation paths do better (`:118–119`, `:208–209` log `%s` of exc at WARNING) — inconsistent strategy within one class.
- **Fix:** `except Exception as exc: logger.warning("Ollama probe failed: %s", exc)` and include the exception class in the cached-state log.

---

### [M-9] Health endpoint reports component failure without ever logging the cause

- **File:** `apps/api/app/api/v1/endpoints/health.py:23–28, 35–40`
- **Severity:** MEDIUM
- **Snippet:**
  ```python
  except Exception:
      components["database"] = "unhealthy"
      overall = "unhealthy"                  # no logging of exc
  ```
- **Impact:** `/health` flips to 503/degraded while the root cause (pool exhausted? DB migrated away? Redis socket timeout?) appears nowhere — the one place designed for diagnostics discards them. Also reaches into `provider_cache_service._get_redis()` private state (layering smell, papers.py:549-style).
- **Fix:** `logger.exception("Health check: database probe failed")` / equivalent for Redis; expose a public `provider_cache_service.ping_redis()`.

---

### [M-10] Malformed `CORS_ORIGINS` env JSON silently ignored (`except Exception: pass`)

- **File:** `apps/api/app/core/config.py:48–51`
- **Severity:** MEDIUM (config correctness)
- **Snippet:**
  ```python
  try:
      return json.loads(v)
  except Exception:
      pass                                    # falls through to comma-split
  return [i.strip() for i in v.split(",") if i.strip()]
  ```
- **Impact:** `CORS_ORIGINS='["https://app.example.com"]'` with a stray character degrades to comma-splitting the raw string → origins become literal `["https://app.example.com"]`-ish garbage; browser calls start failing CORS with zero log output. Fail-fast principle (skill Pattern 1) applies to configuration too.
- **Fix:** On JSON-parse failure of a bracketed value, `raise ValueError(...)` (startup crash > runtime mystery) or at minimum `logger.warning("CORS_ORIGINS looked like JSON but failed to parse; using comma-split")`.

---

### [M-11] Errors raised *inside* SSE generators truncate streams with no error frame — clients see silent hangs/success-looking failures

- **Files:**
  - `apps/api/app/api/v1/endpoints/ai_writing.py:80–83` + `services/ai_writing_service.py:172–174` (`AIProviderUnavailableError` raised inside async generator after `StreamingResponse` begins),
  - `apps/api/app/api/v1/endpoints/chat.py:98–108` (`event_stream` has no try/except; any RAG/LLM error mid-iteration kills the stream),
  - `apps/api/app/api/v1/endpoints/collaboration.py` WS loop handles this correctly (contrast).
- **Severity:** MEDIUM
- **Impact:** Once Starlette has sent `200` + `text/event-stream` headers, raising produces a truncated body: the frontend cannot distinguish "done" from "crashed", and the global 500 envelope **cannot fire** (headers already sent). For `stream-autocomplete`, the most common failure (`AIProviderUnavailableError`) surfaces as a broken fetch instead of the intended 503 mapping used by the non-streaming sibling (`_map_ai_errors`, ai_writing.py:25–28) — an inconsistent error contract between two layers of the same feature.
- **Fix:** Wrap generator bodies:
  ```python
  def event_stream():
      try:
          yield from ...
      except Exception as exc:
          logger.exception("chat stream failed")
          yield sse({"type": "error", "code": "stream_failed"})
  ```
  and pre-flight the provider check *before* constructing `StreamingResponse` where feasible.

---

### [M-12] Missing bounds on chat/RAG request models feed unbounded values into retrieval and scoring

- **File:** `apps/api/app/schemas/models.py:307–312 (ChatRequest), 340–345 (RAGSearchRequest), 445–451 (AutocompleteRequest), 485–493 (AIEditRequest)`
- **Severity:** MEDIUM
- **Details:**
  - `RAGSearchRequest.limit: int = 5` — no `ge/le`. `limit=10_000_000` makes `hybrid_search`'s heap retain **every** chunk row (rag_service.py:430–433) → memory spike per request. `threshold: float = 0.2` accepts negatives/nan-ish values, silently changing recall semantics.
  - `ChatRequest.message: str` / `AIEditRequest.text: str` — no max length; message goes verbatim into embedding + lexical scan and prompt assembly (prompt side truncates at `LLM_MAX_CONTEXT_CHARS`, but DB/CPU work doesn't).
- **Impact:** Unvalidated-input-before-use violation; trivial resource-amplification from an authenticated client.
- **Fix:** `Field(ge=1, le=50)` for limit, `Field(ge=0, le=1)` threshold, `max_length=` (e.g., 32k) on free-text fields; align with `research.py:16–49`, which already models excellent Query-level validation.

---

### [M-13] WebSocket endpoint pins the request-scoped DB session for the socket's lifetime

- **File:** `apps/api/app/api/v1/endpoints/collaboration.py:226–244` (`db: Session = Depends(get_db)`)
- **Severity:** MEDIUM (resource lifecycle / race-adjacent)
- **Impact:** `get_db` (core/database.py:29–34) closes only after the response completes — for a WS that is hours later. Each collaborator holds a pooled connection indefinitely; SQLite/Postgres pool exhaustion presents as mysterious 500s on unrelated endpoints. Correctly, `_persist_doc_edit` (:40–61) opens its **own** session with try/rollback/finally — proving the fix pattern in-house.
- **Fix:** Use a short-lived session per persisted event (as `_persist_doc_edit` does) and drop the dependency, or resolve identity once then release.

---

### LOW findings

| # | Location | Snippet / Issue | Impact & Fix |
|---|---|---|---|
| L-1 | `literature_search_service.py:86–91`; `zotero_service.py:51,68`; `endpoints/provider_settings.py:82,97,124`; `endpoints/plugins.py:51,78` | `str(exc)` embedded in client-visible `error`/`detail`/`message` | Raw `httpx.ConnectError` text leaks internal hostnames/timeouts to clients. Map exception → stable code + safe message; keep details in logs. |
| L-2 | `services/auth.py:95–103` vs `endpoints/version_history.py:41–49` | IntegrityError retry exhausts → bare `raise` | After 3 retries the unique-constraint collision surfaces as 500 via envelope; should map to `409 Conflict`. Same for concurrent team-member inserts (`teams.py` add path has no IntegrityError handling). |
| L-3 | `endpoints/teams.py:245–254, 283–292` | count-then-commit "last owner" guard | TOCTOU: two concurrent demotions/removals both pass the count check → ownerless team. Enforce via DB constraint or `SELECT … FOR UPDATE` / serializable retry. |
| L-4 | `endpoints/papers.py:309–312` | `os.path.exists` check then `FileResponse` | File deleted between check and open → `RuntimeError` → 500 instead of 404. Wrap in try/`HTTPException(404)` or let FileResponse raise and translate. |
| L-5 | `services/pdf_extractor.py:294` | `import pdfplumber` inside method, no ImportError guard | Missing optional dependency → unhandled ImportError → 500 on *upload* despite GROBID-first design intent; also `:130–131` logs real GROBID errors at INFO (should be WARNING with `exc_info`). |
| L-6 | `services/tabby_setup_service.py:67–71` | `except Exception: return None` in `_read_version`, fully silent | Version probe failure indistinguishable from absent binary; add DEBUG log. Rest of the module is exemplary ("never raises" contract honored). |
| L-7 | `services/provider_settings.py:85–86` | `raise ValueError("Rate limit must be…")` inside `except (TypeError, ValueError)` | Missing `from exc` chaining — loses original repr. Use `raise ValueError(...) from exc`. Same for `plugin_runtime.py:38–47` (acceptable: new validation, but be consistent). |
| L-8 | `endpoints/papers.py:549` | `rag_service._llm_grounded_answer(...)` | Endpoint reaching into a private service method — encapsulation break that will bite when the private signature evolves. Add a public alias. |
| L-9 | `endpoints/auth.py:101–102` | `except Exception: raise credentials_exception` | Over-broad: masks `AttributeError`/config bugs as 401. Narrow to `jwt.PyJWTError`; log others at ERROR. |
| L-10 | `core/http_client.py:59–74` | `close_http_client` closes sync client outside try | If `sync.close()` throws (rare), async globals already nulled → skip straight to INFO log; harmless but asymmetric with the carefully-guarded async path above it. |

### INFO findings

| # | Location | Observation |
|---|---|---|
| I-1 | Repo-wide | **Exception hierarchy is thin and unrooted**: `PDFExtractionError(Exception)`, `ZoteroAPIError(Exception)`, `AIProviderUnavailableError(RuntimeError)`, `PluginEntrypointError(ValueError)`, ad-hoc `ValueError` for provider/literature/export validation. No common `OpenResearchError` base ⇒ endpoints must enumerate concrete types (`ai_writing.py:56,111`), and future services can't be caught generically. Introduce `class AppError(Exception)` with `status_code` + `client_message`, map centrally. |
| I-2 | `literature_search_service.py:400–446`, `identifier_resolver.py:181–211` | arXiv Atom XML parsed with string-split + regex; malformed feeds silently yield "Untitled"/empty authors rather than a parse-status flag. Consider `xml.etree` (already imported in `pdf_extractor`). |
| I-3 | `middleware.py:21–68` | `BaseHTTPMiddleware` envelope cannot intercept failures raised *during* response streaming (see M-11); document this boundary in §3.5 docs. |
| I-4 | `main.py:42–59` | Background Tabby thread is correctly daemonized and its failures logged with `exc_info=True`; migration failures deliberately crash startup (fail-fast — correct). |
| I-5 | `services/intelligence_service.py`, `rag_service.py` | Pure-compute services intentionally contain no try/except; DB errors bubble to the global envelope. Consistent "let-it-crash at edges" policy — acceptable, worth documenting as the official strategy. |
| I-6 | `services/graph_service.py:212–225` | Discovery path: broad except → `[]` with WARNING log and docstring contract ("never fabricates"). Good pattern; would benefit from distinguishing HTTP≠200 (already logged separately :222–223). |
| I-7 | `alembic/env.py`, `plugins/*.py` | No exception-handling defects found. Built-in plugins are pure functions whose failures are isolated by `dispatch_hook` (but see M-5 for the missing logging). |

---

## Error-Flow Architecture Assessment

**Current shape (three coexisting strategies):**

1. **Envelope-at-edge (global):** `GlobalErrorEnvelopeMiddleware` (core/middleware.py:47–68) catches anything unhandled → generic `INTERNAL_SERVER_ERROR` + `request_id`, `logger.exception` preserves the traceback internally. ✅ Prevents internals leakage; ✅ correlation IDs sanitized against log injection (regex `[A-Za-z0-9_-]`, capped 64 chars).
2. **Sentinel-return (AI/providers):** `llm_service.generate()/stream_generate()` contractually "never raises", returns `None`/empty; `identifier_resolver` returns `extraction_status="unresolved"`; `tabby_setup_service` "never raises", returns honest status dicts. ✅ Excellent UX honesty; ⚠️ but combined with broad excepts it erases the bug/outage distinction (M-7, M-8).
3. **Raise-and-map (validation/auth/plugins/export):** `ValueError`/domain exceptions raised in services → endpoints translate to 400/404/409/503 (`export.py:55`, `ai_writing.py:56`, `provider_settings.py:81`, `plugins.py:50`). ✅ Cleanest layering; ❌ applied inconsistently (e.g., SSE paths bypass it, M-11; IntegrityError unmapped, L-2).

**Gaps in the architecture:**

- **No shared exception base** ⇒ every translation site hand-enumerates types; adding a new domain exception requires touching N endpoints (I-1).
- **Streaming boundary undefined** — the envelope strategy simply stops working for SSE/WS bodies; there is no in-band error-frame convention enforced across `chat/stream`, `stream-autocomplete`, and collab WS (M-11).
- **Logging levels encode importance inconsistently** — real degradation sits at DEBUG (Redis, M-4) and INFO (GROBID, L-5) while benign probes sit at WARNING; triage by log level is unreliable today.
- **Silent-swallow hotspots cluster around infrastructure** (Redis init/relay, token validation, CORS config, provider store) rather than business logic — precisely where operators need signal most (H-2, H-3, M-1, M-4, M-9, M-10).

---

## Positive Observations

The audit found substantial strengths worth preserving as reference patterns:

1. **Zero bare `except:` clauses** across 89 handlers — rare and commendable.
2. **Global error envelope** with request-ID echo and *no* stack traces/internal messages in responses (middleware.py:58–67); client-supplied `X-Request-ID` sanitized to prevent log injection (:18, :30).
3. **Exemplary partial-upload safety** in `papers.py:101–132`: streamed size enforcement, first-chunk magic-byte check, partial-file removal on failure with `re-raise`, and OSError-tolerant cleanup logging.
4. **Honest-degradation fallbacks**: total extraction failure still stores a truth-labeled record (`papers.py:142–161`); RAG indexing failure doesn't lose the paper (:183–186); discovery "never fabricates recommendations" (`graph_service.py:188–196`).
5. **Per-source fan-out isolation** with structured per-provider error payloads (`literature_search_service.py:71–94`) — textbook skill Pattern 7.
6. **Commit-race handling done right twice**: `get_or_create_local_user` rollback-and-requery (`services/auth.py:95–105`) and bounded version-number retry on IntegrityError (`version_history.py:36–49`).
7. **Fail-fast production config guards** (`config.py:90–110`) refusing weak secrets/SQLite in production; deliberate startup crash when `alembic.ini` is missing (`main.py:26`).
8. **Injectable, never-raising system-service design** in `tabby_setup_service` (health_probe/popen/run injectable; honest status dicts incl. port-conflict messaging) — highly testable error UX.
9. **Proactive Unicode hardening**: `sanitize_surrogates` prevents late `UnicodeEncodeError`s from lone-surrogate JSON (text_utils.py:11–24), used in intelligence flows.
10. **Consistent authorization preconditions**: uniform `_check_*_access` helpers raising precise 404/403 across nearly every endpoint, with role-scoped variants.
11. **Strong research-endpoint validation**: `research.py:16–49` validates source whitelist, year ordering, ranges — the model other request models should copy (M-12).
12. **WebSocket hardening**: first-frame auth with timeout, frame-size cap, sliding-window rate limit, `logger.exception` on unexpected socket errors, guaranteed presence cleanup in `finally` (collaboration.py:226–354).

---

## Prioritized Recommendations

### P0 — Fix now (data loss & crash-on-user-input)

1. **H-2**: Log + quarantine on unreadable `provider_keys.json`; atomic `_save_store` via `tempfile` + `os.replace`. *(~20 LOC)*
2. **H-1**: Defensive parsing of CSL `issued`/`creators` + per-item try/except with `skipped_count` accounting in `import_csl_or_api_data`. *(~15 LOC)*
3. **H-3**: `logger.exception` in relay-loop failure + in-loop reconnect/backoff. *(~8 LOC)*

### P1 — Next sprint (observability & trust)

4. **M-1/M-9/M-10**: Replace the four silent swallows (`InvalidTokenError: pass`, health-probe excepts, CORS `pass`) with contextual logging; narrow `refresh_tokens` catch to `jwt.PyJWTError`.
5. **M-4**: Raise Redis error logs DEBUG→WARNING (throttled); add a lock around `ProviderCacheService` internals and `_get_redis` init.
6. **M-5**: Log plugin hook failures in `dispatch_hook`; stop discarding executions in `execute_hook`.
7. **M-11**: Standardize SSE/WS in-band error frames (`{"type":"error","code":...}`) via a shared decorator/helper; pre-flight provider availability before starting streams.
8. **M-2**: Trust `X-Forwarded-For` only behind configured proxies; bound the limiter's key space.

### P2 — Scheduled hygiene

9. **I-1**: Introduce `AppError(status_code, code, message)` hierarchy; central exception→HTTP mapper registered on the app; migrate `ValueError`-mapping endpoints incrementally.
10. **M-6**: Gate identifiers with the detector regexes before URL interpolation; add `test_` coverage for hostile identifier strings.
11. **M-12**: Add `Field` bounds to `ChatRequest`, `RAGSearchRequest`, `AIEditRequest`, `AutocompleteRequest`, `ZoteroImportRequest` (incl. content-size caps).
12. **M-3**: Lock-protect HTTP-client singleton creation; consider per-loop registries.
13. **L-1..L-10**: Apply low-cost fixes as touched (exception chaining `from exc`, 409 mapping for exhausted version retries, 404-safe PDF streaming, WARNING for GROBID fallback, ImportError guard for pdfplumber, TOCTOU guards for last-owner and PDF existence).

### Process suggestions

- Add a lint gate (e.g., `ruff` rules `BLE001`, `TRY`/`EM` families, `S110 try-except-pass`) tuned to allow the documented sentinel-return modules — this converts the audit's findings into CI-enforceable policy.
- Adopt a one-page "error strategy" ADR codifying the three lanes observed here (envelope / sentinel / raise-and-map) and the SSE error-frame contract, so new services stop reinventing conventions.

---

*End of report — generated by read-only static audit; no application files were modified.*
