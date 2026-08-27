# Python Code Style Audit — `apps/api` (OpenResearch Backend)

- **Audit date:** 2026-08-26
- **Auditor:** ox-alpha (read-only static style audit; no files were modified)
- **Skill applied:** `python-code-style` (PEP 8 naming, import organization, docstrings, type annotations, formatting, tooling configuration)

---

## Scope & Methodology

**Scope:** Every Python file under `apps/api/**`, including `app/` (api, core, models, schemas, services, plugins, main.py), `alembic/` (env + 4 migrations), and `tests/` (~40 files). Excluded per instructions: `.venv`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `__pycache__`, `node_modules`, `storage`, `logs`.

**Corpus:** ~120 `.py` files. All 78 application/alembic files were read in full. All test files were characterized via targeted reads plus automated rule sweeps.

**Methodology (read-only):**

1. Full manual read of every module in `apps/api/app`, `apps/api/alembic`, plus representative and flagged regions of `apps/api/tests`, evaluated against the skill's checklist: PEP 8 naming, import ordering/grouping, line length & formatting consistency, docstring coverage & quality, module layout, string quoting, dead naming, magic numbers, comment quality.
2. Automated baseline: `ruff check apps/api --no-cache` with the **project's own config** (result: **clean**, 0 findings) — establishing that all findings below live *outside* the currently enabled rule set.
3. Extended read-only rule sweeps with `--select` over bugbear (`B`), comprehensions (`C4`), simplification (`SIM`), pyupgrade (`UP`), pep8-naming (`N`), flake8-quotes (`Q`), logging-format (`G`), pylint family (`PL*`), docstrings (`D`), eradicate (`ERA`), flake8-self (`SLF`), complexity (`C901`), return-style (`RET`), builtins (`A`), debugger/print (`T10/T20`), and more.
4. Mechanical scans: line-length census (>120 chars), trailing-whitespace scan, grep sweeps for `TODO|FIXME|XXX|HACK`, `print(`, f-string logging, private-member access, and cross-file duplication checks.

**Severity scale:** `CRITICAL` (style defect that corrupts output or breaks correctness today), `HIGH` (systemic style-policy failure or high-risk latent defect), `MEDIUM` (clear violation of stated conventions with maintenance cost), `LOW` (minor polish), `INFO` (observation/no action needed).

---

## Executive Summary

Overall the codebase is in **good mechanical shape**: `ruff check` with the project's own configuration passes cleanly, imports are sorted, there are no unused imports/variables, no debug prints, no TODO/FIXME debt, and SQLAlchemy 2.0 typed-model conventions are applied uniformly. The dominant problems are (a) an **overly permissive toolchain config** that hides real issues (E501 and E741 ignored, only 4 rule families enabled, alembic excluded entirely), (b) **duplicated/divergent logic** (two BibTeX serializers, four copies of access-check helpers), (c) **string-typed pseudo-enums** everywhere, (d) several **very high-complexity functions**, and (e) two **production-path private-member accesses** plus one **nondeterministic `hash()`-based ID**.

### Finding counts per severity

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 6 |
| MEDIUM | 23 |
| LOW | 27 |
| INFO | 5 |
| **Total** | **61** |

Automated evidence totals (extended read-only sweeps, whole tree): 517 magic-value comparisons (PLR2004), 445 non-PEP-585 annotations (UP006), 369 non-PEP-604 optionals (UP045), 283 undocumented public methods (D102) / 222 functions (D103) / 192 classes (D101) / 71 modules (D100), 101 private-member accesses (SLF001), 56 function-level imports (PLC0415), 32 complex structures (C901), 11 `raise`-without-`from` (B904), 9 `global` statements (PLW0603), 7 f-string logging calls (G004), 6 loop-variable closures (B023), 74 lines over 120 characters.

---

## Detailed Findings

### H1. HIGH — No enforced line-length budget; 74 lines exceed 120 chars (worst: 264)

`E501` is globally ignored in `pyproject.toml` and no formatter run is wired in, so long lines accumulate unchecked.

- `apps/api/app/api/v1/endpoints/export.py:75` — **264 characters** (a `Query(...)` description listing 26 citation styles inline):
  ```python
  style: str = Query("apa", description="Citation style (26 supported): apa, mla, chicago, chicago-notes, ieee, harvard, vancouver, nature, science, acm, acs, turabian, ama, nlm, cse, apsa, asa, aaa, mhra, oxford, oscola, bluebook, abnt, iso690, gbt7714, cell"),
  ```
- `apps/api/app/services/intelligence_service.py:276` — 228 chars (gap-description string).
- `apps/api/app/api/v1/endpoints/documents.py:113` — 138 chars (conflict-detail f-string).
- `apps/api/app/services/intelligence_service.py:302` — 209 chars; `:322` 164; `:344` 138; `:354` 134; `:597` 175.
- `apps/api/app/api/v1/endpoints/collaboration.py:270` — 127 chars (`logger.warning("Dropping oversized collaboration frame ...")`).
- `apps/api/app/api/v1/endpoints/papers.py:571` — 121 chars:
  ```python
  f"{p.paper_title} — p.{p.page_number} ({p.section})" if p.section else f"{p.paper_title} — p.{p.page_number}"
  ```
- `apps/api/app/services/export/csl_formatter.py:137` — 136 chars; `:198` 133.
- `apps/api/app/services/export/markdown_exporter.py:106` — 141; `pdf_exporter.py:305` — 134; `ast_parser.py:22` — 136 (inline comment enumerating node types).
- `apps/api/app/core/text_utils.py` region `:101–186` contains several 120+ char conditional-return chains (e.g. `:155`, `:176`, `:183–186`).
- Remaining ~50 occurrences are concentrated in `tests/` (`test_phase8_intelligence.py:115` — 244 chars; `test_cov_services_final.py:109–110`; `test_phase4_rag_and_chat.py:19–62`; etc.).

