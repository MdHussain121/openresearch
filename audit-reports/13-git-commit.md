# OpenResearch — Git & Commit Hygiene Audit (Report #13)

**Audit date:** 2026-08-26
**Repository:** `C:\Users\moham\Pictures\OpenResearch` (git 2.54.0.windows.1)
**Mode:** READ-ONLY analysis. No commits created, amended, or staged. The `git-commit` skill was loaded and applied in ANALYSIS-ONLY mode (Conventional Commits taxonomy used as the classification standard).

---

## Scope & Methodology

Commands executed (read-only):

| Command | Result |
|---|---|
| `git log --oneline -50` | **FATAL**: branch `master` has no commits yet |
| `git log --stat -20` | FATAL: same reason |
| `git log --format=full -15` | FATAL: same reason |
| `git diff --stat HEAD~10..HEAD` | FATAL: unknown revision `HEAD~10` |
| `git shortlog -sn` | Empty output (no history) |
| `git status --porcelain` | 27 top-level entries, **all `??` (untracked)** |
| `git status --porcelain --ignored=matching` | 50 ignored paths (caches, venvs, dbs, logs, storage) |
| `git branch -a -v` / `git tag -l` / `git remote -v` | No branches materialized, **0 tags**, **0 remotes** |
| `git rev-parse --is-inside-work-tree` | `true` |
| `git symbolic-ref HEAD` | `refs/heads/master` (unborn) |
| `git count-objects -v` | `count: 0`, `in-pack: 0` — **zero objects in object database** |
| `git ls-files \| Measure-Object` | **0 tracked files** |
| `git ls-files --others --exclude-standard` | **344 files** would be added by `git add .` |
| `git check-ignore -v <sensitive paths>` | Every sensitive path matched an explicit .gitignore rule (see §Tracked-Sensitive-Files) |
| Filesystem probes | `provider_keys.json`, `.env`, `*.db`, `*.log`, tsbuildinfo, caches located and cross-checked |

Because the repository is at **commit zero**, every historical-analysis dimension (message compliance, granularity, author stats, diff trends) is vacuously N/A. This report therefore pivots to the highest-value question available at this state: *what happens when the first commit is made* — i.e., pre-first-commit secret safety, ignore completeness, hook readiness, and workflow recommendations.

---

## Executive Summary

1. **The repository contains ZERO commits, ZERO tags, and NO remotes.** The entire monorepo (344 source/config/doc files across `apps/`, `packages/`, `docs/`, `infrastructure/`) exists only as untracked working-tree content with an empty object database (`count: 0`). There is no version history, no rollback capability, and no off-machine backup. This is the single most important finding.
2. **No sensitive file is tracked** — trivially true because nothing is tracked — and, more importantly, **every sensitive artifact on disk is correctly excluded by `.gitignore`**, verified individually with `git check-ignore -v`: both real `.env` files, the SQLite dev database, all logs, all `tsconfig.tsbuildinfo` files, `storage/provider_keys.json` (which **does exist** at `apps/api/storage/provider_keys.json`), hundreds of user uploads under `apps/api/storage/uploads/`, coverage output, and all virtualenv/cache directories.
3. **One junk file WILL leak into the initial commit if `git add .` is used:** a stray root-level file named `Starting` (50 bytes: `  - Next.js Web App on http://localhost:3000 ...`), an accidental output-redirect artifact from a startup script.
4. **`.pre-commit-config.yaml` is present but NOT installed** (`C:\...\OpenResearch\.git\hooks\pre-commit` does not exist), pins **ruff v0.4.4** while local cache dirs prove ruff **0.16.1 / 0.16.4** is actually being used (major-version drift → hook behavior will differ from local linting), has **no mypy hook** (mypy runs only in CI), and has **zero JavaScript/TypeScript hooks** despite this being a TS-heavy monorepo.
5. **CI cannot currently run at all** — `.github/workflows/ci.yml` triggers on push/PR, but with no remote the workflow has never executed.

Severity roll-up: **2 CRITICAL · 3 HIGH · 4 MEDIUM · 2 LOW · 4 INFO** (details in §Granularity & Workflow Findings).

---

