# OpenResearch — Master Audit Report
## 23-Skill Orchestrated Audit | 2026-08-26

**Orchestrator:** ox-alpha (opencode)
**Method:** 23 specialized subagents, each loading one installed skill (`~\.agents\skills`), performing independent read-only audits. No source files were modified by any auditor.
**Individual reports:** `audit-reports\01…23-*.md` (this folder) — full detail, exact `file:line` evidence, snippets, and fixes in each.
**Bonus artifact:** `PORTABILITY_AUDIT_2026-08-26.md` (cross-device/reproducibility companion produced during the run).

---

## 1. Executive Verdict

| Dimension | Verdict |
|---|---|
| Networked / multi-user deployment | **NO-GO** — authentication is effectively decorative (Report 15, 17) |
| Strictly-local single-user use | **CONDITIONAL** — but currently broken by install-blocking bugs (Reports 08, 14, 17) |
| Code quality & hygiene | **GOOD core discipline, heavy sediment** — lint/type gates pass only because they're lenient (01, 03, 09) |
| Test suite | **Strong hermetic suite, RED gate** — coverage gate fails every CI run; key flows untested or tautological (02, 21) |
| Frontend | **Functional but fragile** — zero runtime validation, XSS sink, a11y claims contradicted by code (12, 22, 23) |
| Supply chain | **CLEAN** — npm 0 vulns; pip issues confined to tooling; licenses unproblematic (19) |
| Version control | **ZERO COMMITS** — the entire codebase is unversioned; CI has literally never run (13) |

**Aggregate:** 23 audits surfaced roughly **30 CRITICAL-severity conditions**, **~70 HIGH**, **~180 MEDIUM**, plus LOW/INFO noise. Full counts per report in §4.

---

## 2. Index of Reports

| # | Skill | Report | Focus |
|---|---|---|---|
| 01 | python-code-style | `01-python-code-style.md` | PEP 8, naming, formatting, docstrings |
| 02 | python-testing-patterns | `02-python-testing-patterns.md` | pytest suite quality & smells |
| 03 | python-type-safety | `03-python-type-safety.md` | typing coverage, mypy strictness |
| 04 | python-error-handling | `04-python-error-handling.md` | exceptions, validation, resilience |
| 05 | python-best-practices | `05-python-best-practices.md` | idioms, packaging, config, perf |
| 06 | fastapi | `06-fastapi.md` | framework correctness, async, DI |
| 07 | rest-api-design | `07-rest-api-design.md` | endpoint design, status codes, consistency |
| 08 | postgresql-code-review | `08-postgresql-code-review.md` | data layer, migrations, queries |
| 09 | ruff-recursive-fix | `09-ruff-recursive-fix.md` | lint reality vs config |
| 10 | ty | `10-ty.md` | type-soundness + checker adoption |
| 11 | code-review | `11-code-review.md` | standards + spec conformance |
| 12 | typescript-best-practices | `12-typescript-best-practices.md` | TS quality, React patterns |
| 13 | git-commit | `13-git-commit.md` | VCS hygiene, tracked-file risks |
| 14 | multi-stage-dockerfile | `14-multi-stage-dockerfile.md` | containerization, compose, self-hosting |
| 15 | security-audit | `15-security-audit.md` | OWASP, attack chains, secrets |
| 16 | memory-leak-audit | `16-memory-leak-audit.md` | resource leaks FE+BE |
| 17 | production-code-audit | `17-production-code-audit.md` | production readiness deep scan |
| 18 | de-sloppify | `18-de-sloppify.md` | dead code, TODOs, format drift |
| 19 | codebase-cleanup-deps-audit | `19-codebase-cleanup-deps-audit.md` | vulnerabilities, drift, licenses |
| 20 | refactor-clean | `20-refactor-clean.md` | duplication atlas, god modules |
| 21 | test-coverage | `21-test-coverage.md` | coverage reality, gap register |
| 22 | ui-ux-pro-max | `22-ui-ux-pro-max.md` | design system, WCAG, AI-UX |
| 23 | radix-ui-design-system | `23-radix-ui-design-system.md` | primitive patterns, component arch |

---

## 3. Cross-Cutting Critical Findings (deduplicated across audits)

These appeared independently in multiple reports — highest confidence, highest priority.