**Impact:** Inconsistent reading experience; diffs become noisy; the skill's own recommended budget (120) is silently unenforced.
**Suggested fix:** Set `line-length = 120` in `[tool.ruff]`, add `[tool.ruff.format]` and run `ruff format` once, then remove `"E501"` from the ignore list. Extract the 264-char enum-list into a named constant or `Enum` docstring.

---

### H2. HIGH — Ambiguous variable name `l` in production code, permitted by ignoring `E741`

`pyproject.toml:50` ignores `E741` (ambiguous variable name), and the codebase then actually uses `l`:

```python
# apps/api/app/services/intelligence_service.py:269
dataset_limits = [l for l in limitations if "dataset" in l.excerpt.lower() or "benchmark" in l.excerpt.lower()]
```
Also `intelligence_service.py:290–294` (`for l in limitations ... l.excerpt.lower()`) and `apps/api/app/services/pdf_extractor.py:427`:
```python
lines = [l.strip() for l in first_page_text.split("\n") if l.strip()]
```

**Impact:** `l` is visually indistinguishable from `1`/`I`; PEP 8 explicitly discourages it. Ignoring the rule *and* using the name compounds the problem.
**Suggested fix:** Rename to `limit_item`/`limitation` and `line`; remove `"E741"` from the ignore list.

---

### H3. HIGH — Two divergent BibTeX serializers for the same data model

Near-duplicate ~50-line implementations exist and behave differently:

- `apps/api/app/api/v1/endpoints/citations.py:51–105` — `serialize_paper_to_bibtex(paper)` **escapes** BibTeX special characters via `_bibtex_escape` (`citations.py:34–48`).
- `apps/api/app/services/export/bibtex_exporter.py:13–65` — `serialize_paper_bibtex(pair)` does **no escaping**:
  ```python
  fields = [
      f"  title = {{{paper.title}}}",   # raw title, braces/&/% injected verbatim
      f"  author = {{{authors_formatted}}}",
  ```

Both build identical cite-keys (`firstauthorYearWord`, default year `2023` — itself a magic value at `citations.py:73` and `bibtex_exporter.py:34`). The document/project BibTeX endpoints (`citations.py:416–464`) use the escaping version; the DOCX/PDF/MD export pipeline uses the non-escaping one, so a title containing `&` or braces produces structurally valid output from one endpoint and corrupt `.bib` from another.

**Impact:** Inconsistent output for identical input; a latent correctness bug expressed as a style/duplication failure.
**Suggested fix:** Keep only `app/services/export/bibtex_exporter.py::serialize_paper_bibtex`, move `_bibtex_escape` next to it, have `citations.py` import it, and cover both paths with a shared unit test.

---

### H4. HIGH — Backslash-escaped quotes leak literal `\` into citation-formatter output

`apps/api/app/plugins/csl_processor.py` uses `\\\"` inside f-strings, which emits a literal backslash before each quote:

```python
# csl_processor.py:76  (_ieee)
ref = f"{', '.join(initials)}, \\\"{title},\\\""
# csl_processor.py:116 (_mla)
ref = f"{mla_first}{extra}. \\\"{title}.\\\" {venue}"
# csl_processor.py:125 (_chicago)
ref = f"{_join_authors(chicago_authors)} \\\"{title}.\\\" {venue}"
```
Rendered result: `Smith, J., \"Some Title,\" Journal …` — stray backslashes in every IEEE/MLA/Chicago string produced by this plugin. Flagged by `Q000/Q003` sweeps.

**Impact:** User-visible corrupted citation text; the defect originates purely from quoting style.
**Suggested fix:** Use single-quoted outer strings or doubled braces: `ref = f'{...", "{title}," ...'`.

---

### H5. HIGH — Nondeterministic `hash()` used for stable identifiers

`apps/api/app/services/graph_service.py:256`:

```python
id=f"rec-{doi}" if doi else f"rec-{abs(hash(title)) & 0xFFFFFFFF}",
```

Python's builtin `hash()` is salted per process for `str`, so IDs change across restarts/workers — exactly the pitfall the project itself documents in `rag_service.EmbeddingService` (`rag_service.py:33–39`: *"builtin hash() is salted per process and must not be used"*).

**Impact:** Unstable client-side keys/react-list reconciliation; internal inconsistency with the project's own stated rule.
**Suggested fix:** Reuse `EmbeddingService._stable_hash` (BLAKE2b) or fall back to `uuid.uuid4()`.

---

### H6. HIGH — Production code reaches into other components' private members

- `apps/api/app/api/v1/endpoints/papers.py:549`
  ```python
  llm_answer = rag_service._llm_grounded_answer(user_prompt or query, "document", passages)
  ```
- `apps/api/app/api/v1/endpoints/health.py:33`
  ```python
  redis_client = provider_cache_service._get_redis()
  ```

Endpoint layer depending on underscore-private APIs couples routes to implementation details (the remaining ~95 SLF001 hits are confined to tests — see M23).

**Suggested fix:** Promote `RAGService.grounded_answer(...)` and `ProviderCacheService.redis_ping()` (or a `status` property) to public methods.

---

### M1. MEDIUM — Linter/type-checker configuration too weak for the conventions the code claims

`apps/api/pyproject.toml:44–59`:
```toml
[tool.ruff.lint]
select = ["E", "F", "W", "I"]
ignore = ["E501", "E741", "B008"]

[tool.mypy]
...
ignore_missing_imports = true
check_untyped_defs = true
```
Only 4 rule families enabled; `ruff format` is not configured; mypy runs at roughly half strength (no `disallow_untyped_defs`, no `warn_unused_ignores`, no `strict`). The skill's baseline recommends selecting `E,W,F,I,B,C4,UP,SIM` with a configured formatter and stricter mypy overrides for tests.
**Suggested fix:** Adopt the extended select list incrementally (start with `B,C4,SIM,UP,G,RET` in warn-only CI job), configure `[tool.ruff.format] quote-style="double"`, and tighten mypy per-package.

