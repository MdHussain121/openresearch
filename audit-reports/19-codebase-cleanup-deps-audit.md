# Dependency & Supply-Chain Audit — OpenResearch Monorepo

**Audit ID:** 19 · **Date:** 2026-08-26 · **Mode:** READ-ONLY (audit-only; nothing installed, upgraded, or modified)
**Auditor:** codebase-cleanup-deps-audit skill, AUDIT-ONLY MODE

---

## Scope & Methodology

### Files reviewed

| Area | Files |
|---|---|
| JS manifests | `package.json` (root, npm workspaces `apps/*`, `packages/*`), `package-lock.json` (676 packages), `apps/web/package.json`, 8 × `packages/*/package.json` (ui, ai, editor, plugins, browser-extension, tokens, research, citations) |
| Python manifests | `apps/api/pyproject.toml`, `apps/api/requirements.txt`, `apps/api/requirements.lock` (pip-compile output, 172 lines) |
| Environment | `apps/api/.venv` (queried via metadata only; contents NOT audited internally), `.nvmrc` (=20), `.python-version` (=3.11) |
| Automation | `.github/dependabot.yml`, `.pre-commit-config.yaml`, `.github/workflows/ci.yml` |
| Containers | `infrastructure/Dockerfile.api`, `infrastructure/Dockerfile.web`, `infrastructure/docker-compose.yml`, `infrastructure/docker-compose.selfhost.yml` |
| Legal | `LICENSE`, `docs/COPYRIGHT_AND_LEGAL_POSTURE.md`, `docs/LEGAL_REVIEW_CHECKLIST.md` |

### Commands executed (all read-only)

1. `npm audit --json` (repo root)
   → **0 vulnerabilities** across 699 dependencies (166 prod / 494 dev / 91 optional / 3 peer).
2. `npm outdated` (repo root)
   → 37 outdated package/consumer rows; multiple stale majors (see Drift Matrix).
3. `npm ls --depth=0` (repo root)
   → Full workspace tree; revealed **duplicate React installs (18.3.1 + 19.2.8)** and **2 extraneous packages** (`@emnapi/runtime@1.11.3`, `@img/sharp-wasm32@0.35.3`).
4. `.venv\Scripts\python.exe -m pip list --outdated --format=json`
   → 4 outdated: `cryptography 50.0.0→50.0.1`, `pip 24.0→26.2.1`, `pydantic_core 2.46.4→2.48.0`, `setuptools 79.0.1→84.0.0`.
5. `.venv\Scripts\python.exe -m pip audit -f json` (pip-audit 2.10.1 installed)
   → **"Found 9 known vulnerabilities in 2 packages"** (7 unique after alias de-duplication; all in pip/setuptools).
6. Cross-checks:
   - `rg "^(from|import)" apps/api/app` → unique top-level import inventory vs declared deps.
   - `rg "pdfplumber|pypdf|redis|email_validator|multipart|pgvector|psycopg2"` over `apps/api` (excl. `.venv`) → confirmed usage sites.
   - `rg 'from "…"'` over all workspace TS sources → import inventory vs `package.json` declarations.
   - Physical React copy verification: root `node_modules/react` = 18.3.1; `apps/web/node_modules/react` = 19.2.8; lockfile keys confirm both.
   - License extraction from `package-lock.json` (676 pkgs) and from installed venv metadata via `importlib.metadata`.

### Explicitly ignored
`node_modules` internals, `.venv` internals, `.next`, caches (`__pycache__`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `coverage/`).

---

## Executive Summary

The dependency posture is **mixed: strong vulnerability hygiene on the npm side, meaningful supply-chain discipline gaps on the Python/container side.**

- **npm: zero known vulnerabilities** (audit clean). But the tree carries a **HIGH-severity structural defect: two copies of React (18.3.1 hoisted for `packages/ui`+`packages/editor` peers, 19.2.8 nested for `apps/web`)** — a classic dual-React hazard (invalid-hook/context breakage, double bundle). Plus heavy major-version debt (Tiptap 2→3, Tailwind 3→4, lucide-react 0.x→1.x, TypeScript 5→7) and lockfile drift behind semver ranges (next 16.3.2 vs 16.3.3).
- **Python runtime deps: clean** (no CVEs against any locked runtime package). All **7 unique vulnerabilities live in environment tooling**: `pip 24.0` (6 advisories) and `setuptools 79.0.1` (1 advisory). These are not pinned by `requirements.lock`, so they silently enter every build — including the production Docker image via `python:3.11-slim`'s bundled toolchain.
- **Confirmed: production image ships dev tooling.** `requirements.lock` was compiled from `requirements.txt`, which mixes prod + dev (pytest, mypy, ruff, coverage…) + Postgres extras. `Dockerfile.api` installs that lock wholesale → pytest/mypy/ruff/coverage in the runtime container.
- **Version drift between `pyproject.toml` and `requirements.txt` confirmed** for exactly 3 floors (python-docx, reportlab, pypdf) plus 2 structural mismatches (psycopg2-binary/pgvector placement; dev tools in reqs).
- **Dependabot has no Docker ecosystem entry** and its pip entry watches only requirements files — `pyproject.toml` floors are never updated automatically, guaranteeing drift widens.
- **Pre-commit pins are stale:** ruff hook at v0.4.4 vs ruff 0.16.4 actually used (12 minor versions apart); pre-commit-hooks v4.6.0 vs v5.x current.
- **Base images float or EOL:** `node:20-alpine` (Node 20 EOL April 2026 — the *production runner* runs an EOL runtime), `ollama/ollama:latest` (unreproducible).
- **License posture: healthy.** AGPL-3.0 project with permissive dependency trees; no GPL/AGPL contamination. Only copyleft touchpoints are sharp's LGPL-3.0 libvips binaries and psycopg2's "LGPL with exceptions" — both AGPL-compatible.