### CC-1 · Authentication bypass → auto-provisioned ADMIN  ⚠️ WORST FINDING
- **Where:** `apps/api/app/services/auth.py:108-129` (plus WebSocket empty-token twin)
- **What:** Any missing/expired/invalid JWT silently falls through to an auto-created **admin** local user. The frontend sends no Authorization header, so **every network-reachable caller is admin**. All ~60 RBAC checks are dead code. Admin gate protects plugin registration (`importlib` code execution!) and LLM key management.
- **Compounding:** local admin password hash equals the email constant (`local@openresearch.dev`) — a valid login surviving naive fixes (15, 17); default HS256 signing secret committed in `config.py:7`, `.env.example`, and on-disk `apps/api/.env` → offline token forgery (15).
- **Found by:** 06, 07, 11, 15, 17
- **Fix direction:** hard-fail 401 outside explicit dev mode; environment-gate the fallback; kill the constant password; require generated secret.

### CC-2 · Fresh installs crash — Alembic chain creates nothing
- **Where:** `apps/api/alembic/versions/**` ("initial_schema" revision only ALTERs tables that don't exist; legacy DBs blindly `stamp(head)`ed)
- **Impact:** first boot on any machine (dev SQLite or prod Postgres) crashes; quickstart also requires `REDIS_PASSWORD` that no template sets (compose DOA).
- **Found by:** 08, 14, 17

### CC-3 · Fake/deceptive AI features (spec divergence)
- Outline Generator never calls an LLM — static template (`ai_writing_service.py:353`)
- Gap Assistant fabricates canned gaps + padded evidence counts (`intelligence_service.py:270-331`)
- "Semantic" search = 128-dim hash vectors, not embeddings; pgvector declared but unused; cosine similarity runs in Python over every chunk row per query (O(N))
- Paper-status pipeline fakes "ready"; PDF processing synchronous
- **Found by:** 11 (spec axis), 08, 17

### CC-4 · Data-integrity & concurrency defects
- Non-atomic multi-commit writes (team creation, version restore skips version bump → **optimistic-lock bypass ×3**) (08, 17)
- WebSocket pins pooled DB session for socket lifetime → ~15 collaborators exhaust pool (5+10 default) (06, 08, 16)
- Corrupt `provider_keys.json` silently reset → permanent API-key loss, non-atomic saves (04, 10)
- Invalid JWT silently downgraded to local admin (duplicate of CC-1 mechanism inside auth flow) (04)

### CC-5 · Frontend trust boundaries absent
- `request<T>` returns raw `response.json()` unchecked — **zero schema validation repo-wide** (no zod); `{} as T` for 204 (12)
- XSS sink: `ghostText.ts:57` interpolates API-sourced `authors` into `innerHTML` (12)
- `NEXT_PUBLIC_API_URL` inlined at build but supplied at runtime → web↔API wiring broken off-localhost (12, 14, 17)

### CC-6 · Process failure: repo has zero commits
- Empty object DB, no tags, no remotes → CI/pre-commit have never executed; 344-file mega-commit risk looming; junk files (`Starting`, logs, db-wal/-shm) would leak into initial commit. `.gitignore` itself is verified correct (no secrets tracked). (11, 13)

### CC-7 · Quality gates are red or illusory
- Coverage gate: `--cov-fail-under=94` vs actual **91.47%** → backend CI fails every push; closing needs just 171 statements concentrated in 10 modules (02, 21)
- Tautological tests: JWT refresh-rotation asserts `or True` (`test_security_hardening.py:69`, also :171-173); self-verifying accessibility tests (02, 21)
- mypy passes only via leniency: `--strict` exposes **174 errors**; all 90 route handlers lack return annotations (03)
- ruff: configured scope nearly clean, but `--select ALL` reveals **8,567** violations; risky ignores (E501/E741 global); dead `B008` ignore; blind autofix would break `alembic/env.py` (09)

### CC-8 · Resource leaks under sustained load
- Rate limiter stores a deque per unique client key **forever**, keyed by spoofable `X-Forwarded-For` → linear-memory DoS (04, 15, 16)
- Chat SSE streaming never aborted client-side (zero AbortControllers); server-side sync SSE never cancels upstream LLM stream on disconnect; shutdown leaks collab Redis relay task (16, 18)
- Tabby server spawned detached with no kill path + unbounded log (16)

### CC-9 · Accessibility claims contradict code
- Dark theme primary actions: white-on-accent **2.79:1** (WCAG AA needs 4.5:1) across 51 sites; input borders 1.29:1
- False VPAT claims: no skip link exists; keyboard operability broken on document rows/chat cards/checklists; exactly 1 `htmlFor` in app vs "explicit labels" claim
- `tailwindcss-animate` missing → every Radix animation class in 6 shipped components is a silent no-op (22, 23)

---

## 4. Severity Aggregate by Report

Counts as self-reported by each auditor (some auditors count differently — see individual reports for methodology).

| # | Report | C | H | M | L | I | Notable headline |
|---|---|---|---|---|---|---|---|
| 01 | code-style | 0 | 6 | 23 | 27 | 5 | E501 ignored while 74 lines >120ch; divergent BibTeX serializers |
| 02 | testing-patterns | 1 | 5 | 10 | — | — | Coverage gate broken; live-network unit test; mega-tests |
| 03 | type-safety | 0 | 3 | 7 | 12 | — | mypy --strict hides 174 errors; Dict[str,Any] author crash |
| 04 | error-handling | 0 | 3 | 13 | — | — | Zotero import 500; silent key loss; swallowed WS relay errors |
| 05 | best-practices | 0 | 3 | 9 | 12 | 4 | .env silently ignored; sync-in-async; dep drift |
| 06 | fastapi | 2 | 5 | 13 | 17 | 10 | Auth fallback admin; .env never loaded; WS session pinning |
| 07 | rest-api-design | 1 | 5 | 10 | 10 | 9 | No 401 path exists; 3 conflicting error envelopes |
| 08 | postgresql | 2 | 6 | ~8 | ~6 | — | Migrations create nothing; pgvector unused; FK/index gaps |
| 09 | ruff | 2* | ~4 | many | many | — | 8,567 extended-scope violations; XXE risk flagged by S-rules |
| 10 | ty | 0 | 2 | 8 | 9 | 5 | ty ran clean (7 FPs); confirms untrusted-shape crashes |
| 11 | code-review | 1 | 5+ | 6+ | — | — | Spec §34 void; documented CI gate doesn't exist; AI fakery |
| 12 | typescript | 2 | 9 | 14 | — | — | Unchecked response.json(); innerHTML sink; god-context |
| 13 | git-commit | 2 | 1 | 2+ | — | — | Zero commits; pre-commit hooks not installed; ruff pin stale |
| 14 | dockerfile | 0 | 7 | 15 | 12 | 7 | Single-stage image; public/ never copied; wrong compose in launcher |
| 15 | security | 4 | 4+ | — | — | — | Auth bypass; known creds; committed secret; SSRF key exfil |
| 16 | memory-leak | 1 | 2 | 7 | 5 | 5 | Pool exhaustion @15 sockets; unbounded limiter deques |
| 17 | production | 6† | 11 | — | — | — | **Verdict NO-GO**; 6 deployment blockers verified |
| 18 | de-sloppify | 0 | 2 | 3+ | many | — | 98/120 files format drift; 3 dead schemas; 0 TODOs confirmed |
| 19 | deps-audit | 0‡ | 1‡ | 4‡ | 2‡ | — | Dual React runtimes; dev tools shipped to prod image; licenses OK |
| 20 | refactor-clean | 0 | 2 | 8+ | — | — | Author parsing ×7; BibTeX ×3 w/ live drift; 1027-line schema monolith |
| 21 | test-coverage | 1§ | 3 | 6 | — | — | Gate RED (91.47 vs 94); 171 statements to green; 10 quality defects |
| 22 | ui-ux | 4 | 12 | 14 | 8 | — | WCAG AA failures; VPAT contradictions; broken mechanics |
| 23 | radix | 1¶ | 4 | 5+ | — | — | Missing animate plugin kills animations; mouse-only combobox |

\* within extended scope · † deployment blockers counted separately from HIGHs · ‡ pip-audit tooling-only findings · § gate-red counted as critical · ¶ silent-animation breakage rated critical for polish

---

## 5. Consolidated Remediation Roadmap

### P0 — Before ANY deployment (days)
1. **Kill the auth fallback**: return 401 on invalid/absent tokens unless an explicit `OPENRESEARCH_DEV_INSECURE_AUTH=1` flag is set; delete the constant admin password; force generated JWT secret (→ 15, 17)
2. **Fix migrations**: write a real baseline migration creating all tables; add a fresh-install smoke test; set `REDIS_PASSWORD` plumbing in compose (→ 08, 14, 17)
3. **Make CI honest**: fix coverage gate (close 171-statement gap or recalibrate threshold), replace `or True` tautologies, remove live-network test (already mocked — verify), wire `test:coverage` into CI as docs claim (→ 02, 11, 21)
4. **Frontend validation layer**: introduce zod schemas mirroring backend responses; fix the `innerHTML` sink in `ghostText.ts:57`; decide build-time vs runtime API URL strategy (→ 12, 14)
5. **Secrets at rest**: encrypt or OS-keychain `provider_keys.json`; atomic writes everywhere (temp+rename) (→ 04, 15)

### P1 — Before multi-user use (1–2 weeks)
6. Session-per-message for WebSockets; raise/pin pool sizing deliberately (→ 06, 08, 16)
7. Bounded + non-spoofable rate limiting (client cert/IP from socket, TTL map) (→ 04, 15, 16)
8. Atomic transactions for team-create/version-restore; restore version-bump semantics (→ 08, 17)
9. Harden error handling: guard CSL `[0][0]` chains, log WS relay failures, stop DEBUG-only Redis logging (→ 04, 10)
10. Async correctness sweep: move sync Redis/DB/file I/O out of `async def` paths (→ 05, 06, 09)
11. SSE lifecycle: AbortController client-side, cancel upstream LLM streams server-side, close pinned sessions in generators (→ 16, 18)

### P2 — Quality debt (2–6 weeks)
12. Tighten mypy toward `--strict` incrementally (174-error baseline published in Report 03); annotate all route handlers
13. Ruff: enable UP/B/FAST/COM rule families, per-file-ignores instead of global disables, add formatter to CI (→ 09)
14. Decompose god modules: `schemas/models.py` (1,027), `rag_service.py` (900), `PdfReader.tsx` (844), `WorkspaceContext.tsx` (709), `intelligence_service.py` (681) — seam maps provided (→ 20)
15. De-duplicate: canonical author parser, single BibTeX serializer (fix escaping drift FIRST — corrupts user data), hoist access-check helpers, collapse modal state into reducer (→ 20, 12)
16. Real embeddings behind pgvector OR drop the pretense; make AI features call actual LLMs or label them honestly (→ 08, 11)
17. UI/a11y remediation: contrast fixes on dark theme, keyboard contracts for hand-rolled tabs/combobox/modal, skip link, labels — then re-issue an honest VPAT (→ 22, 23); add `tailwindcss-animate`
18. Docker: adopt reference multi-stage Dockerfiles (included in Report 14), copy `public/`, fix launcher/compose mismatch, backup the named volume not a host dir

### P3 — Operational maturity
19. Structured logging, metrics, tracing, real readiness probes (→ 17)
20. First commit strategy: 14-step conventional-commit plan ready in Report 13; install pre-commit hooks; dedupe React runtime (root 18.3.1 vs web 19.2.8) (→ 13, 19)
21. Test strategy execution: contract tests from OpenAPI, WS protocol tests, migration tests, minimal Playwright E2E set (→ 21)

---

## 6. What's Genuinely Good (auditor consensus)

- **Zero bare excepts; consistent 500 envelope with request-ID correlation** (04)
- **Hermetic deterministic test suite**: 442/442 pass in ~105s, real in-memory SQLite, autouse isolation fixtures, zero sleeps (02)
- **Uniform SQLAlchemy 2.0 models; configured-scope ruff+mypy clean; zero TODOs/prints/@ts-ignore/non-null assertions** (01, 03, 12, 18)
- **`.gitignore` verified bulletproof** — no secrets/db/logs/uploads tracked despite being on disk (13)
- **Clean supply chain**: npm 0 vulnerabilities; license tree permissive-compatible (19)
- **Correct shadcn-style two-layer Radix architecture** at 18 call sites; proper package DAG (12, 23)
- **Honest-AI refusal schemas, `/api/v1` versioning, uniform 404→403 ordering** (07)
- **Exemplary UX touches**: token pipeline, stepped PDF progress, ghost-text grounding preview, trust legend (22)
- **Shared httpx clients, context-managed LLM streams, bounded provider LRU** (16)
- **Strong spec conformance for MVP scope**: citations, export, Zotero, teams, graphs, plugins all real implementations (11)

---

## 7. Methodology Notes & Caveats

- All 23 subagents operated **read-only**; fix-oriented skills (ruff-recursive-fix, de-sloppify) ran checks/dry-runs only.
- Static analysis was performed on-source; runtime verification limited to read-only commands (pytest collect, coverage report, ruff check, mypy, ty via uvx, npm audit, pip list/audit).
- Docker findings are static-only (Docker not installed on audit machine) — see PORTABILITY_AUDIT companion.
- Secret values were intentionally never printed; only key names/paths referenced.
- Counts marked "~" were summarized rather than exhaustively tabulated by the reporting agent; consult the individual report for precise enumeration.
- Known overlapping findings (CC-1..CC-9) are deduplicated here; each individual report still contains its own instance-level detail.