### M2. MEDIUM — Alembic tree excluded from lint/format; internal inconsistencies

`pyproject.toml:46` excludes `alembic`. Consequences visible today:
- Single-quoted revision metadata strings in all four migration files (`alembic/versions/ec9eb70fcc96_initial_schema.py:15–18` etc.) vs. double quotes everywhere else.
- **Trailing whitespace** at `alembic/versions/ec9eb70fcc96_initial_schema.py:4` (`Revises: ` line) — the only trailing-whitespace occurrence in the entire backend.
- Legacy `Union[str, Sequence[str], None]` annotations where the target version supports `str | Sequence[str] | None`.

**Suggested fix:** Drop `alembic` from excludes (keep autogenerated banners), format once, keep future autogen templates quoted per project style.

### M3. MEDIUM — Builtin shadowing: `remote_side=[id]`

`apps/api/app/models/comment.py:55`:
```python
parent: Mapped[Optional["DocumentComment"]] = relationship(
    "DocumentComment", remote_side=[id], back_populates="replies"
)
```
Here `id` refers to the mapped column defined at `comment.py:25` and shadows the builtin within class scope (flagged `A003`). Idiomatic form is `remote_side=[DocumentComment.id]` or the string `["id"]`... i.e. `remote_side="DocumentComment.id"` / `remote_side=[__table__.c.id]`. Same pattern exists in `version.py:52` (`relationship("Document", backref="versions")` is fine) — only `comment.py` triggers the shadowing.
**Suggested fix:** `remote_side=[DocumentComment.id]` via explicit class ref or move the self-reference below the column definition with a qualified name.

### M4. MEDIUM — Statuses/roles/modes are untyped string literals scattered across modules

No `Enum`/`Literal` types exist anywhere in the backend. Recurring literal vocabularies:

| Vocabulary | Sample sites |
|---|---|
| extraction status `"ok" \| "unverified" \| "unresolved"` | `models/paper.py:35`, `papers.py:154,300`, `identifier_resolver.py:135,166,230,295`, `pdf_extractor.py:694–695` |
| membership role `"owner" \| "editor" \| "viewer"` | `models/membership.py:29` (comment only), `owner.py:28`, `projects.py:113`, `teams.py:128,203,238,276`, `schemas/models.py:778,790` |
| chat mode `"document" \| "library" \| "project" \| "general"` | `chat.py:25,136`, `rag_service.py:365–370,605` |
| grounding state `"source-grounded" \| "ai-inference" \| "general-knowledge"` | `schemas/models.py:291,456,529` + dozens of literals in `rag_service.py` |
| autocomplete engine `"auto" \| "tabby" \| "cloud" \| "ollama"` | `provider_settings.py:59`, `ai_writing_service.py:76–78`, `tabby_setup_service.py:196` |

**Impact:** Typos compile silently; validation is duplicated ad hoc (`chat.py:_resolve_mode`, `ai_writing_service.py:94`).
**Suggested fix:** Define `class Role(str, Enum)` / `Literal[...]` aliases in a new `app/core/enums.py`; use them in schemas so FastAPI validates for free.

### M5. MEDIUM — Schema fields typed bare `str` with allowed-value comments

`apps/api/app/schemas/models.py` repeatedly encodes vocabularies only as trailing comments:
```python
# models.py:303
role: str  # 'user' | 'assistant' | 'system'
# models.py:487-489
action: (
    str  # 'clarity' | 'academic' | 'simplify' | 'shorten' | 'expand' | 'grammar' | 'flow' | 'translate' | 'explain'
)
# also :190 (step), :309 (mode), :318 (grounding_state), :378 (id_type),
#       :464 (engine), :538 (export_format), :586 (reason), :615 (category),
#       :674-675 (category/severity), :778/790 (role), :885 (change_type),
#       :902 (GraphNode.type), :911 (GraphEdge.type), :951-953 (plugin_type)
```
Note `TeamMemberAdd.role`/`TeamMemberUpdate.role` *do* validate via `field_validator` (`models.py:780–798`) — duplicating what `Literal["owner","editor","viewer"]` would give declaratively, and the validator body is copy-pasted twice.
**Suggested fix:** Convert these fields to `Literal`/`Enum`; collapse the two `_validate_role` copies.

### M6. MEDIUM — Function-level imports (56 occurrences)

Production-code instances:
- `apps/api/app/main.py:45–46` (deferred heavy-service import in `_start_tabby_if_enabled`)
- `apps/api/app/core/config.py:46` (`import json` inside validator)
- `apps/api/app/api/v1/endpoints/health.py:31` (`provider_cache_service` imported mid-request)
- `apps/api/app/api/v1/endpoints/collaboration.py:81` (`import redis.asyncio as aioredis` in `__init__`)
- `apps/api/app/services/pdf_extractor.py:294` (`import pdfplumber` inside method)
- `apps/api/app/services/tabby_setup_service.py:177,215` — **`import logging` re-imported inside two functions** although `logging` is stdlib-cheap and already used at top level in sibling modules.

Remaining ~49 are in `tests/` (see M23/L-series). Some lazy imports are justified (optional deps, circularity); `logging` ones are not.
**Suggested fix:** Hoist unconditional imports; for genuinely optional deps keep the local import but add a brief comment stating why (the codebase does this nowhere).

### M7. MEDIUM — Useless import alias / awkward triple-import block

`apps/api/app/services/export/csl_formatter.py:10–18`:
```python
from app.core.text_utils import (
    format_authors_bibliography,
)
from app.core.text_utils import (
    format_authors_inline as format_authors_inline,
)
from app.core.text_utils import (
    format_inline_marker as core_format_inline_marker,
)
```
Three separate statements from the same module; the middle alias renames nothing (PLC0414). One combined import reads better:
```python
from app.core.text_utils import (
    format_authors_bibliography,
    format_authors_inline,
    format_inline_marker as core_format_inline_marker,
)
```

### M8. MEDIUM — Two competing typing styles mixed throughout