**Totals: 7 unique known vulnerabilities (npm: 0; Python env tooling: 7). Severity mix (advisory-inferred): ~1 High, ~3 Medium, ~3 Low.**

---

## Vulnerability Scan Results

### npm ecosystem (`npm audit --json`) — CLEAN

| Metric | Value |
|---|---|
| Critical | 0 |
| High | 0 |
| Moderate | 0 |
| Low | 0 |
| Info | 0 |
| Total dependencies scanned | 699 (prod 166, dev 494, optional 91, peer 3) |

### Python ecosystem (`pip-audit 2.10.1`, OSV/PyPI advisory DBs)

Tool reported **9 findings in 2 packages**; after de-duplicating repeated aliases there are **7 unique advisories**. None affect locked *runtime* libraries; all are in the packaging toolchain present in the dev venv and inherited at build time by containers.

| Advisory ID | Aliases | Package | Installed | Ecosystem | Severity (advisory-inferred) | Affected range | Fix version | Summary |
|---|---|---|---|---|---|---|---|---|
| PYSEC-2026-196 | CVE-2026-8643, GHSA-wf93-45jw-7689 | pip | 24.0 | Python | **HIGH** | < 26.1.2 | **26.1.2** | console/gui_scripts treated as paths without sanitizing resolved absolute path → entry points installed outside installation directory (entry-point injection). |
| PYSEC-2026-1795 | CVE-2025-8869, GHSA-4xh5-x5gv-qwph | pip | 24.0 | Python | MEDIUM | < 25.3 (fallback tar path; mitigated on Py ≥ 3.11.4 which implements PEP 706) | 25.3 | Tar extraction may not check symlinks point into extraction dir when tarfile lacks PEP 706 support. Partially mitigated here: image uses python:3.11-slim (≥3.11.4 patch level depends on base tag freshness). |
| PYSEC-2026-1796 | CVE-2026-1703, GHSA-6vgw-5pg2-w6jp | pip | 24.0 | Python | MEDIUM | < 26.0 | 26.0 | Malicious wheel can extract files outside install dir (path traversal limited to prefixes of the installation directory). |
| PYSEC-2026-2875 | CVE-2026-3219, GHSA-58qw-9mgm-455v | pip | 24.0 | Python | LOW | < 26.1 | 26.1 | Concatenated tar+ZIP handled as ZIP regardless of filename → confusing/wrong-file installs. |
| PYSEC-2026-2876 | CVE-2026-6357, GHSA-jp4c-xjxw-mgf9 | pip | 24.0 | Python | LOW | < 26.1 | 26.1 | Self-update check ran *after* wheel install, importing newly-installed modules (code-execution window post-install of untrusted wheel). |
| PYSEC-2026-3721 | CVE-2026-13346 | pip | 24.0 | Python | MEDIUM | < 26.2 | 26.2 | Doubly-encoded package URLs allow files installed to arbitrary disk locations; requires malicious index + `pip download --only-binary`. |
| PYSEC-2026-3447 | CVE-2026-59890, GHSA-h35f-9h28-mq5c, BIT-setuptools-2026-59890 | setuptools | 79.0.1 | Python | MEDIUM | < 83.0.0 | 83.0.0 | `MANIFEST.in` exclusion matching skips Unicode NFC/NFD normalization → NFD-named files can bypass exclusions and be packed into published sdists (irreversible disclosure risk for maintainers building on macOS APFS/HFS+). |

Notes:
- `pip list --outdated` corroborates both packages as stale (pip 24.0 → 26.2.1; setuptools 79.0.1 → 84.0.0).
- `cryptography 50.0.0` (via pdfminer-six) has **no open advisory** per pip-audit; one patch behind (50.0.1). Track, don't panic.
- The production API image does not install these tools from `requirements.lock` — it inherits whatever pip/setuptools ship inside the floating `python:3.11-slim` tag at build time. Same exposure class, unmanaged.

---

## Version Drift Matrix

### A. `pyproject.toml` vs `requirements.txt` vs `requirements.lock` vs installed venv

