# Memory & Resource Leak Audit - OpenResearch Monorepo

- **Audit ID:** 16-memory-leak-audit
- **Date:** 2026-08-26
- **Mode:** READ-ONLY audit (no files modified)
- **Skill applied:** memory-leak-audit (disposable/lifecycle discipline adapted to React hooks + FastAPI lifecycles)
- **Scope:** apps/web/src/{app,components,context,i18n,lib}, packages/editor/src (frontend); apps/api/app/** (backend)

---

## Scope & Methodology

### What was examined

| Area | Files reviewed | Focus |
|---|---|---|
| Frontend contexts | WorkspaceContext.tsx, DocumentContext.tsx, PaperContext.tsx, ProjectContext.tsx, AuthContext.tsx | Provider value identity, effect teardown, timers, fetch lifecycle |
| Frontend components | All .tsx files under apps/web/src/components/** and route pages | useEffect cleanup, listeners, observers, timers, streaming readers |
| Editor package | packages/editor/src: AcademicEditor.tsx, ghostText.ts, AIContinuationCard.tsx, CitationPopover.tsx | TipTap/ProseMirror plugin state, ghost-text debounce timer, DOM widget handlers, autosave interval |
| API client layer | lib/api/client.ts, chat.ts, aiWriting.ts + all endpoint modules | AbortController usage, stream reader release, timeouts |
| Backend core | main.py, core/database.py, core/config.py, core/http_client.py, core/rate_limit.py, core/middleware.py | Pool sizing, singleton lifecycles, unbounded process-global state |
| Backend endpoints | All 20 files under api/v1/endpoints/ incl. collaboration.py (WebSocket), chat.py / ai_writing.py / export.py (StreamingResponse), papers.py (upload/delete) | Dependency-injected session lifetime vs connection duration, generator finalization, temp-file policy |
| Backend services | llm_service.py, rag_service.py, ai_writing_service.py, tabby_setup_service.py, provider_settings.py, provider_cache_service.py, pdf_extractor.py, plugin_runtime.py, zotero_service.py, literature_search_service.py, identifier_resolver.py, auth.py, version_history.py, export pipeline | httpx client reuse, subprocess spawn/kill paths, LRU/cache bounds, thread usage, SSE finalization |

### Method

1. Loaded the memory-leak-audit skill; mapped its six checks (DOM listeners, one-time events, repeated-method registration, model-tied stores, resource pools, test validation) onto React hooks equivalents (effect cleanup, abort signals, memoized provider values) and FastAPI equivalents (dependency-with-yield lifetime vs socket lifetime, generator finally blocks, bounded module-level state).
2. Grepped both trees for every leak-relevant primitive:
   - Frontend: addEventListener/removeEventListener, setInterval/setTimeout/clearTimeout/clearInterval, ResizeObserver/IntersectionObserver/MutationObserver, AbortController, EventSource, WebSocket, requestAnimationFrame.
   - Backend: SessionLocal(, Depends(get_db), AsyncClient(/httpx.Client(, lru_cache, subprocess/Popen/create_subprocess, tempfile/NamedTemporaryFile, BackgroundTasks/add_task, threading.Thread, asyncio.create_task, while True, StreamingResponse, websocket.
3. Read every flagged site in full context to confirm whether cleanup exists and is reachable on all exit paths (exception / disconnect / unmount), and to quantify growth rate and blast radius.
4. Classified findings CRITICAL / HIGH / MEDIUM / LOW / INFO with file:line, mechanism, snippet, fix.

Ignored per instructions: node_modules, .venv, .next, __pycache__, coverage, caches, contents of storage/uploads, logs.

---

## Executive Summary

| Severity | Count | Findings |
|---|---|---|
| CRITICAL | 1 | B-01 WebSocket-pinned DB session vs default pool size (pool exhaustion) |
| HIGH | 2 | F-01 chat SSE stream never aborted on unmount; B-02 unbounded rate-limiter key space (spoofable XFF) |
| MEDIUM | 7 | F-02 stream reader never cancelled + no request timeouts; F-03 unbounded chat transcript; F-04 ghost-text races/no cancellation; F-05 non-memoized context values; B-03 orphaned Tabby server process + unbounded log; B-04 stale AsyncClient swapped without close; B-05 SSE generators pin DB session during LLM streaming |
| LOW | 5 | F-06 uncleared setTimeout toast/copy timers (~14 sites); F-07 innerHTML interpolation in ghost-text badge; F-08 localStorage full-document serialization churn; B-06 orphaned upload files when post-write validation fails; B-07 zombie WS entries after swallowed broadcast errors |
| INFO | 5 | F-09 stale closures inside useEditor callbacks; F-10 minor no-cleanup sites (rAF, PdfReader AI modal); B-08 plugin _RESOLUTION_CACHE; relay task not cancelled at shutdown; misc notes |

**Headline risks**

1. **Collaboration WebSocket pins a pooled DB session for the life of the connection** (collaboration.py:230). With SQLAlchemy defaults (pool_size=5, max_overflow=10) roughly the 16th concurrent collaborator stalls on "QueuePool limit reached" until timeout; ordinary HTTP traffic makes it worse. Long-lived sockets make this an availability bug that worsens over hours.
2. **No frontend fetch anywhere uses an AbortController** (zero occurrences in apps/web/src). The streaming API even accepts a signal parameter (lib/api/chat.ts:71) but no caller passes one; navigating away mid-answer leaves orphaned streams reading the network into unmounted component state.
3. **The auth rate limiter keeps one deque per unique client key forever**, keyed by spoofable X-Forwarded-For - a slow silent memory-exhaustion vector.

---

## Frontend Leak Findings

### F-01 - HIGH - Chat SSE stream has no AbortController; abandoned streams keep running after unmount

**Files:** apps/web/src/components/chat/AiResearchChat.tsx:171-204 (caller); apps/web/src/lib/api/chat.ts:67-72 (signal supported, never passed); apps/web/src/lib/api/client.ts:85-137 (transport).

```tsx
// AiResearchChat.tsx:171
await api.chat.sendStream(
  activeProject.id,
  { message: query, mode: activeMode, ... },
  { onMeta, onThinking, onContent, onError, onDone }   // no signal passed
);
```

```ts
// chat.ts:67-72 - the cancellation hook exists but is never used
sendStream: (
  projectId: string,
  data: AIChatSendPayload,
  handlers: AIChatStreamHandlers,
  signal?: AbortSignal          // always undefined in practice
): Promise<void> => ...
```

**Mechanism.** Every sent message opens a long-lived SSE POST. There is no AbortController anywhere in apps/web/src (verified by grep: zero occurrences). The (workspace) route group swaps children under a persistent shell, so navigating to another view unmounts AiResearchChat while the fetch continues:

- Each onContent delta calls patchMessage -> setMessages against an unmounted component; React 18 silently no-ops, but the closure chain (entire messages array, handlers, decoder buffers) stays reachable until the stream ends.
- The HTTP connection and reader stay allocated for the full generation time (backend LLM_TIMEOUT_SECONDS=20 plus slow-model overruns).
- There is no Stop-generating control at all; cancellation is impossible for users.

**Growth rate.** One orphaned stream per abandoned message; memory held is transcript + sources + stream buffers for remaining duration. Repeated navigate-away-during-stream cycles stack connections against the browser per-host limit (6 for HTTP/1.1), starving subsequent requests.

**Blast radius.** Wasted bandwidth and backend LLM tokens; delayed GC of large message arrays; temporary browser connection starvation.

**Fix.**
1. Create an AbortController per send in a ref; pass controller.signal to sendStream; abort in useEffect cleanup and wire a Stop button.
2. In client.ts streamRequest, wrap the read loop in try/finally and call reader.cancel() when exiting via exception or abort.
3. Guard patchMessage with a mounted ref so late frames are dropped cheaply.

---

### F-02 - MEDIUM - streamRequest never cancels/releases its reader; request() has no timeout or signal

**File:** apps/web/src/lib/api/client.ts:59-79 (request), 110-141 (stream loop).

```ts
const reader = response.body.getReader();      // line 114
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read(); // line 127: only exits via done or throw
  if (done) break;
  ...
}
```

**Mechanism.**
- If onFrame throws or fetch rejects mid-loop, there is no finally block calling reader.cancel()/releaseLock(). The body remains locked/undrained until GC finalizes it; the underlying connection may linger because the body was neither consumed nor cancelled.
- request() accepts no signal and sets no deadline: a hung backend leaves the promise pending indefinitely, retaining the caller's closure (usually an entire component's state). All list-loading effects funnel through this function.
- buffer grows unbounded if the server/proxy emits data without blank-line event framing; only complete events are drained.

**Growth rate.** Per hung request: one retained closure chain plus one buffered connection. Slow burn under flaky-network conditions, exactly when retries pile up.

**Blast radius.** Gradual tab memory growth; stuck loading spinners; possible socket exhaustion in long-lived tabs.

**Fix.** Add optional signal + timeout (AbortSignal.timeout or manual setTimeout+abort) to request(); try/finally with reader.cancel() in streamRequest; cap buffer size defensively (e.g., 1 MB) and fail fast beyond it.

---

### F-03 - MEDIUM - Chat transcript grows without bound in component state

**File:** apps/web/src/components/chat/AiResearchChat.tsx:81,154-158,192-195.

```tsx
const [messages, setMessages] = useState<ChatMessageItem[]>([]);   // never trimmed
...
onThinking: (text) => patchMessage(assistantId, (msg) => ({ ...msg, thinking: (msg.thinking || '') + text })),
onContent: (text) => patchMessage(assistantId, (msg) => ({ ...msg, content: msg.content + text })),
```

**Mechanism.** messages accumulates every user/assistant exchange for the lifetime of the mounted chat page. Each assistant message retains full content, thinking trace, and a sources array of GroundedPassage objects that embed complete passageText strings (often hundreds of words each, up to 4+ per message). String concatenation during streaming also creates intermediate garbage per token. historyPayload is sliced (-6) when sent upstream, but nothing prunes local state.

**Growth rate.** Roughly KBs per exchange; a day-long research session with hundreds of grounded answers can reach tens of MB in heap, all re-serialized through React reconciliation on every streamed delta (O(n) map per patchMessage).

**Blast radius.** Tab memory creep and UI jank during streaming in long sessions; not a crash risk on its own.

**Fix.** Virtualize/limit rendered transcript (window of N most recent), persist older turns to IndexedDB if needed, and batch streaming patches with requestAnimationFrame coalescing instead of one setState per token.

---

### F-04 - MEDIUM - Ghost-text autocomplete requests race and are never cancelled

**File:** packages/editor/src/components/AcademicEditor.tsx:307-332 (debounce), DocumentsView.tsx:60-79 (request handler).

```tsx
if (ghostTextTimeoutRef.current) clearTimeout(ghostTextTimeoutRef.current);
ghostTextTimeoutRef.current = setTimeout(async () => {
  ...
  const res = await onGhostTextRequestRef.current?.(prefix, paraText, 'Section');
  if (res && res.text) currentEditor.commands.setGhostText({ text: res.text, ... });
}, 700);
```

**Mechanism.** The 700ms debounce timer IS cleared correctly on unmount (AcademicEditor.tsx:471-474), which is good. However:
1. The in-flight async request is never aborted. Clearing the timer prevents new starts, not the one already dispatched; after unmount its continuation still runs and can call setGhostText on a destroyed editor instance (TipTap editor.destroy() happens on unmount; invoking commands afterwards throws or writes into detached ProseMirror state depending on version timing).
2. No sequence guard: typing "abc" quickly can produce overlapping requests whose responses resolve out of order; a slower stale response can overwrite a fresher ghost suggestion (correctness leak of stale data, plus wasted provider quota).
3. Deduplication is absent - pausing repeatedly at the same position re-fires identical requests.

**Growth rate.** Up to ~1.4 requests/second while typing with pauses; each holds prefix/paragraph context strings and an open connection until completion.

**Blast radius.** Provider-quota burn (hourlyCap mitigates: DocumentsView.tsx:70 checks cap before firing), stale-suggestion bugs, rare post-unmount command errors.

**Fix.** Keep a monotonically increasing requestId; ignore responses older than latest. Use AbortController per ghost request aborted on each keystroke and on unmount. Skip network call if prefix unchanged since last successful request.

---

### F-05 - MEDIUM - All five context providers build a fresh value object every render (no memoization)

**Files:** WorkspaceContext.tsx:639-700; DocumentContext.tsx:466-493; PaperContext.tsx:410-432; ProjectContext.tsx:195-209; AuthContext.tsx:29-35.

```tsx
// DocumentContext.tsx:467
<DocumentContext.Provider
  value={{ documents, activeDocument, isLoadingDocuments, saveStatus, stats, ... }}  // literal object, new identity each render
>
```

**Mechanism.** None of these providers memoize their context value (WorkspaceContext's modals object at line 287 IS memoized, but the top-level value is not; AuthContext builds value inline too). Any setState inside a provider gives the context a new value identity, forcing re-render of every consumer of that context. The compounding path: AcademicEditor onUpdate fires per keystroke -> updateStats -> DocumentContext setState -> entire workspace tree (WorkspaceLayout consumes all four contexts) re-renders on every keystroke of the document editor.

**Growth rate.** Not a memory leak per se; it is render amplification: O(consumers) extra reconciliations per keystroke, plus per-render allocation churn (new closures for ~40 callbacks in WorkspaceContext value).

**Blast radius.** Editor input latency on large documents; CPU burn; contributes to jank that mimics leaks in profiles (GC pressure from allocation churn).

**Fix.** Wrap each provider value in useMemo with precise dependency lists; split contexts (state vs actions) so high-frequency values (stats, saveStatus) live in their own narrow context consumed only by the status bar; keep action callbacks stable via useCallback.

---

### F-06 - LOW - setTimeout timers without clearTimeout (setState-after-unmount class)

**Sites (all in apps/web/src unless noted):**
- context/DocumentContext.tsx:418, 440, 443, 447, 461 (recentlyAddedRefId + toastMessage toasts)
- components/citations/CitationsManager.tsx:91, 97
- components/library/ResearchLibrary.tsx:111
- components/intelligence/ResearchGapAssistantView.tsx:130
- components/intelligence/LiteratureMatrixView.tsx:108
- components/shell/SourcePanel.tsx:101, 107
- components/modals/BibtexModal.tsx:117
- components/modals/ExportModal.tsx:109
- components/modals/ProviderQuotaModal.tsx:74
- components/intelligence/ResearchGraphView.tsx:58
- components/views/SettingsView.tsx:190 (window.setTimeout probe)

```tsx
// DocumentContext.tsx:439-440 pattern repeated across the app
setToastMessage('Citation inserted & bibliography updated');
setTimeout(() => setToastMessage(null), 3000);   // no cleanup handle retained
```

**Mechanism.** Timers fire after unmount; React 18 makes the setState a no-op, so this is not a hard leak, but each pending timer pins its closure (component state snapshot) for up to 3s and produces dev-mode warnings. The only component doing it correctly is AiResearchChat (modeToastTimerRef cleared at lines 90-94 and 120-121) - proof the codebase knows the pattern.

**Fix.** A tiny useTimedReset(value, ms) hook or storing timer ids in refs and clearing on unmount; lowest-priority cleanup.

---

### F-07 - LOW - Ghost-text badge builds DOM via innerHTML string interpolation

**File:** packages/editor/src/extensions/ghostText.ts:57-66.

```ts
badge.innerHTML = `<svg ...></svg><span>${topSource.authors || 'Source'}</span>`;
...
badge.onclick = (e) => { ... onInspectSource(...) };   // raw onclick property on widget DOM
```

**Mechanism.** Two issues at one site:
1. Security: topSource.authors / paperTitle come from backend extraction pipelines and external APIs; interpolating them into innerHTML is an HTML-injection sink (a crafted author string can inject elements). Not strictly a leak, but flagged during audit.
2. Leak-adjacent churn: every decoration render creates fresh span+svg+handler via createGhostTextSpan; ProseMirror discards the old widget DOM whenever ghost state updates. Handlers are per-widget and die with the node, so nothing accumulates persistently - but raw .onclick assignment is exactly the anti-pattern the memory-leak-audit skill flags for tracked listeners.

**Fix.** Build nodes with document.createElement/textContent (the span itself already does); escape or never interpolate API strings into HTML.

---

### F-08 - LOW - Full-document JSON re-serialized into localStorage on every autosave tick

**Files:** apps/web/src/context/DocumentContext.tsx:131-134, 342-379; packages/editor/src/components/AcademicEditor.tsx:104-114.

```tsx
const saveLocalDocuments = useCallback((projectId: string, items: DocumentItem[]) => {
  localStorage.setItem(`openresearch_docs_${projectId}`, JSON.stringify(items));   // ALL docs
}, []);
```

**Mechanism.** updateActiveDocument runs on every editor change; it synchronously JSON.stringify's the entire project document list (including content_json trees) onto the main thread, and the autosave interval repeats persistence every 15s even when idle-ish. Large documents mean multi-MB synchronous writes; localStorage quota (~5MB) can reject writes silently (no try/catch here), and main-thread stalls grow with document size.

**Growth rate.** Disk-quota pressure and latency growth proportional to corpus size; not heap growth.

**Fix.** Debounce local persistence, write only the mutated document key (per-doc keys), move bulk content to IndexedDB, wrap setItem in try/catch.

---

### F-09 - INFO - Stale closures captured by useEditor callbacks

**File:** packages/editor/src/components/AcademicEditor.tsx:215-261, 264-338.

editorProps.handleKeyDown reads isCitationPopoverOpen (line 252) and onUpdate reads enableGhostText/providerLatencyTier/isCitationPopoverOpen/atSymbolPos from the closure captured when useEditor created the editor once (@tiptap/react v2 does not recreate on re-render). The popover-open branch therefore never executes as intended (captured value is permanently false), and toggling the ghost-text setting requires an editor recreation to take effect. Callback refs (onSaveRef etc., lines 58-101) show the correct mitigation is already used elsewhere. This is a correctness/staleness finding surfaced by the stale-closure audit step; fix by mirroring such flags into refs like the handlers above.

### F-10 - INFO - Minor no-cleanup sites

- WorkspaceContext.tsx:201 announce() schedules requestAnimationFrame without cancel - harmless single-frame.
- PdfReader.tsx:138-173 handleAskAiPrompt awaits askPaperAi with no AbortController; unmount mid-request leaves aiLoading true in a detached tree until promise settles.
- CommentsPanel/OnlineSearchPanel/DocumentsView mount effects fetch without abort; DocumentContext refreshDocuments shows the right pattern already (loadRequestRef staleness guard, lines 103, 145-187) - replicate it where races matter.

---

## Backend Resource-Leak Findings

### B-01 - CRITICAL - WebSocket endpoint pins a pooled DB session for the connection lifetime

**File:** apps/api/app/api/v1/endpoints/collaboration.py:226-244 (endpoint), core/database.py:9,29-34 (engine/get_db).

```python
@router.websocket("/ws/collaborate/{document_id}")
async def websocket_collaboration(
    websocket: WebSocket,
    document_id: str,
    db: Session = Depends(get_db),      # line 230: held until socket closes
):
    await websocket.accept()
    user = await _authenticate_websocket(websocket, db, document_id)
    ...
    while True:                          # line 267: connection loop, hours-long
        data_text = await websocket.receive_text()
```

```python
# core/database.py:9 - engine uses SQLAlchemy DEFAULTS:
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
# default QueuePool: pool_size=5, max_overflow=10  ->  15 connections max per process
```

**Mechanism.** For WebSocket routes FastAPI holds yield-dependencies open until the socket disconnects (teardown runs after handler exit, i.e. after the final finally block). Every connected collaborator therefore removes one connection from the pool for the entire session duration. The session is needed only briefly inside _authenticate_websocket (auth + access check); afterwards it sits idle but checked out.

**Quantified exhaustion risk.**
- Pool capacity per worker: 5 + 10 = 15 connections.
- 15 concurrent WS clients = zero remaining capacity; the next DB-touching HTTP request (every endpoint uses get_db) blocks on pool checkout until pool_timeout (default 30s), then raises TimeoutError "QueuePool limit of size 5 overflow 10 reached".
- Realistic trigger: a team of ~12 collaborators plus any background traffic (health checks poll get_db too, health.py:13) exhausts the pool within seconds of the 15th socket. Sockets are long-lived (whole editing sessions), so recovery only happens when users leave.
- SQLite dev deployments sidestep QueuePool semantics differently (file locking), masking the bug locally; PostgreSQL production (enforced by config.py:105-109) hits it exactly.

**Blast radius.** API-wide: once the pool is exhausted by sockets, ALL endpoints 500/timeout - chat, documents, uploads - not just collaboration.

**Positive contrast already in file:** _persist_doc_edit (collaboration.py:40-61) correctly opens SessionLocal(), commits, and closes per edit via anyio.to_thread - the exact pattern the WS dependency should follow.

**Fix.** Remove db: Session = Depends(get_db) from the WS handler; inside _authenticate_websocket create a short-lived with SessionLocal() as db: scope and return only derived user_info (dict), never ORM objects. Optionally add explicit pool_size/max_overflow config to Settings so operators can size it, and consider engine disposal hooks in tests.

---

### B-02 - HIGH - Rate limiter keeps one deque per client key forever; key is spoofable X-Forwarded-For

**File:** apps/api/app/core/rate_limit.py:25-48.

```python
class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self._hits: Dict[str, deque] = defaultdict(deque)   # line 29: never evicted

    def check(self, key: str) -> None:
        ...
        hits = self._hits[key]           # any unseen key creates a permanent entry
        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()               # prunes only THIS key's timestamps
        ...
        hits.append(now)
```

```python
def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()   # client-controlled
    return request.client.host if request.client else "unknown"
```

**Mechanism.** Empty/expired keys are never deleted from _hits; only the timestamps within a recurring key are pruned. Every distinct IP (or XFF value) creates a dict entry that lives for the process lifetime. Because the limiter trusts the first XFF hop, an attacker rotating X-Forwarded-For: <random> on login/register endpoints mints unlimited keys.

**Growth rate.** ~150-300 bytes per key (string + deque overhead). 1M spoofed requests -> roughly 0.2 GB resident growth that never returns; 10M -> multi-GB, plus dict lookup degradation.

**Blast radius.** Slow memory-exhaustion DoS against every API worker; also makes the limiter ineffective for the real attacker since each spoofed key has its own budget. Currently applied to auth login/register endpoints (settings LOGIN/REGISTER_RATE_LIMIT_*) - internet-facing paths.

**Fix.** Periodically sweep stale keys (e.g., on check, when len(self._hits) > N drop expired deques; or a background task every window); cap total keys with an LRU; only honor XFF from a trusted proxy count (uvicorn --proxy-headers + FORWARDED_ALLOW_IPS), else fall back to request.client.host.

---

### B-03 - MEDIUM - Tabby server spawned detached with no handle retained and no kill path anywhere

**Files:** apps/api/app/services/tabby_setup_service.py:167-181 (_spawn_server), 183-218 (start_if_enabled); main.py:42-59; provider_settings.py / provider_settings endpoint thread at provider_settings.py:128 (threading.Thread daemon).

```python
def _spawn_server(binary: str, popen: Callable[..., Any]) -> bool:
    try:
        with open(_log_file_path(), "ab") as log_handle:
            popen(cmd, **_detached_popen_kwargs(log_handle))   # Popen dropped immediately
        return True
```

**Mechanism.**
1. The Popen object is never stored, so the server can never be stopped by the app: there is no stop/disable code path in the entire repo (grep for terminate/kill shows none for tabby). Disabling autocomplete in Settings leaves an external model server consuming potentially GBs of RAM indefinitely.
2. Dropping Popen without wait()/poll() triggers ResourceWarning ("subprocess is still running") under -W error or pytest filters; on POSIX the detached child is reparented to init (start_new_session=True), so no zombie accumulates - the cost is purely lifecycle control, not reaping.
3. Duplicate-spawn protection exists and works (health_probe short-circuit at 198, port_occupied guard at 204), but it is time-of-check/time-of-use: two rapid Set Up calls can both pass port_occupied before either bind lands, yielding two tabby processes where one loses the port race but keeps burning memory.
4. storage/tabby-server.log is opened in append mode each spawn (line 173) with no rotation - unbounded disk growth over weeks of restarts.

**Growth rate.** One orphaned model-server process per OS reboot cycle at worst; log grows with every launch/model download retry.

**Blast radius.** Host RAM/disk outside the API process; confusing UX (server still serving after feature disabled).

**Fix.** Persist PID (file under storage/) at spawn; add a stop path invoked when autocomplete is disabled (terminate then kill on timeout, psutil or os.kill on POSIX / taskkill on Windows via stored pid); rotate/truncate the log when size exceeds a few MB before spawn.

---

### B-04 - MEDIUM - Stale AsyncClient replaced without closing the old one

**File:** apps/api/app/core/http_client.py:77-95.

```python
def get_async_http_client() -> httpx.AsyncClient:
    global _async_client, _async_client_loop_id
    loop_id = _current_loop_id()
    existing = _async_client
    if (existing is not None and not existing.is_closed and ...same loop...):
        return existing
    fresh = httpx.AsyncClient(...)      # replaces stale client...
    _async_client = fresh
    _async_client_loop_id = loop_id     # ...but existing is never aclose()d
    return fresh
```

**Mechanism.** The stale-loop detection is thoughtful (it exists for test suites and multi-loop embeds), but when a replacement occurs the previous AsyncClient is simply overwritten. Its keepalive connections (up to max_connections=100 sockets per instance) linger until GC runs httpx's finalizer; on a dead loop aclose cannot run properly anyway, but on live-loop swaps (e.g., tests creating loops per test function) each swap can strand up to ~100 sockets briefly. In single-event-loop production this path should never fire after lifespan init, which contains the damage.

**Blast radius.** Test-suite socket warnings/flakiness; negligible in prod. The symmetric close_http_client (lifespan shutdown) is correctly implemented.

**Fix.** Best-effort cleanup on swap: schedule existing.aclose() on its own loop if still runnable, else mark and let GC proceed with a debug log. Also consider asserting single-loop usage in production startup.

---

### B-05 - MEDIUM - SSE generators hold the request DB session for the whole LLM stream duration

**Files:** apps/api/app/api/v1/endpoints/chat.py:70-114 (project_chat_stream), services/rag_service.py:587+ (stream_chat_response), api/v1/endpoints/ai_writing.py:60-83 (stream_autocomplete).

```python
def project_chat_stream(..., db: Session = Depends(get_db)):
    ...
    def event_stream():
        for frame in rag_service.stream_chat_response(db=db, ...):   # db captured
            yield f"data: {json.dumps(frame)}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

**Mechanism.** The injected session stays checked out until FastAPI tears down dependencies after the response finishes. During streaming the generator spends most of its time inside llm_service.stream_generator HTTP reads (Ollama/cloud, LLM_TIMEOUT_SECONDS=20 read timeouts, slow local models can exceed that repeatedly). hybrid_search needs db only in the first instants; the remaining seconds-to-minutes pin is pure hold time.

- Concurrency math: N parallel SSE answers pin N pool slots; combined with B-01 sockets this accelerates exhaustion (a busy workspace: 10 collaborators + 5 streams = full 15-slot pool).
- Disconnect behavior is CORRECT: Starlette closes the sync generator on client disconnect, GeneratorExit propagates into llm_service generators whose `with client.stream(...)` blocks release promptly (llm_service.py:389-394, 452, 505 all context-managed), and dependency teardown closes db. So this is prolonged-hold, not a permanent leak - hence MEDIUM not HIGH.
- ai_writing_service.stream_autocomplete (lines 161-182) wisely offloads blocking work via anyio.to_thread.run_sync and yields two frames; same db-hold consideration applies but the window is shorter.

**Blast radius.** Pool pressure spikes correlated with AI usage; contributes to B-01 exhaustion scenarios.

**Fix.** Copy needed data out of db first: perform hybrid_search inside the endpoint body (before returning StreamingResponse) using a short-lived session, pass plain passages into the generator, and let the generator be db-free. Alternatively open SessionLocal() inside the generator and close in finally.

---

### B-06 - LOW - Orphaned upload files when post-write PDF validation rejects

**File:** apps/api/app/api/v1/endpoints/papers.py:101-137.

```python
    async def _stream_to_disk() -> None:
        try:
            with open(file_path, "wb") as out:
                ...
        except Exception:
            try: os.remove(file_path)        # cleans partial writes - good
            except OSError: ...

    await _stream_to_disk()

    try:
        PDFValidator.validate_pdf_file(file_path, max_mb=...)
    except PDFExtractionError as pe:
        raise HTTPException(...)             # file_path left on disk
```

**Mechanism.** Partial-write failures delete the temp file, but a file that streams successfully and THEN fails header/structure validation is never removed; likewise an extraction-total-failure still stores the record (intentional, keeps the file). Repeated rejected uploads accumulate up to MAX_UPLOAD_SIZE_MB (50 MB default) each in storage/uploads/{project_id}/.

**Growth rate.** Bounded per attempt by 50 MB; proportional to invalid-upload frequency (attacker- or user-driven).

**Fix.** Wrap the validation + extraction block so any pre-record failure path os.remove(file_path); or add a periodic sweeper for files with no Paper row.

---

### B-07 - LOW - Dead WebSocket entries retained while broadcast swallows send errors

**File:** apps/api/app/api/v1/endpoints/collaboration.py:141-154 (broadcast), 110-114 (_relay_loop).

```python
for conn in list(self.active_connections[document_id]):
    if conn["ws"] != exclude_ws:
        try:
            await conn["ws"].send_json(message)
        except Exception:
            pass                              # dead socket stays registered
```

**Mechanism.** A half-closed socket whose receive loop has not yet observed disconnect keeps receiving broadcast attempts; every send fails silently and the entry remains until the receive loop exits and disconnect() filters it out. With the relay loop the same swallow exists (line 113). Window is short in practice because receive raises promptly after TCP death, but on half-open connections (network drop without FIN/RST) entries can linger for TCP keepalive timescales, broadcasting into the void and pinning user_info dicts.

**Fix.** On send failure inside broadcast/relay, call self.disconnect(conn["ws"], document_id) opportunistically.

Related lifecycle note (INFO): collab_manager._relay_task is created lazily and only reset to None inside its own exception handler (line 118); it is never cancelled during app shutdown (main.py lifespan closes HTTP clients but not the redis pubsub task), so shutdown logs may show task destruction warnings. Cosmetic.

---

### B-08 - INFO - Module-level caches: bounded-in-practice

- plugin_runtime.py:24 _RESOLUTION_CACHE: Dict[str, Any] grows per distinct accepted entrypoint spec; keys are admin-curated PluginConfig.entrypoints values validated against allowlisted module prefixes, so growth equals number of plugins x hooks - bounded by configuration, cleared via clear_resolution_cache(). No subprocess spawning exists in the plugin runtime at all (in-process import only), so no process-handle leak surface here.
- provider_cache_service.py:32-35 bounded LRU (2000 entries, TTL 24h) with Redis mirror - explicitly designed against unbounded growth.
- llm_service availability probes cache negative results for 30s (llm_service.py:32) preventing probe storms.
- zotero_service pagination hard-capped at ZOTERO_MAX_ITEMS=500 (zotero_service.py:161-203).
- literature_search_service / identifier_resolver / graph_service consistently use get_async_http_client(); zotero uses the shared sync client - zero per-call client construction found anywhere (verified across services).

---

## Long-Running Stability Assessment

**After ~1 hour**
- A single team document with >15 concurrent collaborators exhausts the DB pool (B-01): first symptom is unrelated endpoints timing out with QueuePool checkout errors; collaboration itself keeps working (it holds its slots), making diagnosis non-obvious.
- Heavy ghost-text usage burns autocomplete quota; races (F-04) occasionally show stale suggestions.

**After several hours**
- Chat-heavy sessions show tab heap creep from unbounded transcripts and any abandoned streams (F-01/F-03); streaming jank increases as patchMessage maps over ever-longer arrays per token.
- Parallel SSE chat answers plus sockets keep pool utilization pinned near capacity (B-05); intermittent 30s hangs appear under bursty AI load.

**After days**
- Public-facing auth endpoints under XFF-spoofing load grow resident memory linearly (B-02): hundreds of MB to GBs until OOM-kill or restart; limiter effectiveness degrades simultaneously.
- storage/tabby-server.log grows without rotation; disabled-autocomplete Tabby processes linger consuming model RAM across API restarts (B-03).
- storage/uploads accumulates orphaned rejected uploads (B-06) and otherwise grows as designed since paper deletion does remove PDFs (papers.py:331-339).
- Frontend long-lived tabs: localStorage quota pressure from full-corpus serialization (F-08) can silently break autosave persistence once ~5MB is exceeded.

**Restart resilience:** all backend leaks are process-memory or external-process/disk; none corrupt persisted state. Frontend leaks reset with tab reload.

---

## Positive Observations

1. **Shared httpx clients done right** (core/http_client.py): pooled singleton AsyncClient + sync Client with limits, stale-loop detection, lifespan init/close; every service (llm, grobid/pdf, crossref/arxiv/pubmed/openalex, graphs, zotero) reuses them - no per-call construction anywhere.
2. **LLM streaming is context-managed**: every `with client.stream(...)` (llm_service.py:389, 452, 505) guarantees socket release even on GeneratorExit from client disconnects; SSE finalization therefore works.
3. **_persist_doc_edit pattern** (collaboration.py:40-61): short-lived session per write via threadpool - exactly what the WS endpoint dependency should imitate.
4. **Provider cache is deliberately bounded** (provider_cache_service.py:25 "bounded LRU ... to eliminate memory leaks") with TTL + eviction + optional Redis.
5. **Frontend listener hygiene is strong where it matters**: WorkspaceLayout resize/keydown (52-53, 81-82), GlobalSearchModal keydown (107-108), AcademicEditor Ctrl+S keydown AND ghost-text timer cleanup AND autosave clearInterval AND pending-save flush-on-unmount (468-476, 104-125) - the skill's checklist items are largely satisfied.
6. **AiResearchChat mode-toast timer** is the reference cleanup implementation (timer ref + clear on effect teardown and before re-set).
7. **Upload pipeline** streams to disk in bounded chunks with declared-length precheck, magic-byte header check mid-stream, and partial-file cleanup (papers.py:88-130).
8. **Paper deletion removes the PDF from disk** (papers.py:331-339); Zotero pagination capped; WS auth uses first-message token within 10s timeout instead of URL tokens; WS frame size cap + per-window rate limit with clean close codes (collaboration.py:34-37, 266-279).
9. **DocumentContext refreshDocuments staleness guard** (loadRequestRef) prevents out-of-order project loads - a pattern worth spreading to other mount-fetch effects.

---

## Prioritized Recommendations

1. **[CRITICAL] Unpin DB session from the collaboration WebSocket** (collaboration.py:230): scope SessionLocal around authentication only; return plain user_info. Add explicit pool_size/max_overflow to Settings for operational headroom. Effort: S. Removes the top availability risk.
2. **[HIGH] Make frontend streams cancellable**: thread AbortController through AiResearchChat -> sendStream -> streamRequest with reader.cancel() finally; add Stop-generating control (F-01/F-02). Effort: M. Also add timeouts to request().
3. **[HIGH] Bound the rate-limiter state**: periodic stale-key sweep or LRU cap; stop trusting raw XFF unless behind trusted proxy (B-02). Effort: S.
4. **[MEDIUM] De-pin DB from SSE generators** (B-05): fetch passages before returning StreamingResponse or open/close a session inside the generator's finally. Effort: S-M.
5. **[MEDIUM] Give Tabby a lifecycle**: persist PID, implement stop-on-disable, guard duplicate spawns atomically, rotate log (B-03). Effort: M.
6. **[MEDIUM] Cancel/supersede ghost-text requests** with requestId + AbortController (F-04); fixes both quota burn and stale suggestions. Effort: S.
7. **[MEDIUM] useMemo every provider value; split high-frequency state (stats/saveStatus) into a narrow context** (F-05). Effort: M. Big editor-latency win.
8. **[LOW] Cap chat transcript memory** (windowing/virtualization) (F-03); centralize toast timers in one hook (F-06); replace innerHTML badge construction with DOM APIs and escape external strings (F-07); debounce/per-doc localStorage writes (F-08).
9. **[LOW] Delete rejected uploads post-validation failure** (B-06); evict dead WS entries on broadcast failure (B-07); close swapped stale AsyncClients best-effort (B-04); cancel relay task in lifespan shutdown.
10. **Adopt regression guards**: extend the frontend test suite with a leak check analogous to ensureNoDisposablesAreLeakedInTestSuite (assert no listeners/timers after unmount of AiResearchChat/AcademicEditor), and a backend test that opens N>pool_size WebSocket collaborations while hammering an HTTP endpoint and asserts no checkout timeouts.

---

*End of report - audit performed read-only; no source files were modified.*