Target is `requires-python = ">=3.11"`, yet both `typing.List/Dict/Tuple/Optional` and PEP 585/604 builtin generics appear, sometimes **within the same signature**:
- `apps/api/app/services/zotero_service.py:166` — `-> tuple[List[Dict[str, Any]], Optional[int]]` (mixed in one annotation).
- `apps/api/app/services/auth.py:165` — `required_roles: Optional[list[str]]` (mixed).
- `apps/api/app/services/llm_service.py:125` — `def _tabby_target(self) -> tuple[str, str]:` vs. `List[Dict[str, str]]` everywhere else in the same file.
- `apps/api/app/services/provider_cache_service.py:35` — `OrderedDict[str, Dict[str, Any]]` (PEP 585 on collections.OrderedDict, fine but inconsistent with neighbors).
- `apps/api/app/services/plugin_service.py:187–189` — `) -> tuple:` **unparameterized** return annotation.
- `apps/api/app/core/config.py:43` — `Union[str, List[str]]` while newer code uses `Optional[list[str]]`.
- Repo-wide sweep: UP006 ×445, UP045 ×369, UP035 ×87, UP037 ×8, UP007 ×1.

**Suggested fix:** Pick one style (given py311: builtin generics + `X | None`) and apply repo-wide with `ruff check --select UP --fix`.

### M9. MEDIUM — Public entry points missing annotations/docstrings

- `apps/api/app/main.py:53–54` — `async def lifespan(app: FastAPI):` (no return annotation; should be `-> AsyncIterator[None]`).
- `apps/api/app/main.py:93–95` — `def root():` no annotation, no docstring.
- `apps/api/app/core/database.py:14` — `def set_sqlite_pragma(dbapi_connection, connection_record):` fully unannotated listener.
- `apps/api/app/core/database.py:29–34` — `def get_db():` unannotated generator dependency used by every route.
- `apps/api/app/services/plugin_runtime.py:51` — `def resolve_entrypoint(spec):` no return annotation despite being the security-sensitive resolver.
- `apps/api/app/services/tabby_setup_service.py:146,161` — `endpoint_host_port(...) -> tuple` / `_effective_endpoint() -> tuple` bare tuples (one is a 3-tuple via `base_url, *rest` unpacking at `:164`).
- `apps/api/app/plugins/csl_processor.py:46` — `_base_fields(payload) -> tuple` (always a 6-tuple).

### M10. MEDIUM — `schemas/models.py` is a 1,027-line monolith covering 9 roadmap phases

A single module holds ~90 Pydantic classes separated only by banner comments (`# --- Phase 4 RAG & AI Chat Schemas ---` at `:272`, `Phase 5` `:354`, `Phase 6` `:442`, `Phase 7` `:534`, `Phase 8` `:555`, `Phase 9` `:760`, Literature Search `:998`). The skill's module-layout guidance favors cohesive smaller modules; the file mixes auth, projects, RAG, citations, exports, Zotero, plugins, and graphs concerns.
**Suggested fix:** Split into `schemas/{auth,projects,documents,papers,citations,rag,writing,export,intelligence,zotero,plugins,graphs,literature}.py`, keeping `schemas/__init__.py` re-exports for compatibility.

### M11. MEDIUM — `model_config` declared at the bottom of `Settings`

`apps/api/app/core/config.py:112` places `model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")` after validators/methods; pydantic convention (and readability) puts it immediately after the class docstring/first fields. Relatedly, fields bypass pydantic-settings env loading by calling `os.getenv` themselves (`config.py:20–88`, e.g. `ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")`) — a double-env mechanism that defeats `SettingsConfigDict` and makes precedence harder to reason about; `:28–29` wrap arithmetic in `str()` round-trips:
```python
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24)))
REFRESH_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 30)))
```
**Suggested fix:** Use plain typed defaults (`ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24`) and let BaseSettings read env; hoist `model_config` to the top of the class; extract `24*60`/`30*24*60` into named constants.

### M12. MEDIUM — Docstring coverage gaps in application code

Ruff `D` sweep (whole tree) shows D100×71, D101×192, D102×283, D103×222, D107×20. Application-side highlights:
- **Every endpoint module** lacks a module docstring (`app/api/v1/endpoints/*.py` ×20) even though several contain non-obvious helpers (`_map_ai_errors`, `_issue_token_pair`).
- `app/core/database.py` — no module or `get_db` docstring.
- `app/models/*.py` — no module docstrings; columns rely on sparse inline comments (e.g. `membership.py:29`, `owner.py:28` carry the only vocabulary docs).
- `app/api/v1/api.py` — bare router aggregation with tag strings only.
- Endpoint handler docstrings describe roadmap intent well but systematically omit **Args/Returns/Raises** sections (e.g. `papers.py:65–72`, `citations.py:477–481`), and error contracts (which HTTP codes a helper raises) are undocumented.
- Existing docstring house style is split between summary-first multiline (`D212`×129) and imperative-mood one-liners (`D401`×36) — pick Google style per the skill and normalize.

Positive counter-examples worth cloning: `llm_service.py:1–15` (module contract), `http_client.py:29–40`, `plugin_runtime.py:1–7`, `tabby_setup_service.py:1–13`, `middleware.py:1–4`.

### M13. MEDIUM — Access-check helpers duplicated 2× and 3×

- `_check_doc_access` — byte-for-byte duplicate at `comments.py:22–31` and `version_history.py:52–61`.
- `_check_project_access` — three variants: `graphs.py:19–25` (no `required_roles`, generic 403 message), `intelligence.py:25–33` (roles param), `zotero.py:21–32` (roles param, different message).

Additionally, the inline pattern "query entity → 404 → `verify_user_access_to_owner` → 403" is hand-rolled ~30 more times across endpoints (`documents.py`, `papers.py`, `citations.py`, `export.py`, `collaboration.py:366–371`, ...) with three different 403 message wordings ("Permission denied" / "You do not have permission…" / "You do not have access…").
**Suggested fix:** One `app/services/access.py` with `require_document(db, user, id, roles)` / `require_project(...)` returning the entity; reuse everywhere for consistent messages.