| Package | pyproject floor | requirements.txt floor | Match? | lock pin | venv installed | Latest (pip) | Verdict |
|---|---|---|---|---|---|---|---|
| fastapi | >=0.111.0 | >=0.111.0 | ✅ | 0.141.1 | 0.141.1 | — | OK |
| uvicorn[standard] | >=0.29.0 | >=0.29.0 | ✅ | 0.52.4 (+watchfiles/websockets/etc.) | 0.52.4 | — | OK (extras stripped in lock but transitive standard extras resolved) |
| pydantic | >=2.7.0 | >=2.7.0 | ✅ | 2.13.4 | 2.13.4 | — | OK |
| pydantic-settings | >=2.2.0 | >=2.2.0 | ✅ | 2.15.0 | 2.15.0 | — | OK |
| email-validator | >=2.1.1 | >=2.1.1 | ✅ | 2.3.0 | 2.3.0 | — | OK |
| sqlalchemy | >=2.0.30 | >=2.0.30 | ✅ | 2.0.52 | 2.0.52 | — | OK |
| alembic | >=1.13.1 | >=1.13.1 | ✅ | 1.19.1 | 1.19.1 | — | OK |
| python-multipart | >=0.0.18 | >=0.0.18 | ✅ | 0.0.32 | 0.0.32 | — | OK |
| bcrypt | >=4.1.2 | >=4.1.2 | ✅ | 5.0.0 | 5.0.0 | — | OK (major jump inside `>=` range — silent major upgrade risk) |
| pyjwt | >=2.8.0 | >=2.8.0 | ✅ | 2.13.0 | 2.13.0 | — | OK |
| redis | >=5.0.4 | >=5.0.4 | ✅ | 8.1.0 | 8.1.0 | — | OK (**major 5→8 inside `>=` range**) |
| httpx | >=0.27.0 (also in dev extra) | >=0.27.0 | ✅ | 0.28.1 | 0.28.1 | — | OK |
| pdfplumber | >=0.11.0 | >=0.11.0 | ✅ | 0.11.10 | 0.11.10 | — | OK |
| **python-docx** | **>=1.1.0** | **>=1.2.0** | ❌ **DRIFT** | 1.2.0 | 1.2.0 | — | pyproject floor one minor behind |
| **reportlab** | **>=4.2.0** | **>=4.5.0** | ❌ **DRIFT** | 5.0.1 | 5.0.1 | — | floors differ AND lock resolved across a major (4→5) |
| **pypdf** | **>=4.2.0** | **>=5.0.0** | ❌ **DRIFT** | 6.16.2 | 6.16.2 | — | floors differ AND lock two majors ahead of pyproject floor |
| psycopg2-binary | optional extra `postgres`/`all` only | **prod line 8** | ⚠️ structural | 2.9.12 | 2.9.12 | — | unconditional in reqs/lock/image; optional in pyproject |
| pgvector | optional extra `postgres`/`all` only | **prod line 9** | ⚠️ structural | 0.5.0 | 0.5.0 | — | same structural mismatch |
| pytest | dev extra >=8.2.0 | **prod line 19** | ⚠️ structural | 9.1.1 | 9.1.1 | — | **dev tool compiled into prod lock** |
| pytest-asyncio | dev extra >=0.23.6 | **prod line 20** | ⚠️ structural | 1.4.0 | 1.4.0 | — | same |
| pytest-cov | dev extra >=5.0.0 | **prod line 21** | ⚠️ structural | 7.1.0 | 7.1.0 | — | same |
| mypy | dev extra >=1.10.0 | **prod line 22** | ⚠️ structural | **2.3.1** | 2.3.1 | — | same + lock crossed a major (1→2) above floor |
| ruff | dev extra >=0.4.4 | **prod line 23** | ⚠️ structural | **0.16.4** | 0.16.4 | — | same; see pre-commit mismatch below |
| *(transitive)* cryptography | — | — | — | 50.0.0 | 50.0.0 | 50.0.1 | one patch behind latest; no advisory |
| *(transitive)* pydantic_core | — | — | — | 2.46.4 | 2.46.4 | 2.48.0 | bound by pydantic release train |

**Drift verdicts:** 3 hard floor mismatches (python-docx, reportlab, pypdf); 2 structural mismatches (Postgres extras unconditional; 5 dev tools shipped to prod); 2 silent-major-inside-`>=` cases visible in lock (bcrypt 4-floor→5.0.0, redis 5-floor→8.1.0; also mypy 1.10-floor→2.3.1, reportlab 4-floor→5.0.1, pypdf 4-floor→6.x).

**Lockfile provenance:** header confirms `pip-compile --output-file=requirements.lock --strip-extras requirements.txt` — i.e., the lock was built from **requirements.txt**, not from `pyproject.toml` `[project.dependencies]`. Since requirements.txt ≠ pyproject (table above), the lock bakes in the wrong source-of-truth. This confirms the suspected "lock built from wrong source incl. dev tools in prod image": `Dockerfile.api:13-14` runs `pip install -r requirements.lock`, so **pytest, pytest-asyncio, pytest-cov, mypy(+extensions/librt/pathspec/ast-serialize), ruff, coverage, pluggy, iniconfig, pygments, colorama ship in the production image** (~15–20 unnecessary packages, larger attack surface & image).