## Tracked-Sensitive-Files Risk Table

Primary question: *are dangerous files tracked by git?* Answer: **NO — `git ls-files` returns 0 files.** Secondary question: *would they be tracked on first `git add .`?* Answer below, path by path.

| Path (on disk) | Exists? | Currently tracked? | Ignored? (verified rule) | Why dangerous if committed | Action |
|---|---|---|---|---|---|
| `.env` | Yes (808 B, modified 2026-08-25) | No | ✅ `.gitignore:51` → `.env` | Root environment file; live secrets/config | Keep ignored; never force-add |
| `apps/api/.env` | Yes (1,164 B) | No | ✅ `.gitignore:51` → `.env` | Backend runtime secrets (API keys, DB URL) | Keep ignored |
| `apps/api/openresearch_dev.db` | Yes (217 KB) | No | ✅ `.gitignore:48` → `openresearch_dev.db` (+ `*.db` line 45) | User data / research content in SQLite dev DB | Keep ignored; also covered by generic `*.db` |
| `apps/api/api.log` | Yes (252 B) | No | ✅ `.gitignore:73` → `*.log` | May contain tokens, URLs, PII from request logging | Keep ignored |
| `web.log` | Yes (480 B) | No | ✅ `.gitignore:73` → `*.log` | Dev-server log leakage | Keep ignored |
| `apps/api/storage/provider_keys.json` | **Yes** | No | ✅ `.gitignore:70` → `storage/` (matches nested too) | Presumably provider API keys — highest-sensitivity file in repo | Keep ignored; verify backup strategy excludes it from any archive pushed anywhere |
| `apps/api/storage/uploads/**` (~hundreds of UUID-named user files) | Yes | No | ✅ `.gitignore:70` → `storage/` | User-uploaded documents (copyrighted papers, PII) | Keep ignored |
| `storage/` (root) | Yes | No | ✅ `.gitignore:70` | Same class of runtime data | Keep ignored |
| `tsconfig.tsbuildinfo` (root + 7 package copies) | Yes ×8 | No | ✅ `.gitignore:11` → `*.tsbuildinfo` | Build-cache noise; churny diffs pollute history | Keep ignored |
| `coverage/`, `apps/api/.coverage` | Yes | No | ✅ `.gitignore:42` / `:39–40` | Test artifacts | Keep ignored |
| `node_modules/` (root, apps/web, packages/editor, packages/ui) | Yes | No | ✅ `.gitignore:2` | Vendored dependency tree | Keep ignored |
| `apps/api/.venv/` | Yes | No | ✅ `.gitignore:21` | Python virtualenv | Keep ignored |
| `apps/web/.next/` | Yes | No | ✅ `.gitignore:9` | Next.js build output | Keep ignored |
| `.pytest_cache/`, `.ruff_cache/`, `.mypy_cache/`, `__pycache__/` | Yes | No | ✅ `.gitignore:14,38` + per-dir `.gitignore`s inside caches | Tool caches | Keep ignored |
| `.env.example`, `apps/api/.env.example`, `infrastructure/.env.selfhost.example` | Yes | No (**intentionally committable**) | Not ignored (correct) | Templates — scanned for real key material (`sk-…`, long literals): **clean** | ✅ Commit these |
| `Starting` (root, 50 B) | Yes | No | ❌ **NOT IGNORED** — appears in `git ls-files --others --exclude-standard` | Junk: accidental redirect of startup banner text into a file | **Delete the file** before first commit |

**Verdict:** Zero tracked-secret exposure today; the ignore layer is doing exactly its job. The only would-be-junk escapee is `Starting`.

---

## Commit Message Compliance Inventory

**Historical inventory: impossible — there are no commits to classify.**

| Hash | Message | Verdict | Suggested rewrite |
|---|---|---|---|
| — | — | N/A (0 commits exist) | — |

Compliance rate: N/A (0/0). Mega-commit detection, subject-length/mood auditing, junk-commit ("wip"/"fix") scanning, and author attribution (`git shortlog -sn` returned empty): all vacuously pass with no data.

### Forward-looking compliance plan (substitute inventory)