### M14. MEDIUM — Dead schemas and a dead request field

Defined and re-exported but referenced by **zero** routes/services/tests:
- `ExportResponse` — `schemas/models.py:545–553`
- `PaperCreate` — `:141–152` (only re-exported in `schemas/__init__.py:15,44`)
- `CitationResponse` — `:258–269` (superseded by `CitationDetailResponse`)
- `MembershipResponse` — `:68–75`, `OwnerResponse` — `:59–64`

Dead field: `ExportRequest.include_source_footnotes` (`models.py:542`) is accepted by `POST /documents/{id}/export` (`export.py:52–54` forwards only four of five fields) and never read anywhere in the export pipeline.
**Suggested fix:** Delete the five dead models (or wire them up), remove `include_source_footnotes` or implement it; keep `TokenData` (used by `services/auth.py:122`).

### M15. MEDIUM — Complexity hotspots (C901), worst offenders

| Score | Function | Location |
|---|---|---|
| 38 | `format_authors_bibliography` (+ nested `format_single`=11, 26 branches) | `core/text_utils.py:81–191, 88` |
| 29 | `export_to_docx` (29 branches) | `services/export/docx_exporter.py:25–222` |
| 26 | `export_to_pdf` (26 branches) | `services/export/pdf_exporter.py:77–319` |
| 24 | `export_to_markdown` (23 branches) | `services/export/markdown_exporter.py:18–122` |
| 22 | `parse_tiptap_node` (21 branches) | `services/export/ast_parser.py:71–144` |
| 22 | `format_bibliography_entry` (22 branches) | `services/export/csl_formatter.py:33–210` |
| 22 | `_extract_metadata_from_text` (23 branches) | `services/pdf_extractor.py:423–528` |
| 21 | `hybrid_search` (21 branches, 8 args) | `services/rag_service.py:332–470` |
| 20 | `build_project_graph` (19 branches) | `services/graph_service.py:37–185` |
| 21 | `_parse_tei_xml` (20 branches) | `services/pdf_extractor.py:163–283` |
| 18 | `upload_paper` | `endpoints/papers.py:58–190` |
| 17 | `websocket_collaboration` (17 branches) | `endpoints/collaboration.py:227–354` |
| 16 | `import_bibtex` | `endpoints/citations.py:318–413` |
| 16 | `rank_citations_for_context` (16 branches) | `endpoints/citations.py:470–545` |
| 16 | `import_csl_or_api_data` | `services/zotero_service.py:34–159` |
| 16 | `review_paper` | `services/intelligence_service.py:503–678` |
| 15 | `_segment_sections` | `services/pdf_extractor.py:530–621` |
| 13–12 | `serialize_paper_to_bibtex`, `search_crossref`, `discover_related_work`, `extract_inline_text`, `parse_document_blocks`, `_stream_ollama`, `setup`, `generate_ai_edit`, `verify_claims`, `_authenticate_websocket`, `stream_chat_response` | see sweep output |

The giant `if style == ...` chains (`text_utils.py:101–191`, `csl_formatter.py:46–210`, `format_inline_marker:207–236`) beg for a **strategy registry**: `STYLE_FORMATTERS: dict[str, Callable[..., str]]`.
**Suggested fix:** Refactor top 6 first; extract per-block renderers in the exporters (`_render_heading/_render_table`), and per-style author formatters.

### M16. MEDIUM — Too-many-positional/total arguments (PLR0913 ×18, PLR0917 ×17)

Representative: `research.search_online_literature` (8 args, `research.py:17`), `rag_service.hybrid_search` (8, `rag_service.py:332`), `ExportService.export_document` (8, `export/service.py:20–29`), `export_document_get` (7, `export.py:72`), all three exporter functions (7 each), `LiteratureSearchService.search` (7, `literature_search_service.py:57`) and its four per-provider methods (6 each), `chat` generators (7 each, `rag_service.py:499,587`), `list_papers` (6, `papers.py:214`), `comments._check_doc_access` (6, `comments.py:54`). Note the exporters already accept an `ExportOptions` dataclass but keep both channels (`options=None` plus 6 individual params) — pick one (see also `markdown_exporter.py:25–31` re-assignment dance repeated in `docx_exporter.py:35–38`, `pdf_exporter.py:87–90`).
**Suggested fix:** Make `ExportOptions` mandatory internally; bundle retrieval params into a `SearchQuery` schema.

### M17. MEDIUM — `raise ... from` omitted in `except` blocks (B904 ×11)

- `endpoints/auth.py:102` (`raise credentials_exception` inside `except Exception`)
- `endpoints/export.py:56`, `:109`
- `endpoints/papers.py:114`, `:137`
- `endpoints/plugins.py:51`, `:78`
- `endpoints/provider_settings.py:82`, `:97`, `:124`
- `services/provider_settings.py:86` (`except (TypeError, ValueError): raise ValueError(...)`)

**Fix:** append `from exc` (or `from None` where context is deliberately hidden, e.g. auth refresh).

### M18. MEDIUM — Inconsistent logging argument style (G004 ×7 vs %-style majority)

f-string loggers: `core/middleware.py:41,57`; `services/pdf_extractor.py:131,158,339`; `services/rag_service.py:329`; `services/zotero_service.py:49`. Everything else (majority, e.g. `llm_service.py`, `graph_service.py`, `identifier_resolver.py`) correctly passes `%s` args lazily.
**Fix:** Convert the seven to lazy `%` formatting; optionally enable `G` in ruff to lock it in.

### M19. MEDIUM — Overbroad exception tuple and aliased TimeoutError