### B. npm version currency (`npm outdated`)

| Package (consumers) | Current | Wanted | Latest | Gap class |
|---|---|---|---|---|
| @tiptap/* (editor, 13 pkgs) | 2.27.2 | 2.27.2 | **3.30.3** | Major behind |
| react / react-dom (editor, ui peers) | **18.3.1** | 19.2.8 | 19.2.8 | **Major behind + duplicated (see Findings F-1)** |
| react / react-dom (web) | 19.2.8 | 19.2.8 | 19.2.8 | current (but second copy) |
| next (web) | 16.3.2 | **16.3.3** | 16.3.3 | Lockfile lag within range |
| eslint-config-next (web) | 16.3.2 | 16.3.3 | 16.3.3 | Lockfile lag |
| tailwindcss (web) | 3.4.19 | 3.4.19 | **4.3.3** | Major behind |
| tailwind-merge (ui) | 2.6.1 | 2.6.1 | **3.6.0** | Major behind |
| katex (editor) | 0.16.47 | 0.16.47 | **0.18.4** | Minor-line behind (pre-1.0 semantics) |
| lucide-react (ui, editor, web) | 0.378.0 | 0.378.0 | **1.34.0** | Major behind (0.x→1.x) |
| eslint (web) | 9.39.5 | 9.39.5 | **10.9.1** | Major behind |
| typescript (root + 8 workspaces) | 5.9.3 | 5.9.3 | **7.0.2** | Two majors behind |
| @types/node (root, web) | 20.19.43 | 20.19.43 | **26.3.0** | Major behind (matches Node 20 runtime choice) |

Lockfile-vs-manifest integrity: all installed versions satisfy declared ranges (no invalid-tree errors from `npm ls` beyond the extraneous entries noted below).

---

## Phantom & Undeclared Dependencies

### Python (`apps/api`)

**Declared-but-unused (phantom): NONE.** Every declared dep verified in use:

| Declared | Evidence |
|---|---|
| fastapi, pydantic, pydantic_settings, sqlalchemy, alembic, httpx, jwt (pyjwt), bcrypt, docx (python-docx), reportlab | direct imports in `app/**` |
| starlette, anyio | imported directly (see undeclared below) |
| uvicorn | server entrypoint (`CMD` in Dockerfile.api, `run.cmd`) — correct as non-imported runtime dep |
| redis, pdfplumber, pypdf, email_validator, multipart, pgvector, psycopg2 | referenced in `app/core/config.py`, `app/services/pdf_extractor.py`, `app/services/provider_cache_service.py`, `app/models/chunk.py`, endpoints (`papers.py`, `health.py`, `collaboration.py`), and tests |

**Imported-but-not-declared (undeclared):**

| Module imported directly | Actual provider | Declared? | Risk |
|---|---|---|---|
| `starlette` (direct imports in app code) | transitive via fastapi | ❌ not in pyproject/requirements | If FastAPI swaps/reshelves Starlette APIs, imports break with no manifest hint. Declare explicitly. |
| `anyio` (direct imports) | transitive via httpx/starlette/fastapi | ❌ | Same fragility pattern. |

Severity: LOW-MEDIUM (correctness robustness, not security), but this is exactly the pattern that produces outages during transitive refactors.

**Structural phantom (manifest-level):** `psycopg2-binary` + `pgvector` are declared as *optional* extras in pyproject yet are *mandatory* lines in requirements.txt/lock/prod image. One of the two declarations is wrong — currently the pyproject lies about optionality.

### JS (workspaces)

**Imported-but-not-declared:**

| Import | Where | Declared in consuming package? | Note |
|---|---|---|---|
| `vitest` | test files in several packages (`packages/editor`, `packages/research`, …, plus `vitest.config.ts` at root) | Only in ROOT devDependencies | Accepted monorepo hoisting pattern; technically undeclared per-package. INFO. |

**Declared-but-unused (phantom):**
- Root `overrides.sharp: "^0.35.3"` forces sharp although **no manifest declares sharp**; `sharp@0.35.3` sits at root and `npm ls` reports `@emnapi/runtime@1.11.3` and `@img/sharp-wasm32@0.35.3` as **extraneous**. Next.js pulls sharp optionally at build/runtime for image optimization — the override exists for it, but it is undocumented and produces extraneous-node noise. LOW.
- No other phantoms: radix set, tiptap set, katex, lucide-react, cva, clsx, tailwind-merge all map 1:1 to imports in `packages/ui`/`packages/editor`; `tailwindcss`/`postcss`/`autoprefixer` backed by existing `apps/web/tailwind.config.js` + `postcss.config.js`; `next`, `react`, `react-dom`, `eslint`, `eslint-config-next`, `typescript`, `@types/*` all in active use.

**Cross-workspace version skew:** `lucide-react@^0.378.0` duplicated identically in ui/editor/web (fine today, three places to bump); internal `@openresearch/*` cross-refs use `*` (acceptable private workspace idiom).

---

## License Compliance Inventory

Project license: **AGPL-3.0-or-later** (root `package.json` + `LICENSE`; docs dual CC-BY-4.0/MIT). Workspace packages each restate AGPL-3.0-or-later ✔ consistent.

### npm tree (676 packages from `package-lock.json`)

| License | Count | Packages (notable) | Risk vs AGPL project |
|---|---|---|---|
| MIT | 559 | vast majority | None |
| Apache-2.0 | 38 | many | None (patent grant compatible) |
| ISC | 18 | — | None |
| BSD-2-Clause | 10 | — | None |
| BSD-3-Clause | 6 | — | None |
| MPL-2.0 | 13 | axe-core, lightningcss (+11 platform binaries) | None (file-level copyleft, compatible) |
| MIT-0 | 2 | — | None |
| BlueOak-1.0.0 | 2 | minimatch@10.2.6, lru-cache@11.5.2 | None |
| CC0-1.0 | 2 | — | None |
| 0BSD | 1 | — | None |
| Python-2.0 | 1 | argparse | None (permissive PSF variant) |
| CC-BY-4.0 | 1 | caniuse-lite (data) | None (attribution satisfied via bundled license) |
| **LGPL-3.0-or-later** | 10 | **all `@img/sharp-libvips-*` platform binaries** | Low — LGPL dynamic-linking compatible with AGPL; keep binaries unmodified & attribution intact |
| **Apache-2.0 AND LGPL-3.0-or-later (AND MIT)** | 4 | @img/sharp-wasm32, @img/sharp-win32-{arm64,ia32,x64} | Low — same |
| GPL/AGPL in dependency tree | **0** | — | **No copyleft conflict with the project's own AGPL** |
| (none recorded in lock) | 9 | the 9 local `@openresearch/*` workspace links | N/A — licenses declared in their own package.json |

### Python environment (installed distributions via metadata)

| Package | Version | License | Risk |
|---|---|---|---|
| psycopg2-binary | 2.9.12 | **LGPL with exceptions** | Low — the psycopg LGPL exception expressly permits use in non-LGPL apps; AGPL-compatible |
| pillow | 12.3.0 | MIT-CMU | None |
| certifi | 2026.7.22 | MPL-2.0 | None |
| cryptography | 50.0.0 | Apache-2.0 OR BSD-3-Clause | None |
| pypdfium2 | 5.13.0 | BSD-3-Clause/Apache-2.0 + bundled PDFium | None (verify PDFium Google-BSD-style terms retained in dist — INFO) |
| reportlab | 5.0.1 | BSD (ReportLab) | None |
| everything else (fastapi, pydantic, sqlalchemy, uvicorn, httpx, redis, alembic, mypy, ruff, …) | — | MIT / BSD / Apache-2.0 / PSF / Unlicense / ISC / MIT-0 | None |
| Metadata "(none)" fields | colorama, markdown-it-py, mdurl, pathspec, pip-api, pip_audit, pyproject_hooks, tomli_w, setuptools, pdfplumber | known-permissive upstream (BSD/MIT) — metadata gap only | INFO: classifier-only licensing; fine for compliance, noisy for automated scanning |

### Legal docs cross-check
- `docs/COPYRIGHT_AND_LEGAL_POSTURE.md`: tenant isolation / no-redistribution stance — consistent with AGPL network-use posture.
- `docs/LEGAL_REVIEW_CHECKLIST.md`: correctly flags ToS/GDPR/AGPL-compliance-audit/DMCA as hosted-launch blockers. **No dependency-level blockers found for those items** (clean permissive tree). The AGPL §13 obligations remain a process item, not a dependency item.

**Bottom line: zero license conflicts.** Only watch-items are sharp's LGPL binaries (if sharp stays) and psycopg2's LGPL-with-exception.

---

## Tooling & Automation Review

### Dependabot (`.github/dependabot.yml`)

| Ecosystem | Configured | Directory | Cadence | Assessment |
|---|---|---|---|---|
| npm | ✅ | `/` (covers workspaces) | weekly, PR limit 10 | Good |
| pip | ✅ | `/apps/api` | weekly, PR limit 10 | **Partial:** Dependabot's pip ecosystem updates `requirements*.txt` files — it does **not** parse `[project.dependencies]` in `pyproject.toml`. Result: the 3 drifted floors in pyproject will never be auto-aligned. Also: no group/cooldown config → PR flood risk on the unpinned `>=` universe. |
| github-actions | ✅ | `/` | weekly, limit 5 | Good — covers `actions/checkout@v4`, `setup-node@v4`, `setup-python@v5`, `docker/setup-buildx-action@v3`, `docker/build-push-action@v5` in ci.yml |
| **docker** | ❌ **MISSING** | — | — | Nothing watches `infrastructure/Dockerfile.api` (`FROM python:3.11-slim`), `Dockerfile.web` (`FROM node:20-alpine`), or compose images (`pgvector/pgvector:pg16`, `redis:7-alpine`, `lfoppiano/grobid:0.8.0`, `ollama/ollama:latest`). Base-image staleness is currently invisible to automation. |

### Pre-commit (`.pre-commit-config.yaml`)

| Hook repo | Pinned rev | Current (as installed elsewhere in repo) | Status |
|---|---|---|---|
| pre-commit/pre-commit-hooks | v4.6.0 | v5.x line current in 2026 | **Stale major** — functional, but missing years of fixes |
| astral-sh/ruff-pre-commit | **v0.4.4** | ruff **0.16.4** (venv + lock) | **Severely stale: 12 minor releases behind the actual linting toolchain.** Hooks and CI/local lint enforce different rule behavior → nondeterministic style gates. pyproject still declares floor `ruff>=0.4.4`, compounding the three-way split (pin 0.4.4 / floor ≥0.4.4 / reality 0.16.4). |

Also note: hooks scoped to `files: ^apps/api/` — no JS-side hooks (no prettier/eslint pre-commit); acceptable choice, noted for completeness.

### Container base images (`infrastructure/`)

| Image | Used in | Tag policy | Issue |
|---|---|---|---|
| `python:3.11-slim` | Dockerfile.api (single-stage runtime) | floating tag, **no digest pin** | Reproducibility & silent-toolchain-drift (this is where vulnerable pip/setuptools enter). Consider digest-pinning + `pip install --upgrade pip` step or builder-stage toolchain control. Non-root user ✔, healthcheck ✔, apt lists cleaned ✔ (build-essential/curl remain in final image — surface-area nit). |
| `node:20-alpine` | Dockerfile.web (base, deps, builder, **runner**) | floating tag | **Node.js 20 reached end-of-life April 2026 — the production runner executes on an EOL JavaScript runtime.** `.nvmrc`=20 matches the EOL choice. Move to Node 22 LTS (or 24 LTS current in 2026) across .nvmrc/Dockerfile/@types/node. Multi-stage layout itself is good (standalone output, non-root, static copy). |
| `pgvector/pgvector:pg16` | docker-compose.yml + selfhost | major-pinned float | PG17 available; minor floats. Fine for dev; pin for selfhost reproducibility. |
| `redis:7-alpine` | both composes | major-pinned float | Redis 8 GA available; `alpine` float acceptable for dev. |
| `lfoppiano/grobid:0.8.0` | both composes | exact minor pin | Verify 0.8.x latest patch; third-party image — digest-pin recommended. |
| `ollama/ollama:latest` | selfhost compose | **`:latest`** | Unreproducible deployments in a "self-host" artifact — worst practice in this file. Pin a release. |

### Other supply-chain observations
- `package-lock.json` committed ✔ (reproducible npm builds; `npm ci` in Dockerfile.web ✔).
- Python side has **no hash-pinning** (`--require-hashes` unused) and no SBOM generation in CI. pip-audit exists ad-hoc in venv but is **not wired into ci.yml**.
- Root `engines.node: ">=18.0.0"` conflicts subtly with `.nvmrc`/Docker (20) and with Next 16's expectations — cosmetic inconsistency.
- `.env.example` present; no secrets observed in reviewed manifests.

---

## Detailed Findings

Severity scale: CRITICAL > HIGH > MEDIUM > LOW > INFO.

### F-1 · HIGH — Duplicate React runtimes (18.3.1 + 19.2.8) in the web app
- **Evidence:** `npm ls --depth=0`: `@openresearch/editor`/`@openresearch/ui` resolve `react@18.3.1`/`react-dom@18.3.1`; `@openresearch/web` resolves `react@19.2.8`. Physical check: `node_modules/react` = **18.3.1** (hoisted root), `apps/web/node_modules/react` = **19.2.8**; lockfile keys confirm both (`node_modules/react => 18.3.1`, `apps/web/node_modules/react => 19.2.8`). Cause: ui/editor declare `peerDependencies: react ^18.3.1 || ^19.0.0` and no single resolution anchor forces 19 at root.
- **Impact:** Two React instances in one rendered tree → "Invalid hook call", broken context/providers across `@openresearch/ui` primitives & Tiptap editor when consumed by the Next 19 app, doubled bundle size, divergent behavior dev/build.
- **Fix:** Add root `overrides` for `react`/`react-dom` → `^19.2.8` (mirroring the existing postcss/sharp overrides) or narrow ui/editor peers to `^19.0.0`; then `npm install` and verify single physical copy.

### F-2 · HIGH — Production API image ships development tooling (lock built from wrong source)
- **Evidence:** `requirements.txt:19-23` includes pytest/pytest-asyncio/pytest-cov/mypy/ruff; `requirements.lock:1-5` header shows compilation from requirements.txt; lock contains pytest==9.1.1, mypy==2.3.1, ruff==0.16.4, coverage==7.15.4 etc.; `Dockerfile.api:13-14` `RUN pip install --no-cache-dir -r /app/requirements.lock`.
- **Impact:** Larger image & attack surface; dev tools reachable from the running apiuser process; lock provenance divorced from pyproject source-of-truth.
- **Fix:** Split prod/dev requirement files (e.g., `requirements-prod.in` from `[project.dependencies]` + postgres extra) and compile separate locks; Dockerfile installs only the prod lock. (Report-only change recommendation.)

### F-3 · HIGH (environment) — Vulnerable pip & setuptools toolchain (7 unique advisories)
- **Evidence:** pip-audit output above (PYSEC-2026-196/-1795/-1796/-2875/-2876/-3721 on pip 24.0; PYSEC-2026-3447 on setuptools 79.0.1). Not covered by any manifest → drifts with base image.
- **Impact:** Install-time exploitation vectors from malicious wheels/indexes (worst: PYSEC-2026-196 entry-point injection, HIGH). Developer machines and CI most exposed; prod build inherits base-image toolchain.
- **Fix:** Bootstrap step upgrading pip≥26.1.2 & setuptools≥83 before installing requirements, in venv setup scripts, CI, and Dockerfiles; add pip-audit to CI.

### F-4 · MEDIUM — Dependabot blind spots (docker ecosystem absent; pyproject never updated)
- **Evidence:** dependabot.yml has npm/pip/github-actions only; no `package-ecosystem: "docker"` entry for `/infrastructure`.
- **Impact:** Base images & compose images age invisibly (already materialized: EOL node:20); pyproject floors drift from requirements (already materialized: 3 mismatches).
- **Fix:** Add docker entry for infrastructure/; adopt a pyproject↔requirements sync check in CI.

### F-5 · MEDIUM — Production runtime on EOL Node.js 20
- **Evidence:** `Dockerfile.web:1` `FROM node:20-alpine` used for runner stage; `.nvmrc`=20; `@types/node@20`. Node 20 EOL: April 2026 (current date Aug 2026).
- **Impact:** No security patches for the runtime executing the standalone Next server in production.
- **Fix:** Node 22 LTS (or 24) across Dockerfile, .nvmrc, engines, @types/node.

### F-6 · MEDIUM — Pre-commit ruff pin 12 minors behind actual toolchain
- **Evidence:** `.pre-commit-config.yaml:18` `rev: v0.4.4`; lock/venv ruff == 0.16.4; pyproject floor `>=0.4.4`.
- **Impact:** Hook-time and IDE/CI-time lint disagree (rule changes between 0.4→0.16 are substantial); contributors get contradictory failures.
- **Fix:** Bump rev to v0.16.4 (match lock); consider `rev: v0.16.4` + autoupdate workflow; also bump pre-commit-hooks v4.6.0→v5.x.

### F-7 · MEDIUM — Unbounded `>=` floors across the entire Python dependency surface
- **Evidence:** every entry in pyproject/requirements is open-ended; lock already demonstrates silent majors: redis floor ≥5 → locked 8.1.0; bcrypt ≥4.1.2 → 5.0.0; reportlab ≥4.2 → 5.0.1; pypdf ≥4.2 → 6.16.2; mypy ≥1.10 → 2.3.1.
- **Impact:** Any fresh (non-lock) resolve can jump majors; behavioral/security regressions arrive unannounced. Lock mitigates prod, but dev/CI resolves and future regenerations inherit the hazard.
- **Fix:** Introduce upper bounds or a lock-first workflow (`pip-compile` from pyproject via hatch/pdm/uv export), plus CI job failing on lock/regen divergence.

### F-8 · MEDIUM — Undeclared direct imports of transitive modules (starlette, anyio)
- **Evidence:** direct `import starlette` / `from anyio …` occurrences in `apps/api/app/**`; absent from pyproject/requirements.
- **Impact:** Breakage on transitive refactors; misleading dependency graph.
- **Fix:** Add explicit `starlette`/`anyio` entries (versioned to FastAPI-compatible ranges) or route through fastapi/httpx public APIs.

### F-9 · LOW — npm major-version debt cluster
- **Evidence:** `npm outdated` table (B section): tiptap 2→3 (13 packages), tailwindcss 3→4, tailwind-merge 2→3, lucide-react 0.378→1.34, katex 0.16.47→0.18.4, eslint 9→10, typescript 5.9→7.0, @types/node 20→26.
- **Impact:** Growing migration cost & missed fixes; none carry known CVEs today (audit clean).
- **Fix:** Scheduled upgrade waves (tiptap 3 first — largest API delta; then tailwind 4; lucide/katex minor-line bumps opportunistic).

### F-10 · LOW — Lockfile lag within semver ranges (JS)
- **Evidence:** next 16.3.2 installed vs wanted/latest 16.3.3; eslint-config-next same; `npm ci` therefore ships older patches than ranges allow.
- **Impact:** Missed patch fixes; trivial remediation.
- **Fix:** `npm update next eslint-config-next` (or full `npm update`) + commit lock.

### F-11 · LOW — Extraneous/override artifacts around sharp
- **Evidence:** root `overrides."sharp":"^0.35.3"` with no declaring manifest; `npm ls` flags `@emnapi/runtime@1.11.3`, `@img/sharp-wasm32@0.35.3` extraneous; sharp LGPL binaries in tree (license note above).
- **Impact:** Tree noise; unclear intent; LGPL binaries bundled into standalone output need attribution review if actually deployed.
- **Fix:** Document the override's purpose (Next image optimization) in a comment/README, or remove if sharp is not required; ensure standalone output either includes needed sharp binary or excludes all of them deterministically.

### F-12 · LOW — Structural mismatch: Postgres extras mandatory in reqs/lock, optional in pyproject
- **Evidence:** requirements.txt:8-9 vs pyproject optional-dependencies.
- **Impact:** SQLite/default profiles still pull psycopg2/pgvector (and libpq headers in image); contradicts pyproject contract.
- **Fix:** Decide the model (recommended: keep Postgres in prod lock deliberately, fix pyproject comment/extras naming to match reality).

### F-13 · INFO — `ollama/ollama:latest` in selfhost compose
- Floating tag in an operator-facing artifact → unreproducible self-hosts. Pin a version.

### F-14 · INFO — No hash pinning / SBOM / CI pip-audit
- requirements.lock lacks `--generate-hashes`; ci.yml runs no pip-audit/npm-audit gate; no SBOM (CycloneDX) artifact. pip-audit's own presence in the venv proves the team values it — wire it in.

### F-15 · INFO — engines/nvmrc/types alignment
- engines `>=18` vs .nvmrc/Docker 20 vs @types/node 20 vs latest LTS 22+. Align on one supported line (ties into F-5).

### F-16 · INFO — License metadata gaps
- 10 Python dists expose empty License metadata (known-permissive upstream); 9 workspace links show "(none)" in lock. Cosmetic for scanners; add classifiers or a license allowlist tooling note.

---

## Prioritized Remediation Plan

Ordered by risk ÷ effort. Items are recommendations only — no changes were made during this audit.

| # | Action | Addresses | Severity | Effort | Suggested owner area |
|---|---|---|---|---|---|
| 1 | Force single React: root `overrides: { react, react-dom: "^19.2.8" }` (or drop ^18 from ui/editor peers), reinstall, assert one physical copy in CI (`npm ls react` count check) | F-1 | HIGH | S | web/packages |
| 2 | Bootstrap toolchain upgrade everywhere pip runs: `python -m pip install "pip>=26.1.2" "setuptools>=83.0.0"` in venv bootstrap, CI setup steps, and a pre-install `RUN` in Dockerfile.api | F-3 | HIGH | S | api/infra |
| 3 | Rebuild Python locking pipeline from pyproject: prod lock (deps + postgres) vs dev lock; point Dockerfile.api at prod lock only; regenerate with hashes (`--generate-hashes`) | F-2, F-7, F-14 | HIGH | M | api |
| 4 | Align the 3 drifted floors: bump pyproject python-docx→>=1.2.0, reportlab→>=4.5.0 (decide 4 vs 5 intentionally), pypdf→>=5.0.0 (or 6) | Drift matrix | MEDIUM | S | api |
| 5 | Add `package-ecosystem: "docker"` for `/infrastructure` to dependabot.yml; optionally `compose` coverage via docker entry | F-4 | MEDIUM | S | infra |
| 6 | Move off EOL Node 20: Dockerfile.web base→`node:22-alpine` (digest-pinned), .nvmrc→22, engines, @types/node | F-5, F-15 | MEDIUM | M | web/infra |
| 7 | Bump pre-commit: ruff-pre-commit rev→v0.16.4 (match lock), pre-commit-hooks→v5.x; add `ci:autoupdate` schedule | F-6 | MEDIUM | S | api/tooling |
| 8 | Wire audits + SBOM into ci.yml: `npm audit --audit-level=high`, `pip-audit` against prod lock, CycloneDX SBOM artifacts; fail on High+ | F-14 | MEDIUM | M | ci |
| 9 | Declare `starlette` & `anyio` explicitly in pyproject/requirements (ranges compatible with fastapi) or refactor imports to public APIs | F-8 | MEDIUM | S | api |
| 10 | `npm update` for in-range lag (next 16.3.3, eslint-config-next 16.3.3) + commit lock | F-10 | LOW | XS | web |
| 11 | Plan upgrade waves: Tiptap 2→3 → Tailwind 3→4 → lucide-react 1.x → katex 0.18 → ESLint 10 → TS 7 (each behind its own PR + typecheck/test) | F-9 | LOW | L | web/packages |
| 12 | Resolve sharp story: document or remove root override; verify standalone bundle contents; keep LGPL attribution if binaries ship | F-11, license | LOW | S | web |
| 13 | Reconcile Postgres extras model (make prod-lock inclusion deliberate; align pyproject extras/docs) | F-12 | LOW | S | api |
| 14 | Pin `ollama/ollama` release tag; consider digest-pinning grobid/pgvector/redis for selfhost | F-13 | LOW | XS | infra |
| 15 | Optional hygiene: upper-bound strategy or lock-regen CI guard for Python floors; license-metadata classifiers for the 10 "(none)" dists | F-7, F-16 | LOW/INFO | M | api |

**Quick wins (≤30 min total):** #1, #2, #4, #5, #10, #14.

---

*End of report. Generated in read-only mode; repository untouched.*