Since the *first* commits are still unwritten, here is the recommended conventional-commit sequence that turns the current 344-file blob into a clean, reviewable history. Each row is a suggested `(hash-pending)` message already in compliant `type(scope): subject` form:

| Seq | Proposed message | Contents | Rationale |
|---|---|---|---|
| 1 | `chore: add repo scaffolding and tooling config` | `.gitignore`, `.editorconfig`, `.nvmrc`, `.python-version`, `.dockerignore`, `.pre-commit-config.yaml`, `.devcontainer/` | Foundation first |
| 2 | `ci: add GitHub Actions workflow and Dependabot config` | `.github/workflows/ci.yml`, `.github/dependabot.yml` | CI gates everything after |
| 3 | `build: initialize npm workspace with shared configs` | `package.json`, `package-lock.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts` | Workspace skeleton |
| 4 | `feat(tokens): add design-token package` | `packages/tokens/**` | Leaf dependency |
| 5 | `feat(ui): add shared UI component library` | `packages/ui/**` | Depends on tokens |
| 6 | `feat(editor): add TipTap editor package` | `packages/editor/**` | |
| 7 | `feat(citations): add citation-processing package` | `packages/citations/**` | |
| 8 | `feat(research): add research pipeline package` | `packages/research/**` | |
| 9 | `feat(plugins): add plugin system package` | `packages/plugins/**` | |
| 10 | `feat(ai): add AI provider integration package` | `packages/ai/**` | |
| 11 | `feat(api): add FastAPI backend service` | `apps/api/**` (excluding ignored runtime data) | Largest unit; could be split further (models/schemas/services/tests) if desired |
| 12 | `feat(web): add Next.js frontend application` | `apps/web/**` | |
| 13 | `build(infra): add Dockerfiles and self-host compose stack` | `infrastructure/**`, `run.cmd`, `start_openresearch.cmd` | |
| 14 | `docs: add project documentation, governance, and audits` | `docs/**`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`, `CODEBASE_AUDIT.md`, `audit-reports/**` | Docs last; includes this report series |

All 14 proposed subjects: ≤72 chars target, imperative mood, lowercase type, optional scope, no trailing period — fully Conventional-Commits compliant.

---

## Granularity & Workflow Findings

### CRITICAL

**G-01 · Entire codebase is unversioned — zero commits in the object database**
- Evidence: `git count-objects -v` → `count: 0, in-pack: 0`; `git symbolic-ref HEAD` → `refs/heads/master` (unborn); `git log` → `fatal: your current branch 'master' does not have any commits yet`.
- Impact: No history, no diffs, no revert/rollback, no blame, no bisect. Any destructive edit, disk failure, or bad tool run is unrecoverable. All prior audit reports (#01–#07) describe code whose change-history is invisible.
- Fix: Execute the 14-step commit sequence above (or at minimum a small number of logical commits — do **not** run a bare `git add . && git commit`). Delete `Starting` first.

**G-02 · No remote configured — no backup, no CI execution, no collaboration surface**
- Evidence: `git remote -v` → empty; `git tag -l` → empty; CI triggers on push can never fire.
- Impact: Single point of failure on one machine (`C:\Users\moham\Pictures`). `.github/workflows/ci.yml` (104 lines of quality gates incl. npm/pip audits and Docker builds) has never run.
- Fix: After initial commits, create the GitHub repo, add remote, push `master` (and consider renaming default branch to `main` to match common convention — CI already lists `main`).

### HIGH

**H-01 · Pre-commit framework configured but hooks are NOT installed**
- Evidence: `.pre-commit-config.yaml` exists (24 lines); `Test-Path .git\hooks\pre-commit` → **False**.
- Impact: Even after commits begin, nothing runs locally unless someone remembers `pre-commit install`. The file is dead weight until then.
- Fix: `pip install pre-commit && pre-commit install` (document in CONTRIBUTING.md).

**H-02 · Ruff version drift between pre-commit pin and actual local toolchain**
- Evidence: `.pre-commit-config.yaml` pins `astral-sh/ruff-pre-commit @ v0.4.4`; ignored cache dirs show `.ruff_cache/0.16.1/` and `.ruff_cache/0.16.4/` — ruff 0.16.x is what developers/CI-era tooling actually use. That is ~12 minor versions of rule-behavior difference (2024→2025 era).
- Impact: Hook passes/fails inconsistently with local `ruff check`; `--fix` may apply different autofixes than the editor/CI.
- Fix: Bump `rev:` to the v0.16.x tag (e.g., matching 0.16.4) and re-run `pre-commit run --all-files`.

**H-03 · Mega-commit risk: 344 heterogeneous files staged in one shot**
- Evidence: breakdown of `git ls-files --others --exclude-standard`: apps 220 · packages 74 · docs 12 · infrastructure 8 · audit-reports 7 · root configs ~23.
- Impact: A single initial commit would blend backend, frontend, infra, docs, and tooling into an unreviewable, unrevertable unit — precisely the anti-pattern the granularity axis exists to prevent.
- Fix: Use the sequenced plan above; at minimum split code vs. docs vs. tooling into ≥3 commits.

### MEDIUM

**M-01 · Junk artifact `Starting` sits in the committable set**
- Evidence: root file, 50 bytes, sole content `  - Next.js Web App on http://localhost:3000 ...`; last write 2026-08-26 12:38 (startup time). Not matched by any ignore rule.
- Cause hypothesis: a start script doing something like `echo ... > Starting` or a mis-quoted redirect of a "Starting services:" banner.
- Fix: `Remove-Item Starting`; grep `run.cmd`/`start_openresearch.cmd` for the offending redirect; fix the script so it prints to console/log instead.

**M-02 · mypy enforced in CI but absent from pre-commit**
- Evidence: `ci.yml:64-67` runs `mypy app`; `.pre-commit-config.yaml` has no mypy hook (local mirror repo e.g. `mirrors-mypy` not configured).
- Impact: Type errors discovered only at push time; slow feedback loop; encourages `--no-verify` habits once hooks are installed.
- Fix: Add a local mypy hook scoped to `apps/api` (with `files: ^apps/api/` and appropriate `additional_dependencies`), accepting slower hook runtime.

**M-03 · No secret-scanning hook anywhere in the pipeline**
- Evidence: neither `.pre-commit-config.yaml` nor `ci.yml` runs gitleaks/detect-secrets/trufflehog. Today's safety is purely pattern-based `.gitignore` exclusion.
- Impact: One future rename (e.g., `secrets.env`, `keys.json` outside `storage/`) silently becomes committable; nothing catches an inline hardcoded key.
- Fix: Add `gitleaks` (via pre-commit or a GitHub Actions step; GitHub-native secret scanning also available once pushed).

**M-04 · No JavaScript/TypeScript quality hooks despite TS-dominant codebase**
- Evidence: pre-commit covers Python (`ruff`, `ruff-format`, scoped `^apps/api/`) plus generic whitespace/YAML/JSON checks; no eslint/prettier/tsc hooks for the 74 package files + web app.
- Impact: Frontend style/type issues caught only in CI (`npm run typecheck/lint`), if at all locally.
- Fix: Either add `mirrors-eslint` / prettier hooks, or adopt `lint-staged` + husky for the JS side; document whichever path is chosen.

### LOW

**L-01 · `check-yaml` runs with `--unsafe`**
- Evidence: `.pre-commit-config.yaml:10-11`. Disables safe-load restrictions (arbitrary YAML tags allowed).
- Impact: Minor — a malicious/odd YAML could execute custom-tag construction during load. Low realistic risk for a private-first repo, but unnecessary.
- Fix: Drop `--unsafe`; add targeted `exclude:` for any workflow file that genuinely needs custom tags (none found).

**L-02 · CI branch list references branches that don't exist**
- Evidence: `ci.yml:3-7` triggers on `main, develop, master`; only unborn `master` exists; no `develop` strategy visible.
- Impact: Cosmetic/dead-config now; harmless once remote exists.
- Fix: Trim to the branches actually used, or keep intentionally for future growth (document choice).

### INFO

**I-01 · No tags, no release discipline yet** — acceptable at commit zero; introduce `v0.1.0` semver tagging once history begins (CHANGELOG.md already exists to anchor it).
**I-02 · No nested git repositories** — recursive search found no stray `.git` dirs under `apps/*`/`packages/*`; workspace won't hit embedded-repo pitfalls.
**I-03 · `audit-reports/01–07` are untracked** — committing them (per seq #14) preserves the audit trail in-repo; alternatively keep them out-of-tree if they're ephemeral scratch. Decide deliberately.
**I-04 · Author identity unrecorded** — with zero commits there's no author data; ensure `user.name`/`user.email` are set globally before the first commit so attribution isn't mangled.

---

## Gitignore Gap Analysis

**Verified effective (spot-checked via `git check-ignore -v`):**

| Concern | Rule(s) | Status |
|---|---|---|
| Node modules, build output, Next artifacts, tsbuildinfo | lines 2, 7–11 | ✅ |
| Python bytecode, caches, pytest, coverage (incl. `**/.coverage`) | 14–15, 38–42 | ✅ |
| Databases: `*.db`, `*.sqlite`, `*.sqlite3`, explicit dev-db name | 44–48 | ✅ |
| Env/secrets: `.env` family, `*.pem`, `*.key` | 50–58 | ✅ (both real `.env` files confirmed blocked) |
| IDE noise, OS cruft | 60–66 | ✅ |
| Uploads/runtime: `uploads/`, `storage/`, `tmp/`, `*.log` | 68–73 | ✅ (provider_keys.json + hundreds of uploads confirmed blocked) |

**Gaps identified:**

1. **HIGH-value:** No rule catches the observed failure mode that produced `Starting` (extensionless redirect junk). Can't pattern-match generically without false positives — fix the generator script and delete the file rather than ignore it. If similar banners recur, add exact-name entries.
2. **LOW:** SQLite sidecar extensions not covered: `openresearch_dev.db-wal`, `-shm`, `-journal` are matched only if named `*.db` exactly. Add `*.db-wal`, `*.db-shm`, `*.db-journal` (SQLite WAL mode creates these next to the db during runtime).
3. **LOW:** Redundant duplicates inflate maintenance: `env/`+`venv/`+`.venv/`+`ENV/` (19–22), double `build/` (8, 23), double `dist/` (7, 25), `storage/`+`storage/uploads/` (70–71, first subsumes second). Harmless but noisy.
4. **INFO:** `/lib/` and `/lib64/` (29–30) anchored to repo root — correct for Python packaging conventions, no effect on JS `lib/` dirs elsewhere; intentional presumably.
5. **PASS:** `.env.example` variants correctly remain committable (only `.env` and `.env*.local` patterns exclude) — and were content-scanned: no real credential-shaped strings found in any `*.example` file.

---

## Pre-commit Config Review

**Inventory of `.pre-commit-config.yaml` (24 lines, 2 repos, 8 hooks):**

| Hook | Rev | Scope | Verdict |
|---|---|---|---|
| trailing-whitespace | pre-commit-hooks v4.6.0 | all (excl. `*.min.js/css`) | ✅ good |
| end-of-file-fixer | v4.6.0 | all (excl. minified) | ✅ good |
| check-yaml | v4.6.0 | all | ⚠️ uses `--unsafe` (L-01) |
| check-json | v4.6.0 | all | ✅ |
| check-added-large-files | v4.6.0 | 1000 KB threshold | ✅ reasonable |
| check-merge-conflict | v4.6.0 | all | ✅ |
| ruff (--fix) | ruff-pre-commit **v0.4.4** | `files: ^apps/api/` | ⚠️ stale pin (H-02) |
| ruff-format | v0.4.4 | `^apps/api/` | ⚠️ stale pin (H-02) |

**Answers to the three sanity questions posed by the audit brief:**

1. *Does it cover ruff?* **Yes** — but pinned 12 minor versions behind actual usage, and Python-only scoping.
2. *Does it cover mypy?* **No** — mypy exists solely as a CI step (`ci.yml:64-67`). Local drift guaranteed.
3. *Does CI run it?* **No** — `ci.yml` independently re-implements ruff/mypy/pytest/npm-lint steps; there is no `pre-commit run --all-files` job. Duplication means the two layers *will* diverge (they already have, on ruff version). Also: hooks aren't even installed locally (H-01), so today the enforcement chain is: nothing locally → CI (never executed, no remote).

**Additional misses:** no secret scanner (M-03), no JS/TS formatting/linting hooks (M-04), no `forbid-new-submodules` / `no-commit-to-branch` guardrails (optional hardening), no `detect-private-key` (the built-in pre-commit-hooks id — free win given `*.pem`/`*.key` sensitivity concerns).

---

## Positive Observations

1. **The ignore layer is exemplary.** Every one of the nine sensitive-path classes probed resolved to an explicit, correct rule; zero sensitive files appear in the 344-file committable set. Whoever wrote `.gitignore` anticipated the real artifacts this project produces (including the exact dev-db filename and `storage/` trees).
2. **Secret hygiene on disk is disciplined:** real envs kept in dotfiles, sanitized `*.example` templates provided at all three config sites (root, api, selfhost-infra) and verified free of credential-shaped content.
3. **CI design is unusually complete for a pre-history repo:** separate FE/BE jobs covering typecheck, lint, tests, dependency audits (`npm audit`, `pip-audit` against a pinned `requirements.lock`), plus a gated Docker build job — the quality bar is defined even though it hasn't fired.
4. **Governance docs are extensive:** SECURITY.md, DATA_RETENTION_POLICY.md, COPYRIGHT_AND_LEGAL_POSTURE.md, VPAT statement, SELF_HOSTING.md — rare maturity for commit-zero.
5. **Toolchain pinning culture is present** (`.nvmrc`, `.python-version`, `requirements.lock`, Dependabot) — the ruff hook pin is the lone laggard, likely just staleness rather than philosophy.
6. **Clean tree structure:** no nested repos, no orphan IDE folders, no duplicate-project confusion; workspaces layout (`apps/*`, `packages/*`) is coherent.

---

## Prioritized Recommendations

| # | Priority | Recommendation | Effort |
|---|---|---|---|
| 1 | 🔴 CRITICAL | Delete `Starting`; fix its generating script (`run.cmd` / `start_openresearch.cmd`) | Minutes |
| 2 | 🔴 CRITICAL | Create initial history via the 14-step sequenced commit plan (§Commit Message Compliance) — never a bare `git add .` mega-commit | 30–60 min |
| 3 | 🔴 CRITICAL | Add a remote (GitHub), push `master`/`main`; confirm `ci.yml` executes end-to-end on the first push | 15 min |
| 4 | 🟠 HIGH | Run `pre-commit install`; verify hooks fire on a trial commit | Minutes |
| 5 | 🟠 HIGH | Bump ruff-pre-commit `rev` to v0.16.x; `pre-commit run --all-files` and reconcile any new findings before they bite mid-history | 15 min |
| 6 | 🟠 HIGH | Set `git config user.name/email` (global) before commit #1 for correct attribution | Minute |
| 7 | 🟡 MEDIUM | Add gitleaks (or detect-secrets) hook + a CI secret-scan step | 20 min |
| 8 | 🟡 MEDIUM | Add mypy pre-commit hook scoped to `apps/api`; align settings with `ci.yml:64-67` | 20 min |
| 9 | 🟡 MEDIUM | Add `pre-commit run --all-files` as a CI job to make the config authoritative and kill duplication drift | 10 min |
| 10 | 🟡 MEDIUM | Add JS/TS gating: either mirrors-eslint/prettier hooks or husky+lint-staged | 30–60 min |
| 11 | 🟢 LOW | Extend `.gitignore` with `*.db-wal`, `*.db-shm`, `*.db-journal`; dedupe redundant rules (lines 19–25, 70–71) | 5 min |
| 12 | 🟢 LOW | Remove `--unsafe` from check-yaml; add `detect-private-key` hook (free) | 5 min |
| 13 | 🟢 LOW | Decide fate of `audit-reports/` (in-repo vs out-of-tree) and document; tag `v0.1.0` after initial history lands | 10 min |

---

*End of report #13. Generated read-only; repository state untouched (still 0 commits, 0 objects — by design).*