`apps/api/app/api/v1/endpoints/collaboration.py:179`:
```python
except (asyncio.TimeoutError, WebSocketDisconnect, json.JSONDecodeError, Exception):
```
Including `Exception` makes the first three redundant (and catches everything including programming errors); `asyncio.TimeoutError` is an alias of builtin `TimeoutError` on py311 (UP041). Also `except Exception: pass` swallow-patterns at `:113–114`, `:145–146`, `:152–154`, `:353–354` lack debug-level logging, making relay/broadcast failures invisible.
**Fix:** Catch `(TimeoutError, WebSocketDisconnect, json.JSONDecodeError)` explicitly; log swallowed send failures at DEBUG once.

### M20. MEDIUM — Closures capture loop variables (B023 ×6)

`apps/api/app/services/intelligence_service.py:421–438` — `make_cell(keywords)` closes over loop variables `chunks` and `paper`:
```python
for paper in papers:
    ...
    def make_cell(keywords: List[str]) -> LitMatrixCellSchema:
        value, page_number, section = self._first_matching_sentence(chunks, keywords)
        ... paper.id ... paper.title ...
```
Safe today only because `make_cell` is invoked synchronously within the same iteration (`:441–443`); storing or threading it would silently bind the last paper.
**Fix:** Pass `chunks`/`paper` as parameters, or define the helper outside the loop taking `(paper, chunks, keywords)`.

### M21. MEDIUM — All literature-provider cache metrics mislabeled as "OpenAlex"

`apps/api/app/services/literature_search_service.py:110–121` hardcodes `provider_name="OpenAlex"` in `_cache_get`/`_cache_set`, which every provider path (`search_crossref`, `search_arxiv`, `search_semantic_scholar`) then uses. Consequently `ProviderCacheService` hit/miss/request counters (`provider_cache_service.py:76–99`) attribute Crossref/arXiv/Semantic-Scholar traffic to OpenAlex, skewing the quota dashboard surfaced by `/system/provider-status`.
**Fix:** Thread the real `PROVIDER_NAMES[key]` label through `_dispatch`.

### M22. MEDIUM — Mutable-looking defaults & inconsistent default construction in schemas

Pydantic safely deep-copies defaults, but the file mixes idioms:
- `PluginHookExecuteRequest.payload: Dict[str, Any] = {}` (`models.py:988`) and numerous `List[...] = []` defaults (`:241,292,320,385,457,503,512–513,527,530,619–621,665,1003,1022`) versus
- `GraphNode.metadata: Dict[str, Any] = Field(default_factory=dict)` (`:905`) — the only `default_factory` usage.

**Fix:** Standardize on `Field(default_factory=list/dict)` for mutable defaults.

---

### LOW-severity findings

**L1.** Leading blank line at top of `apps/api/app/api/v1/endpoints/chat.py:1` (file begins with an empty line before `import json`) — cosmetic; remove.

**L2.** Constant placed mid-file: `UPLOAD_CHUNK_SIZE_BYTES = 1024 * 1024` sits *below* `get_upload_dir` (`papers.py:45–52`) instead of with the other module constants; also `1024*1024` recomputed inline at `papers.py:88` and in `PDFValidator` (`pdf_extractor.py:73,96`) — define one `BYTES_PER_MB`.

**L3.** `models/plugin.py` omits `from __future__ import annotations` while every sibling model file has it (`user.py:1`, `project.py:1`, etc.) — harmless (no forward refs) but inconsistent.

**L4.** `STOP_WORDS` (`core/constants.py:5–193`) conflates grammatical stop words with domain terms (`"paper","study","model","results","performance"...` at `:180–192`) and has no type annotation (`STOP_WORDS: frozenset[str]` would document mutability intent). Module docstring is a bare one-liner.

**L5.** Return-style nits (mechanical): `return None` as sole return in DELETE handlers — `citations.py:234`, `comments.py:216`, `documents.py:145`, `papers.py:340,465`, `projects.py:117`, `teams.py:166,296`, `provider_settings.py:322`; unnecessary assignment-before-return — `chat.py:67`, `documents.py:74`, `papers.py:245,369`, `projects.py:55,66`, `version_history.py:79`, `ai_writing_service.py:297`, `auth.py:44`, `pdf_extractor.py:139`; superfluous `elif/else` after return ×10 (`config.py:53`, `text_utils.py:49,72,209`, `export.py:65,118`, `service.py:51`, `identifier_resolver.py:65`, `provider_cache_service.py:79`, `csl_formatter.py:54`).

**L6.** Identical `if` arms — `text_utils.py:218–221` (`ieee` and `acm/cse/gbt7714` both `f"[{index}]"`; SIM114 suggests merging). Yoda condition in `tests/test_pdf_extractor.py:76` (SIM300). Unnecessary dict comprehension — `teams.py:73` `count_map = {owner_id: count for owner_id, count in counts_query}` → `dict(counts_query)`.

**L7.** `zip()` without `strict=` — `rag_service.py:95` (`zip(v1, v2)` in `cosine_similarity`); lengths are guarded just above, so `strict=True` would encode the invariant.

**L8.** Unused loop variable — `pdf_extractor.py:343` `for line_idx, line in enumerate(lines):` (`line_idx` never used; drop `enumerate`).

**L9.** Nested collapsible `if`s — `pdf_extractor.py:83–87` (`if not head.startswith(b"%PDF-"):` wrapping `if b"%PDF-" not in head[:1024]:`).

**L10.** `subprocess.run` without explicit `check=` — `tabby_setup_service.py:69` (`_read_version` intentionally tolerates failure; pass `check=False` explicitly to document intent).

**L11.** Redundant guard — `papers.py:58` docstring claims "never loads full body in memory" while `_save_and_chunk` writes via buffered chunks (accurate), but `citations.py:455,493` use `list(set([...]))`/`set([w.lower() ...])` where set comprehensions are cleaner (`{c.paper_id ...}`, `{w.lower() ...}`).

**L12.** Magic-number inventory (PLR2004 ×517; representative production sites):
- `text_utils.py:121–170` — style thresholds `<=6, <=10, <=3, <=20, [:19], [...:-1]`.
- `rag_service.py:146,153,181,204` — chunk sizes `1000/600/30/20`; `:404–415` scoring weights `0.68/0.55/0.45/0.85`; `:840` snippet cap `180`; `EMBEDDING_DIM=128` is properly named (`:30`) — follow that pattern for the rest.
- `citations.py:335–343` — `2_000_000`, `500`; ranking weights `30/15/20/10/5/10/3/1` (`:504–527`).
- `ai_writing_service.py:83–84` — `48/160` tokens, `3.0/6.0` s timeouts; `:100` `len>5`; `:434` `len(sections)*650`.
- `provider_cache_service.py:161` — `monthly_quota * 0.8` warning threshold.
- `middleware.py:30` — `[:64]` request-ID cap; `papers.py:286` — `step_index=4`.
- `collaboration.py:34–37` — good counter-example (named `WS_*` constants).

**L13.** Single-letter loop variables beyond `l`: `a`, `p`, `c`, `t`, `q`, `e`, `r` pervade comprehension-heavy modules (`text_utils.py:40,62,88,115`; `citations.py:56–66,137,493–500`; `rag_service.py:79`; `graph_service.py:81`; `identifier_resolver.py:91–100`). Acceptable in tight comprehensions per team taste; flagging for consistency since surrounding code sometimes spells names out.

**L14.** `IdentifierResolver.resolve` (`identifier_resolver.py:56–70`) if/elif dispatch on `detected_type` ending in a duplicated `resolve_doi` fallback branch — replace with a dict dispatch `{type: resolver}` + `.get(default)`.

**L15.** Inline 15-key fallback dict duplicating the extractor's return contract — `papers.py:145–161` hand-builds the "honest minimal record". A `TypedDict`/dataclass for the extraction payload (shared by `pdf_extractor.py` returns at `:274–283,404–421,721–738`) would prevent key drift (note `source` key present in extractor dicts but absent in the fallback, and `confidence_score: None` vs numeric).

**L16.** Header casing nit: `middleware.py:38` emits `X-Response-Time-MS` (nonstandard `MS` suffix capitalization vs conventional `-Ms`); also uses `time.time()` for latency while `rate_limit.py:34` correctly uses `time.monotonic()` — prefer monotonic for durations.

**L17.** `SlidingWindowRateLimiter._hits` (`rate_limit.py:29,45`) never evicts empty deques for inactive keys — unbounded growth keyed by client IP in long-lived processes. Add periodic sweep or evict-on-empty in `check`.

**L18.** `auth.py:118–124` — endpoint-module `__all__` exporting `get_client_ip` re-export is unusual for an HTTP layer module; move the re-export to `core/rate_limit.py` consumers instead.

**L19.** `main.py:36` logs `%d tables` stamp decision at INFO with no environment tag; startup logs otherwise namespaced — minor consistency.

**L20.** `provider_settings.clear_runtime_cache()` (`provider_settings.py:320–322`) is a documented no-op stub whose only caller is a test asserting `is None` (`test_llm_provider_paths.py:111`) — either implement or delete.

**L21.** `AutocompleteSettingsResponse(AutocompleteSettings): pass` (`models.py:476–477`) — empty subclass adds nothing; use the base directly.

**L22.** `generate_tabby(max_tokens=...)` parameter is accepted but ignored (`llm_service.py:169–212`; documented in docstring — good honesty, but an unused-parameter smell; consider `del max_tokens` marker or removing from signature and updating callers `ai_writing_service.py:80–87`).

**L23.** Test engine duplication: `tests/test_models_and_auth.py:13–27` creates its own in-memory engine/sessionmaker/fixture although `conftest.py:19–21` already provides exactly that infrastructure (`test_engine`/`TestingSessionLocal`/`db` fixture).

**L24.** Coverage-chasing test filenames (`test_cov_*.py`, `*_coverage.py`, phase-sweep files grouping unrelated subjects — e.g. `test_cov_final_sweep.py` spans config, DB, middleware, main, exporters) hurt discoverability; prefer subject-named modules. Also ~90 `SLF001` private accesses in tests (`provider_cache_service._cache`, `_provider_stats`, `_redis_client`; `http_client_module._async_client`; `tabby_setup_service._read_version`; `pdf_extractor` privates ×30+) — acceptable for now but brittle; a few public test seams would cut most of them.

**L25.** Quoting outliers: single-quoted string in `tests/test_plugin_runtime_and_builtins.py:260` (Q000); otherwise double-quote discipline is excellent repo-wide (only Q003/Q000 hits listed above).

**L26.** `Alembic/env.py:7` — side-effect import placed after settings imports with inline justification comment (good), but `import app.models` violates alphabetical/isort grouping it otherwise follows; harmless.

**L27.** `graph_service.build_project_graph` builds `edges` list allowing duplicate co-authored edges when the same author string appears twice in one paper's authors (`graph_service.py:77–98` has no seen-set) — style-level robustness nit adjacent to the dedup logic used for topics.

---

### INFO observations

**I1.** `ERA001` hits (`tests/test_cov_services_final.py:36`, `tests/test_phase7_export.py:57,65`, `services/export/pdf_exporter.py:60`) are **false positives**: they're section-banner comments (`# Chicago (Author-Date)`) and a trailing `# Center` note, not commented-out code. If `ERA` is adopted, configure `pyproject` ignore-paths or reword those comments.

**I2.** `B008` (Depends in defaults) is correctly ignored for FastAPI DI — the 171 occurrences are the framework idiom; `File(...)` at `papers.py:61` likewise.

**I3.** Zero `TODO`/`FIXME`/`XXX`/`HACK` markers and zero `print(` statements and zero `# type: ignore` in the entire backend — unusually clean debt profile.

**I4.** `PLW0603 global` ×9 is confined to `core/http_client.py` singleton management (`:45,61,83,103`) — a legitimate, well-commented pattern for module-level client pools; consider a small `_ClientHolder` class to silence future PL noise without behavior change.

**I5.** Secrets hygiene in style terms: `provider_settings.mask_key` masks keys in every response, and `KNOWN_COMPROMISED_DEFAULT_SECRETS` guard in `config.py:9–13,94–104` is exemplary defensive configuration.

---

## Positive Observations

1. **Clean project-config lint gate.** `ruff check apps/api` (E,F,W,I) passes with zero findings — imports are fully sorted (`I`), no unused imports/variables (`F`), no pycodestyle warnings.
2. **Uniform modern SQLAlchemy 2.0 modeling.** All 12 models use `Mapped[...]`/`mapped_column`, timezone-aware `datetime.now(timezone.utc)` lambdas, `TYPE_CHECKING` guards against circular imports, explicit cascade rules, and named unique constraints (`document.py`, `version.py:32–34`).
3. **Consistent SCREAMING_SNAKE_CASE module constants** where they exist: `HTTP_LIMITS`, `DEFAULT_TIMEOUT`, `WS_AUTH_TIMEOUT_SECONDS`, `EMBEDDING_DIM`, `SEARCH_TIMEOUT_SECONDS`, `HOOK_REGISTRY`, `TABBY_RELEASES_URL`.
4. **Disciplined logging namespace** (`openresearch.<component>` for every logger) and predominantly lazy `%`-style arguments.
5. **Pydantic v2 idioms used correctly and consistently** (`field_validator`+`@classmethod`, `model_validator(mode="after")`, `ConfigDict(from_attributes=True)`), including a genuinely strong production-secret validator (`config.py:90–110`).
6. **Excellent module-contract docstrings** in the hardest modules: `llm_service.py:1–15` (provider order + honest-failure semantics), `plugin_runtime.py:1–7` (security allowlist), `tabby_setup_service.py:1–13` (no shell interpolation guarantee), `rate_limit.py:1–7` (single-worker caveat).
7. **Hermetic test suite scaffolding**: `conftest.py` isolates Redis, resets all rate limiters, redirects the API-key store to `tmp_path`, and gives each test a fresh event loop — textbook hygiene.
8. **Descriptive snake_case naming throughout** — no abbreviations (`usr_repo`-style), no camelCase leakage, functions verb-phrased (`resolve_identifier`, `verify_user_access_to_owner`), boolean-y predicates (`is_stale`, `port_occupied`).
9. **Absolute imports exclusively** — zero relative imports anywhere, matching the skill's preference.
10. **Security-conscious styling in hot paths**: sanitized request IDs (`middleware.py:18,30`), filename sanitization (`pdf_extractor.py:105–111`), bounded streaming uploads with partial-file cleanup (`papers.py:101–130`), fixed-argument subprocess lists (`tabby_setup_service.py:12`).
11. **Alembic migrations written defensively**: batch operations for SQLite, data-repair pass before adding the uniqueness constraint (`c4d9f2b8a7e1_document_versions_unique_number.py:22–53`).

---

## Prioritized Recommendations

**P1 — Restore enforcement teeth (highest ROI, lowest effort).**
Set `line-length = 120`; add `[tool.ruff.format]`; extend `select` to `["E","W","F","I","B","C4","SIM","UP","G","RET"]` (keep `B008` ignore; add narrow per-file ignores); remove `E501`/`E741` ignores and fix the ~74 long lines + rename `l`. Drop `alembic` from `exclude` and format the four migration files (fixes M1/M2/H1/H2/L5-class items mechanically). Tighten mypy to `disallow_untyped_defs` for `app/**` with a tests override.

**P2 — Kill duplication with divergent behavior.**
Merge the two BibTeX serializers behind one escaping implementation (H3); extract the shared `_check_doc_access`/`_check_project_access` into one authorization helper module and adopt it in all ~30 hand-rolled sites (M13); collapse the three exporter option-plumbing dances onto a mandatory `ExportOptions` (M16).

**P3 — Fix the correctness-adjacent style defects.**
Replace `hash(title)` ID with BLAKE2b/uuid (H5); repair `\\\"` quoting in `csl_processor` (H4); promote `RAGService.grounded_answer`/`ProviderCacheService` ping to public APIs (H6); qualify `remote_side` (M3); thread real provider labels into cache metrics (M21).

**P4 — Type the vocabulary.**
Introduce `Enum`/`Literal` for roles, modes, statuses, styles, engines, grounding states (M4/M5); replace bare-`str` schema fields; deduplicate the two role validators. This simultaneously shrinks the 517-hit magic-number surface for status comparisons.

**P5 — Decompose the giants.**
Refactor the six C901-worst functions with strategy tables/dispatch (`STYLE_FORMATTERS`, per-block exporter renderers, `_extract_metadata_from_text` split) and convert 8-arg service signatures to parameter objects (M15/M16).

**P6 — Split the schema monolith and prune the dead.**
Break `schemas/models.py` into phase-free domain modules; delete `ExportResponse`, `PaperCreate`, `CitationResponse`, `OwnerResponse`, `MembershipResponse`, and `include_source_footnotes` (or implement) (M10/M14).

**P7 — Documentation pass.**
Add module docstrings to all endpoint/model/core modules; add Args/Returns/Raises to endpoint handlers and `get_db`/`lifespan`/`root`; standardize Google style with summary-first-line (M9/M12).

**P8 — Mechanical hygiene sweep.**
Batch-fix B904 (`from exc`), G004 (lazy %), PLC0415 (hoist imports; especially the two inner `import logging`), RET/SIM/C4/B905/B007 nits, `chat.py:1` blank line, `papers.py` constant placement, and `strict=True` zip (M7/M17/M18/M6/L-series).

**P9 — Tests.**
Adopt conftest fixtures in `test_models_and_auth.py`; gradually wrap private-state assertions behind small public helpers to retire the ~90 SLF001 accesses; split `test_cov_*` grab-bags by subject (M23-adjacent, L23/L24).

---

*End of report. This audit was strictly read-only; no repository files were created, modified, or reformatted.*
