# Refactor-Clean Audit - OpenResearch Monorepo

**Audit type:** READ-ONLY refactoring-opportunity audit (skill `refactor-clean`, applied audit-only; no files modified)
**Date:** 2026-08-26
**Repo:** `C:\Users\moham\Pictures\OpenResearch`

---

## Scope & Methodology

**In scope**
- Backend: `apps/api/app/**` (services, api routers, schemas, plugins, core, models)
- Frontend: `apps/web/src/**` (contexts, components, lib/api)
- Shared packages: `packages/{ai,citations,editor,plugins,research,tokens,ui}`
- Test doubles in `apps/api/tests/**` (as duplication evidence only)

**Ignored per instructions:** `node_modules`, `.venv`, `.next`, `__pycache__`, `coverage`, caches, `storage/`, `logs/`, dist output.

**Method**
1. Full recursive line census of `apps/api/app/**/*.py` and `apps/web/src/**/*.ts(x)` plus `packages/**/*.{ts,tsx}` using blank-inclusive `(Get-Content).Count`. (Note: `Measure-Object -Line` undercounts because it skips blank lines; all counts below are blank-inclusive.)
2. Signal-by-signal hunt per refactor-clean: duplicated concepts, local adapters, obsolete owners, compatibility wrappers, parallel abstractions, over-large modules, just-tacked-on pressure.
3. Cross-language copy-paste family detection via targeted searches (author parsing, BibTeX, DOI normalization, access checks, provider fakes, error envelopes).
4. Manual read of every flagged site to confirm duplication level and find drift between copies.
5. Line-precise evidence (`file:line`) recorded for every finding; effort sized S (<0.5d) / M (0.5-2d) / L (>2d).
6. All counts and excerpts verified by direct file reads; ASCII-only output enforced in this report after a first-pass encoding mishandling (this document is plain ASCII by design).

---

## Executive Summary

The codebase is functionally healthy but carries a distinct sediment layer concentrated in four themes:

1. **Citation/bibliography logic has no single owner.** Author-name splitting exists in **7 copies across two languages** (one copy semantically diverged - PubMed parses family-name-first while arXiv/literature-search parse family-name-last). BibTeX **serialization exists in 3 copies**, one of which lacks character escaping its sibling has - an active correctness drift producing corrupt `.bib` from one path and valid `.bib` from another for the same paper. BibTeX **parsing exists in 2 copies** with unequal robustness (balanced-brace scanner vs naive regex that breaks on nested braces). Citation-key generation x3.
2. **Two dead parallel abstractions live in packages/.** `packages/research` is an entire provider stack (4 providers + registry + cache) of hardcoded empty-result stubs with **zero consumers** anywhere in the monorepo (its package.json name is literally `"n"`). `packages/ai`'s `LLMProviderRegistry` is likewise never instantiated - the web app imports only its types while the real provider chain lives in Python `llm_service.py`. Meanwhile prompt text (`EDIT_ACTION_INSTRUCTIONS`) is verbatim-duplicated between TS and Python.
3. **Routers own business logic they should delegate.** `citations.py` embeds a full BibTeX parser and serializer; `papers.py` embeds upload orchestration and RAG Q&A orchestration, reaching into the private `rag_service._llm_grounded_answer`; access-check helpers are copy-pasted 5 times (`_check_project_access` x3, `_check_doc_access` x2 byte-identical) plus ~12 inline 403 blocks.
4. **One god-context and one god-schema anchor the size outliers.** `WorkspaceContext.tsx` (709 lines) fuses navigation, 13 modal states (13 separate `useState` hooks + open/close callbacks = ~120 lines of pure boilerplate), shell panels, theme/density, AI quota settings, and two AI request flows. `schemas/models.py` (1,027 lines, 105 Pydantic classes) is every domain's schema home at once.

Highest-value moves in order: (a) one `authors.py` + one BibTeX owner in the backend, deleting the router copies (fixes the live escaping divergence); (b) delete or quarantine the stub packages; (c) hoist `_check_project_access`/`_check_doc_access` into `services/auth.py`; (d) split `schemas/models.py` along domain seams; (e) collapse WorkspaceContext modals into a single reducer. All are low-risk mechanical moves except the schema split (import churn) and the modal reducer (state-shape change).

---

## Signal-by-Signal Findings

### Signal 1 - DUPLICATED CONCEPTS

#### 1.1 Author-name parsing/splitting - 7 copies, 2 languages - HIGH

| # | Location | Form | Notes |
|---|----------|------|-------|
| 1 | `apps/api/app/services/literature_search_service.py:22-26` | `_split_author_name()` -> `{familyName: last part, givenName: rest, literal}` | Cleanest backend copy |
| 2 | `apps/api/app/services/identifier_resolver.py:196-199` | Inline in arXiv XML loop | Identical semantics to #1 |
| 3 | `apps/api/app/services/identifier_resolver.py:260-263` | Inline in PubMed loop | **DIVERGED:** `fam = parts[0]` (family-first). Correct for PubMed `"Last FM"` format but undocumented - reads as a copy-paste bug sitting next to #2 |
| 4 | `apps/api/app/plugins/csl_processor.py:33-35` | `_initial()` splits raw string | Style formatter re-derives structure from strings |
| 5 | `apps/api/app/plugins/csl_processor.py:75, 102, 114` | Three MORE inline `.split()` sequences in `_ieee`, `_vancouver`, `_mla` | Same file contains 4 independent splitters |
| 6 | `apps/api/app/api/v1/endpoints/citations.py:361-371` | BibTeX-import author splitting (`" and "` split + comma branch) | Lives in a **router**, not a service |
| 7 | `packages/citations/src/bibtex.ts:29-60` | `parseBibtexAuthors()` | TS twin of #6 with brace-stripping |

Additionally `app/core/text_utils.py:42, 64, 93-95` re-implements the same "familyName || literal || name fallback" accessor three times across `format_authors_summary` / `format_authors_inline` / `format_authors_bibliography`.

- **Duplication estimate:** ~120 LOC; 7 owners of one concept.
- **Drift already visible:** copy #3 silently inverts convention without a comment; copies #6/#7 strip `{...}` braces while #1/#2 never handle them.
- **Target architecture:** new `app/core/authors.py` owning `split_full_name(name, family_first=False) -> dict`, `parse_bibtex_author_field(str) -> list[dict]`, `author_display_name(author_dict) -> str`, `format_initials(...)`. `csl_processor.py` consumes structured authors instead of re-splitting strings; `packages/citations/src/bibtex.ts` stays as the TS-side owner at the process boundary.
- **Effort:** M. **Risk:** LOW-MEDIUM - pin both name conventions with unit tests before merging (the PubMed inversion must survive).

#### 1.2 BibTeX serializers - 3 copies, live behavioral drift - CRITICAL

| Copy | Location | Escapes specials? |
|------|----------|-------------------|
| A | `packages/citations/src/bibtex.ts:233-260` `formatBibtexEntry` | n/a (TS runtime) |
| B | `apps/api/app/services/export/bibtex_exporter.py:13-65` `serialize_paper_bibtex` | **NO** - raw field interpolation |
| C | `apps/api/app/api/v1/endpoints/citations.py:34-105` `_bibtex_escape` + `serialize_paper_to_bibtex` | **YES** - escapes backslash, `{ } & % # _` citing "Balance protection" |

Copies B and C are ~90% line-identical (same author join, same key derivation, same field order, same arXiv eprint handling) except C escapes and B does not. A title containing `{`, `}`, `&`, `%`, or `#` yields structurally corrupt `.bib` from the export engine path (`services/export/`) but valid `.bib` from the citations endpoint. This is exactly the failure mode refactor-clean warns about: two implementations that must agree silently drift.

- **LOC estimate:** ~55 lines x 3 = ~165 LOC, ~110 deletable.
- **Target architecture:** `services/export/bibtex_exporter.py` becomes the single Python serializer (absorb `_bibtex_escape`); `endpoints/citations.py` imports it; regression test asserts byte-equal output from `/documents/{id}/export/bibtex` and the export-engine path for a hostile-title paper.
- **Effort:** S. **Risk:** LOW (behavior strictly improves; pinned by test).

#### 1.3 BibTeX parsers - 2 copies, unequal robustness - HIGH

| Copy | Location | Field extraction |
|------|----------|------------------|
| A | `packages/citations/src/bibtex.ts:80-145,150-228` `extractBibtexFields`/`parseBibtex` | Balanced-brace scanner, quote-aware, escape-aware |
| B | `apps/api/app/api/v1/endpoints/citations.py:338-355` `import_bibtex` | Naive regex `\{([^}]*)\}` - breaks on nested braces (e.g. `title = {The {LaTeX} Companion}` truncates), no escape handling |

Same entry-header regex idea, same field aliasing (`journal||journaltitle`, `number||issue`, `publisher||institution||school`), same arXiv eprint rule - one concept implemented twice, Python copy weaker. Also enforces limits inline (500 entries / 2 MB) that belong in the service.

- **LOC estimate:** ~100 duplicated-equivalent LOC.
- **Target architecture:** `app/services/citation_import.py` owning a balanced-brace extractor (port of the TS scanner); router shrinks to auth + limits + persistence.
- **Effort:** M. **Risk:** LOW-MEDIUM (parser swap changes acceptance edge cases; golden-file tests recommended).

#### 1.4 Citation-key generation - 3 copies - MEDIUM

- `packages/citations/src/bibtex.ts:12-23` `generateCitationKey`
- `apps/api/app/services/export/bibtex_exporter.py:30-36` inline
- `apps/api/app/api/v1/endpoints/citations.py:69-76` inline

All compute `firstAuthorClean + year + firstTitleWord`. Drift: Python copies default missing year to **2023**, TS uses current year; TS strips leading articles (`the/a/an`), Python copies do not.

- **Target:** single `make_citation_key(paper)` in `bibtex_exporter.py`; align TS deliberately or document divergence.
- **Effort:** S. **Risk:** LOW.

#### 1.5 Access-check helpers - 5 helper copies + ~12 inline blocks - HIGH

| Helper | Copies |
|--------|--------|
| `_check_project_access(db, user, project_id, required_roles=None)` | `endpoints/intelligence.py:25-33`, `endpoints/graphs.py:19-25`, `endpoints/zotero.py:21-32` - near-identical bodies; graphs lacks the `required_roles` parameter entirely; 403 detail strings differ ("modify Zotero references..." vs "do not have access") |
| `_check_doc_access(db, user, document_id, required_roles=None)` | `endpoints/comments.py:22-32` and `endpoints/version_history.py:52-61` - **byte-for-byte identical** |
| Inline closure `_verify_access()` | `endpoints/papers.py:74-86` (run via `anyio.to_thread.run_sync`) |
| Inline 403 pattern | `citations.py:125,177,230,266,330,428,452,487`; `export.py:35,89`; `collaboration.py:371`; role matrix re-querying membership 7 times in `teams.py:100-280` |

Every copy reduces to: load entity -> 404 if missing -> `verify_user_access_to_owner(...)` -> 403.

- **LOC estimate:** ~150 LOC of repetition; the real cost is policy divergence (graphs cannot express editor-required routes).
- **Target architecture:** promote to `services/auth.py` as `require_project(db, user, project_id, roles=None) -> Project` and `require_document(db, user, document_id, roles=None) -> Document`, dependency-injectable. Routers consume; teams keeps its richer role matrix but reuses the underlying check.
- **Effort:** S-M (mechanical, many call sites). **Risk:** LOW.

#### 1.6 AI-edit action instructions - verbatim cross-language duplicate - HIGH (drift-critical)

- `packages/ai/src/providers/shared.ts:3-14` `EDIT_ACTION_INSTRUCTIONS` (9 actions: clarity, academic, simplify, shorten, expand, grammar, flow, translate, explain)
- `apps/api/app/services/ai_writing_service.py:51+` - **same nine instruction strings word-for-word**

Only Python serves traffic (backend proxies LLM calls); the TS registry consuming its copy is dead code (finding 5.1). Any future prompt tuning rots the other side silently.

- **Target:** Python owns prompts (it executes them). Delete the TS copy together with the dead providers, keeping types only. If TS providers are ever revived, prompts must arrive via API contract, not a second copy.
- **Effort:** S (folds into 5.1). **Risk:** LOW.

#### 1.7 DOI prefix stripping - 3 copies - MEDIUM

- `apps/api/app/plugins/crossref_provider.py:5` `_DOI_PREFIXES` (5 prefixes incl. `doi:`)
- `apps/api/app/services/literature_search_service.py:29-34` `_clean_doi` (regex, strips only doi.org hosts)
- `apps/api/app/services/identifier_resolver.py` (~lines 60-75) startswith-based normalizer (`doi:` + doi.org)

Three different prefix sets for the same normalization; a DOI pasted as `https://dx.doi.org/10.xxx` cleans differently depending on which path sees it first.

- **Target:** one `normalize_doi(raw) -> str` in `core/text_utils.py` (or new `core/identifiers.py`); plugin and services consume.
- **Effort:** S. **Risk:** LOW.

#### 1.8 arXiv ID extraction grammar - 2 homes - LOW

- `apps/api/app/plugins/arxiv_provider.py:5-7` (`_ARXIV_NEW_STYLE`, `_ARXIV_ABS_URL`, category regex)
- `apps/api/app/services/identifier_resolver.py` (arXiv id cleaning + abs/pdf URL forms)

Fold into `core/identifiers.py` alongside `normalize_doi`.
- **Effort:** S. **Risk:** LOW.

#### 1.9 Frontend bibliography machinery duplicated across two components, canonical adapter bypassed - HIGH

Byte-comparable duplicates:

| Block | CitationsManager.tsx | SourcePanel.tsx |
|-------|---------------------|-----------------|
| `citedReferences` useMemo (dedupe citation paperIds -> map papers -> `BibliographicReference`) | :51-78 | :63-90 (**identical 28 lines**) |
| `formattedBibliography` useMemo (`generateBibliography(...)`) | :82-84 | :92-94 (identical) |
| `handleCopyAll` / `handleCopySingle` clipboard + 2s timeout | :86-98 | :96-108 (**identical**) |
| `styleOptions` - 27-entry style array | :110-137 (labels via `t('citations.styles.*')`) | :110-137 (**hardcoded English labels - already drifted from i18n twin**) |

Meanwhile `apps/web/src/lib/paperToBibRef.ts:4-14` exists as the intended Paper->`BibliographicReference` adapter and **neither component uses it**; both inline a richer mapping instead. `paperToBibRef` itself drops `arxivId/pmid/volume/issue/pages`, so the third copy is also under-built.

- **LOC estimate:** ~110 duplicated lines across the pair + a 14-line orphaned adapter.
- **Target architecture:**
  - Extend `paperToBibRef` to the full mapping; make it the only Paper->Ref converter.
  - Extract `useBibliography()` hook (mapping + formatted bibliography + copy handlers) into `lib/citations/useBibliography.ts`.
  - Extract the 27-entry `STYLE_OPTIONS` into `lib/citations/styles.ts`, labels resolved through i18n at render.
  - Components keep layout only: CitationsManager keeps the library grid; SourcePanel keeps tabs/source card.
- **Effort:** M. **Risk:** LOW (pure extraction).

#### 1.10 Test HTTP doubles re-implemented per file - MEDIUM

- `tests/test_llm_provider_paths.py:9-30`: `FakeClient` + `FakeResponse`
- `tests/test_tabby_autocomplete.py:19-43`: second `FakeClient` + `FakeResponse` pair
- `tests/test_local_mode_and_providers.py:12-20,113-127`: `SimplePostClient` + nested third `FakeResponse`
- `tests/test_cov_services_final.py:67-79,266`: `FakeCursor`/`FakeConn`/`FakeWebSocket`

Four ad-hoc transport fakes where one shared recording fake would do.

- **Target:** `tests/helpers/fakes.py` imported everywhere; behavior overrides via constructor args.
- **Effort:** S. **Risk:** LOW.

---

### Signal 2 - LOCAL ADAPTERS

#### 2.1 `toGroundedPassage` - dual snake/camel compatibility shim - MEDIUM

`apps/web/src/context/WorkspaceContext.tsx:34-55` accepts `GroundedPassage | Record<string, unknown>` and manually coalesces **both** key conventions: `paper_id||paperId`, `paper_title||paperTitle`, `passage_text||passageText`, `page_number||pageNumber`. The backend schema (`app/schemas/models.py:275-288` `GroundedPassage`, returned inside `source_passages`) emits snake_case consistently; the camelCase branch defends against a shape that does not occur in production traffic. Every chat/RAG response passes through this normalizer, taxing all consumers with a phantom general case.

- **Target:** type the API client's RAG/chat responses once (`lib/api/types.ts` mirroring backend field names), map in one place at the fetch boundary; `toGroundedPassage` shrinks to direct assignment or disappears.
- **Effort:** S-M. **Risk:** LOW.

#### 2.2 `export_service.py` - pure re-export facade - LOW (compatibility wrapper)

`apps/api/app/services/export_service.py` (42 lines) is exclusively a re-export of `app.services.export`, self-described "for backward compatibility". Consumers found: `api/v1/endpoints/export.py` and `tests/test_phase7_export.py`. The package itself is already clean per-format modules - the shim adds a second import path to the same objects.

- **Target:** point both consumers at `services.export` and delete the facade (zero-line bridge; no removal condition needed because nothing external depends on the module path).
- **Effort:** S. **Risk:** LOW.

#### 2.3 `AutocompleteSettingsResponse(AutocompleteSettings)` - empty subclass - INFO

`apps/api/app/schemas/models.py:476` subclasses only to add nothing and rename nothing. An alias would do; harmless noise.
- **Effort:** S. **Risk:** LOW.

---

### Signal 3 - OBSOLETE OWNERS

#### 3.1 BibTeX parse + serialize owned by a router - HIGH

`endpoints/citations.py` owns: `_bibtex_escape` (:34-48), `serialize_paper_to_bibtex` (:51-105), a full import parser (:338-355) with author parsing (:361-371) and Paper construction (:381-404). This is domain logic in the HTTP layer - it cannot be reused by `services/export`, which is exactly why copy B exists (finding 1.2). The router should orchestrate: auth -> limits -> call service -> shape response.

- **Target:** `services/citation_import.py` (parse + persist) and reuse `export/bibtex_exporter.serialize_paper_bibtex`; citations.py drops to ~250 lines.
- **Effort:** M. **Risk:** LOW-MEDIUM.

#### 3.2 Upload + RAG-QA orchestration owned by papers router - MEDIUM

- `endpoints/papers.py:55-190`: upload endpoint contains size precheck, filename sanitization call, streaming-to-disk closure (`_stream_to_disk`, ~60 lines), then save-and-chunk closure invoking `rag_service.chunk_paper`. File-storage mechanics belong in a storage/upload service.
- `endpoints/papers.py:471-583`: `ask_paper_ai` builds prompts, selects instructions by prompt_type, orchestrates `rag_service.hybrid_search`, post-processes answers into `AskPaperAIResponse`, and calls **private** `rag_service._llm_grounded_answer` (:549). All Q&A semantics belong behind a public `rag_service.answer_document_question(...)` returning a response DTO.

- **Target:** `services/paper_storage.py` (stream-to-disk + quota checks) and a public `RAGService.answer(...)` method; router keeps request validation + dependency wiring.
- **Effort:** M. **Risk:** LOW (behavior preserved; also fixes private-member access finding 7.2).

#### 3.3 Tabby autostart owned twice - MEDIUM

Two identical owners of the same side effect:

- `apps/api/app/main.py:41-49` `_start_tabby_if_enabled()` - spawns daemon thread at app startup
- `apps/api/app/api/v1/endpoints/provider_settings.py:34-40` `_start_tabby_in_background()` - same body (`start_if_enabled` + `probe_tabby(force=True)` + warning log), invoked after settings updates

Both wrap the identical lambda against `tabby_setup_service`.

- **Target:** single function on `tabby_setup_service` (e.g. `launch_in_background()`); main.py and the settings endpoint both call it.
- **Effort:** S. **Risk:** LOW.

#### 3.4 Inline Pydantic request models in provider_settings router - LOW

`endpoints/provider_settings.py:42-52` defines `ProviderConfigUpdate` / `RateLimitUpdate` inline while every other domain's schemas live in `schemas/models.py`. Move during the schema split (finding 6.A).
- **Effort:** S. **Risk:** LOW.

---

### Signal 4 - COMPATIBILITY WRAPPERS

| Wrapper | Location | Verdict |
|---------|----------|---------|
| `export_service.py` re-export facade | `apps/api/app/services/export_service.py:1-42` ("for backward compatibility") | Delete after retargeting its 2 consumers (finding 2.2) |
| snake/camel dual-key normalizer | `WorkspaceContext.tsx:34-55` | Collapse to single contract (finding 2.1) |
| `AutocompleteSettingsResponse(AutocompleteSettings)` | `schemas/models.py:476` | Alias or merge (finding 2.3) |

No `foo_v2` / `-new` / `legacy_` identifier sediment found anywhere - naming lineage hygiene is good. The only "legacy" string is `plugin_runtime._apply_legacy_tags` (`services/plugin_runtime.py:109-117`), a legitimate name for backfilling old plugin result shapes, though it deserves a removal-condition comment.

---

### Signal 5 - PARALLEL ABSTRACTIONS

#### 5.1 `packages/research` - entire stub stack with zero consumers - HIGH (delete candidate)

- 4 providers (`openalex.ts`, `crossref.ts`, `arxiv.ts`, `semantic_scholar.ts`) each returning hardcoded empty results ("Typed stub for Phase 1", `openalex.ts:11`)
- `ResearchProviderRegistry` (`research/src/index.ts:20-34`), `cache.ts` (74 lines), types - none imported by `apps/web` or any other package (verified repo-wide)
- Real literature search lives entirely in Python `literature_search_service.py` (same four providers over HTTP, cached via `provider_cache_service`)
- `packages/research/package.json` names the package literally `"n"` - placeholder never finished
- Duplicates the *concept* of the backend stack 1:1 (same providers, same quota-status idea)

~700 LOC maintained (with tests covering emptiness) for zero runtime users.

- **Target:** delete the package (or reduce to `SearchOptions`/`SearchResult` types if web will ever need them client-side). Backend remains the single search owner.
- **Effort:** S. **Risk:** LOW (no consumers).

#### 5.2 `packages/ai` provider layer - registry + 3 providers never instantiated - MEDIUM

- `LLMProviderRegistry` (`ai/src/index.ts:17+`), `openai.ts` (125), `ollama.ts` (121), `custom.ts` (124), `shared.ts` outline scaffold - web imports **only types** (`AIEditActionType`, `GroundedPassage`, `GroundingState`) from `@openresearch/ai`
- Actual generation chain is Python-only (`llm_service.py`: configured cloud provider -> Ollama fallback; Tabby separate channel for autocomplete)

Unlike `packages/research`, the types are load-bearing, so the package survives as a types-only module unless client-side LLM calls become real.

- **Target:** strip to `types.ts` (keep `outlineFromScaffold` only if referenced); delete providers/registry/instructions (folding finding 1.6). Refactor-clean's rule: unshipped scaffolding moves to the clean contract now, not later.
- **Effort:** S. **Risk:** LOW (type imports unaffected).

#### 5.3 Two error envelopes, bridged by frontend guesswork - MEDIUM

- FastAPI default envelope `{"detail": ...}` from every `HTTPException` (all routers)
- `core/middleware.py:47-68 GlobalErrorEnvelopeMiddleware` emits `{"error": {code, message, request_id}}` for unhandled exceptions
- Frontend `lib/api/client.ts:16-63 describeErrorDetail` probes `detail` -> top-level object -> `msg/message/error` keys - an adapter compensating for the dual contract

- **Target:** pick one envelope. Cheapest consistent move: keep FastAPI `detail` everywhere and have the middleware emit `{"detail": {"message": ..., "request_id": ...}}`; then `describeErrorDetail` collapses to two lines. Document the contract once in `lib/errors.ts`.
- **Effort:** S-M. **Risk:** LOW-MEDIUM (`client.test.ts` covers this path; update alongside).

#### 5.4 Hash-based embeddings standing in the embedding-interface slot - MEDIUM (honesty/architecture)

`rag_service.py:33-97 EmbeddingService.generate_embedding` is BLAKE2b feature-hashing presented through a semantic-embedding-shaped interface (`generate_embedding`, `cosine_similarity`), persisted into `PaperChunk.embedding`. No model-backed implementation exists anywhere in the repo. Fine as a local-first default, but currently indistinguishable from a real embedder to callers - the symmetric-placeholder trap refactor-clean warns about: quality defects stay invisible until a real embedder lands.

Relatedly, `graph_service.py:256` derives IDs from Python's salted `hash(title)` (`abs(hash(title)) & 0xFFFFFFFF`) - non-deterministic across processes, unlike the deliberate `_stable_hash` next door.

- **Target:** (a) document/rename as `HashEmbeddingService` at the write site; (b) define the seam (`EmbeddingProvider` protocol) so a real backend drops in without touching chunk/search code; (c) replace `abs(hash(title))` with the existing stable hash.
- **Effort:** S for (a)+(c); M for (b). **Risk:** LOW.

#### 5.5 String enums vs Literal unions - MEDIUM

Backend validates closed vocabularies as bare strings plus comments:
- `schemas/models.py:192` `extraction_status: str  # 'ok' | 'unverified'` (also :152,:164,:181,:370,:398,:435)
- `models/paper.py:35` `extraction_status: Mapped[str] = mapped_column(String(50))`
- Citation styles flow as free strings through every layer (27-value list duplicated in two TS components per finding 1.9; style dispatch in `text_utils.py:207-236` silently defaults unknown styles)

The TS side has proper unions (`ExtractionStatus`, `CitationStyle`, `GroundingState` in `packages/citations/src/types.ts`). The vocabularies therefore live in three places - TS unions, Python comments, DB column - with only one enforced.

- **Target:** Python `Literal["ok", "unverified"]` at the Pydantic boundary; single `CITATION_STYLES` tuple exported from `packages/citations` consumed by both frontend copies and mirrored once in Python.
- **Effort:** S-M. **Risk:** LOW (Literal rejects garbage earlier; verify no client sends other values first).

#### 5.6 Async/concurrency idioms - unified, one outlier - INFO->LOW

Dominant idiom is consistent: sync SQLAlchemy work wrapped via `anyio.to_thread.run_sync` (7 sites: `citations.py:269,307`; `collaboration.py:321`; `ai_writing_service.py:172`; `pdf_extractor.py:134`; `papers.py:86,190`), shared pooled clients from `core/http_client.py` (loop-aware async + sync), `asyncio.gather` fan-out in `literature_search_service.py:94`. Outliers:
- `main.py:50-53` raw `threading.Thread(daemon=True)` for Tabby autostart, duplicated in provider_settings endpoint (finding 3.3)
- `llm_service.py:45-46` hand-rolled sliding-window rate limiter under `threading.Lock` - defensible local-first design; flagged for awareness, no action

Not three competing idioms - no action beyond 3.3.

---

### Signal 6 - OVER-LARGE MODULES

All counts blank-inclusive; threshold >400 lines.

#### Backend `apps/api/app/**` (ranked)

| Lines | File | Concepts fused |
|-------|------|----------------|
| 1027 | `schemas/models.py` | 105 Pydantic classes across ~16 domains (Plan A below) |
| 900 | `services/rag_service.py` | EmbeddingService + 4 chunkers + hybrid search + grounded chat + streaming chat (Plan B) |
| 742 | `services/pdf_extractor.py` | Validator + GROBID/TEI parser + pdfplumber extractor + metadata-from-text + sectioner + references + merger/confidence (Plan C) |
| 681 | `services/intelligence_service.py` | 4 independent features: claim verification, research gaps, literature matrix, paper review (Plan D) |
| 593 | `services/llm_service.py` | Provider chain + availability probing + rate limiting + Tabby channel (borderline cohesive) |
| 583 | `api/v1/endpoints/papers.py` | Upload pipeline + CRUD + annotations + PDF streaming + RAG QA (findings 3.2, 7.2) |
| 545 | `api/v1/endpoints/citations.py` | BibTeX serializer + parser + CRUD + identifier resolve + ranking (findings 1.2/1.3/3.1) |
| 532 | `services/literature_search_service.py` | 4 provider adapters + normalization + caching - cohesive, borderline earned size |
| 447 | `services/ai_writing_service.py` | Autocomplete + edit actions (6 rule-based transforms + LLM path) + outline |

#### Frontend `apps/web/src/**` (ranked, >400)

| Lines | File | Notes |
|-------|------|-------|
| 844 | `components/reader/PdfReader.tsx` | PDF.js lifecycle + text layer + annotation overlay + toolbar + zoom/page state (Plan F) |
| 709 | `context/WorkspaceContext.tsx` | god-context (Plan E) |
| 659 | `components/chat/AiResearchChat.tsx` | message list + SSE streaming + source cards + input (Plan G) |
| 589 | `components/views/SettingsView.tsx` | provider forms + autocomplete prefs + appearance + team entry points |
| 540 | `components/intelligence/ResearchGraphView.tsx` | graph rendering + filters + detail panel |
| 524 | `components/library/ResearchLibrary.tsx` | grid + filters + bulk actions |
| 514 | `components/intelligence/LiteratureMatrixView.tsx` | matrix build + cells + export |
| 502 | `context/DocumentContext.tsx` | documents CRUD + autosave + citation state + toast + editor stats |
| 466 | `components/intelligence/ResearchGapAssistantView.tsx` | single-feature view, lower priority |
| 442 | `context/PaperContext.tsx` | papers + annotations + upload progress + Paper type definitions |
| 440 | `components/modals/TeamModal.tsx` | member table + invite + role editing |
| 415 | `components/shell/SourcePanel.tsx` | tabs + source card + bibliography (dup with CitationsManager, finding 1.9) |

#### Packages (>400)

| Lines | File | Notes |
|-------|------|-------|
| 1200 | `editor/src/extensions/extensions.test.ts` | test file - fine |
| 618 / 412 | `citations/src/styles.test.ts`, `bibtex.test.ts` | test files - fine |
| 627 | `editor/src/components/EditorToolbar.tsx` | ~30 buttons across ~6 feature groups inline |
| 583 | `citations/src/styles.ts` | per-style formatting functions - cohesive table-like module, earns size |
| 548 | `editor/src/components/AcademicEditor.tsx` | editor assembly + extension wiring + events |


---

### Signal 7 - JUST-TACKED-ON PRESSURE

#### 7.1 Router reaching into private RAG method - papers.py:549 - HIGH

`endpoints/papers.py:549` calls `rag_service._llm_grounded_answer(user_prompt or query, "document", passages)` - an underscore-private service method invoked directly from the HTTP layer to power `/papers/{id}/ask`. The router also post-processes the magic sentinel string `"Insufficient evidence found in your sources."` (:559) that `_llm_grounded_answer` embeds in its answer text - string-matching on a service's prose as a control channel.

- **Target:** public `RAGService.answer_document_question(...) -> AskPaperAIResponse` (or a typed result the router maps); replace the sentinel-string handshake with an explicit `insufficient_evidence` field from the service.
- **Effort:** M (pairs with Plan B seam 4). **Risk:** LOW.

#### 7.2 Health endpoint probing cache internals - health.py:33 - MEDIUM

`endpoints/health.py:33` calls `provider_cache_service._get_redis()` - a private accessor - then pings the raw client and builds degradation status inline. The cache service owns Redis lifecycle; liveness reporting reaches past its public surface. If the private method is renamed or lazily re-initialized, the health probe silently breaks.

- **Target:** add public `provider_cache_service.ping() -> bool` (or `health_status()`); health.py consumes it. Three-line change plus test.
- **Effort:** S. **Risk:** LOW.

#### 7.3 Tabby lifecycle bolted into two unrelated homes - see 3.3

Process-spawning logic duplicated into `main.py` lifespan AND the provider-settings endpoint; belongs once on `tabby_setup_service`.

#### 7.4 Provider settings request models defined inline in the router - see 3.4

`ProviderConfigUpdate`/`RateLimitUpdate` (`provider_settings.py:42-52`) bypass the schemas layer every other domain uses - classic tack-on during a feature sprint; fold into the Plan A split.

#### 7.5 UI state accreted onto DocumentContext - LOW

`DocumentContext.tsx:96` carries `toastMessage` (transient UI concern) alongside document persistence/autosave; `recentlyAddedRefId` (:95) is bibliography-animation state living with documents. Both belong to a small UI-feedback context or the citation feature's own hook once finding 1.9 lands.
- **Effort:** S. **Risk:** LOW.

## God-Module Decomposition Plans

### Plan A - `app/schemas/models.py` (1,027 lines, 105 classes) - effort M, risk LOW (pure moves)

Split along the seams the routers already draw (`api/v1/api.py` registers 20 routers):

| New module | Classes (current line anchors) |
|------------|-------------------------------|
| `schemas/auth.py` | UserCreate :9, UserLogin :26, UserResponse :31, Token :42, TokenRefreshRequest :49, TokenData :53, OwnerResponse :59, MembershipResponse :68 |
| `schemas/projects.py` | ProjectCreate/Update/Response :79-100 |
| `schemas/documents.py` | DocumentCreate...DocumentResponse :102-139 |
| `schemas/papers.py` | PaperCreate...PaperStatusResponse :141-196, Annotation* :198-228 |
| `schemas/rag_chat.py` | AskPaperAIRequest/Response :230-246, GroundedPassage :275, GroundedSegment :289, TrustLegend :296, ChatMessage/ChatRequest/ChatResponse :302-324, PaperChunkResponse :326, RAGSearchRequest/Response :340-355 |
| `schemas/citations.py` | CitationCreate/Response :248-273, CitationDetailResponse :357, IdentifierResolveRequest/Response :376-399, AddByIdentifierRequest :401, BibtexImportRequest/Response + BibtexExportResponse :407-420, ContextRanking* :422-443 |
| `schemas/ai_writing.py` | AutocompleteRequest...AutocompleteProbeResponse :445-484, AIEditRequest/Response :485-505, AIOutlineSection/Request/Response :507-535 |
| `schemas/export.py` | ExportRequest/ExportResponse :537-557 |
| `schemas/intelligence.py` | ClaimFlagSchema...PaperReviewResponse :559-706 |
| `schemas/zotero.py` | ZoteroImportRequest/Response + ZoteroSyncRequest/Response :708-733 |
| `schemas/system.py` | ProviderStatusItem :735, ProviderQuotaResponse :748, CacheClearResponse :755, LiteratureResult/LiteratureSourceResult/LiteratureSearchResponse :1001-1035 |
| `schemas/teams.py` | TeamCreate...TeamResponse :766-825 |
| `schemas/comments.py` | CommentCreate...CommentResponse :827-860 |
| `schemas/versions.py` | VersionCreate...VersionDiffResponse :862-897 |
| `schemas/graphs.py` | GraphNode...DiscoveryRecommendation :899-945 |
| `schemas/plugins.py` | PluginManifest...PluginHookExecuteResponse :947-999 |

Keep `schemas/__init__.py` re-exporting everything so the 20 routers migrate incrementally; delete the barrel when zero `from app.schemas.models import` remain (explicit removal condition).

### Plan B - `services/rag_service.py` (900 lines) - effort M, risk LOW-MEDIUM

Four seams, independently extractable:

1. `services/embeddings/hash_embedding.py` - `EmbeddingService` (:33-97) incl. `_stable_hash`, word projections, cosine similarity. Rename/document per finding 5.4.
2. `services/rag/chunker.py` - `chunk_paper` (:293) + `_chunk_abstract/_chunk_sections/_chunk_tables/_chunk_equations` (:107-291). The four share a repeated tail pattern: build content string -> embed -> create `PaperChunk` with page/section metadata; extract `_make_chunk(paper, content, meta)` to collapse it.
3. `services/rag/search.py` - `hybrid_search` (:332-471).
4. `services/rag/chat.py` - `_grounded_messages` (:473), `_llm_grounded_answer` (:495), `generate_chat_response` (:499), `stream_chat_response` (:587), `_generate_general_response` (:734), `_synthesize_grounded_answer` (:770). Making the grounded-answer capability public here directly serves finding 7.2 (`papers.py:549`).

`RAGService` remains a thin composition facade so existing import sites keep working.

### Plan C - `services/pdf_extractor.py` (742 lines) - effort M, risk MEDIUM (parsing behavior)

1. `pdf_validator.py` - `PDFValidator` + `PDFExtractionError` (:62-112)
2. `pdf_grobid.py` - `_extract_with_grobid` + `_parse_tei_xml` (:143-283)
3. `pdf_local.py` - `_extract_with_pdfplumber` + `_extract_metadata_from_text` + `_segment_sections` + `_extract_references_from_text` (:285-658)
4. `pdf_merge.py` - `_merge_extractions` + `_calculate_confidence` (:660-742)

Pin behavior with fixture PDFs first (tests already exist: `test_pdf_extractor*.py`).

### Plan D - `services/intelligence_service.py` (681 lines) - effort S-M, risk LOW

One class owns four features sharing almost nothing (each pairs 1:1 with a router endpoint):
1. `intelligence/claim_verification.py` - `verify_claims` (:50-192) + `_first_matching_sentence` (:379)
2. `intelligence/research_gaps.py` - `analyze_research_gaps` (:334) + `_extract_limitations_and_future_work` (:194) + `_synthesize_potential_gaps` (:262)
3. `intelligence/literature_matrix.py` - `generate_literature_matrix` (:401-501)
4. `intelligence/paper_review.py` - `review_paper` (:503-681)

Shared LLM-call helper extracted to `intelligence/_llm.py`.

### Plan E - `context/WorkspaceContext.tsx` (709 lines) - effort M, risk MEDIUM (state-shape change)

Fused concepts and their seams:

1. **Modals (~200 lines: types :87-114, states/openers/close-handlers :250-300+)** - 13 independent booleans + bibtex tab state. Replace with one reducer: `{ open: ModalKey | null, payload }`; expose `openModal('bibtex', { tab: 'import' })` / `closeModal()`. Deletes ~120 lines of boilerplate and makes "only one modal open" an invariant instead of luck. `ModalContainer.tsx` maps key -> component.
2. **AI writing flows (:59-85 ContinuationState/EditReviewState, trigger functions ~:430-580)** - extract `useAIWriting()` hook (continuation + edit review + latency/usage recording), co-located with `AIWritingFloatingOverlay`.
3. **AI preferences (:161-170 ghostText / latencyTier / hourlyCap / usage)** - small `AIPreferencesContext` or persisted hook.
4. **Navigation & reader routing (:19-32, :204-236)** - stays in a slimmed shell context.
5. **Shell panels/theme/a11y announce (:127-158, :197-202)** - stays, or becomes `useTheme`/`useAnnounce` hooks.

`toGroundedPassage` leaves per finding 2.1. Target: each new home <150 lines; WorkspaceContext <200.

### Plan F - `components/reader/PdfReader.tsx` (844 lines) - effort M-L, risk MEDIUM

Seams: `usePdfDocument(url)` (load/progress/pages), text-layer rendering + selection events, annotation overlay component, toolbar component (zoom/page/search), container state machine. Extract hooks first (pure moves) before splitting components - PDF.js event lifecycles interleaved with React state are the risk zone.

### Plan G - `components/chat/AiResearchChat.tsx` (659 lines) - effort M, risk LOW

Seams: `useChatStream()` (SSE framing over `streamRequest`), presentational `ChatMessageList` + source-card component, input composer. The passage/source card likely shares DNA with SourcePanel's active-source card - check during extraction (possible extension of family 1.9).

---

## Duplication Atlas

| Family | Copies | Locations | Canonical-home proposal | Effort | Risk |
|--------|--------|-----------|-------------------------|--------|------|
| Author full-name splitting | 7 | lit_search:22; ident_resolver:196,260; csl_processor:33,75,102,114; citations.py:361-371; bibtex.ts:29 | `app/core/authors.py` (single param'd splitter); TS twin stays at process boundary | M | MED |
| BibTeX serializer | 3 | bibtex.ts:233; export/bibtex_exporter.py:13; citations.py:51 | `export/bibtex_exporter.py` (Python); bibtex.ts (TS runtime) | S | LOW |
| BibTeX parser | 2 | bibtex.ts:80-228; citations.py:338-371 | `services/citation_import.py` porting balanced-brace scanner | M | MED |
| Citation-key generator | 3 | bibtex.ts:12; bibtex_exporter.py:30; citations.py:69 | `export/bibtex_exporter.make_citation_key` | S | LOW |
| Project access check | 3 helpers + inline | intelligence:25; graphs:19; zotero:21; papers.py:74; citations.py x8 | `services/auth.require_project` | S-M | LOW |
| Document access check | 2 byte-identical + inline | comments:22; version_history:52; collaboration:371 | `services/auth.require_document` | S | LOW |
| AI-edit prompt instructions | 2 verbatim | packages/ai/shared.ts:3; ai_writing_service.py:51 | Python owner; TS copy deleted with dead providers | S | LOW |
| DOI normalization | 3 | crossref_plugin:5; lit_search:29; ident_resolver:~60 | `core/text_utils.normalize_doi` | S | LOW |
| arXiv ID grammar | 2 | arxiv_plugin:5-7; ident_resolver | `core/identifiers.py` | S | LOW |
| Frontend citedRefs/bibliography machinery | 2 (+1 orphan adapter) | CitationsManager:51-137; SourcePanel:63-137; paperToBibRef.ts | `lib/citations/useBibliography` + full `paperToBibRef` | M | LOW |
| Style options list (27 entries) | 2 (drifted) | CitationsManager:110-137; SourcePanel:110-137 | `lib/citations/styles.ts` (i18n labels) | S | LOW |
| Provider-stack abstraction (dead) | 2 systems | packages/research/* vs literature_search_service.py | Delete packages/research | S | LOW |
| LLM-provider abstraction (dead runtime) | 2 systems | packages/ai/providers vs llm_service.py | Reduce packages/ai to types | S | LOW |
| Error envelope | 2 formats | middleware.py:47; all HTTPException sites; client.ts:16-63 bridges | One envelope contract; shrink describeErrorDetail | S-M | MED |
| Test transport fakes | 4 variants | llm_provider_paths:9; tabby_autocomplete:19; local_mode:12,113; cov_services_final:67,266 | `tests/helpers/fakes.py` | S | LOW |
| Tabby autostart routine | 2 identical | main.py:41; provider_settings endpoint:34 | `tabby_setup_service.launch_in_background()` | S | LOW |
| STOP_WORDS tokenization | clean (control case) | core/constants.py:5 feeding rag+graph | already single-owner - positive control | - | - |

---

## Refactor Roadmap (ordered by value/risk)

| # | Action | Findings | Value | Risk | Effort |
|---|--------|----------|-------|------|--------|
| 1 | Merge BibTeX serializer copies into `export/bibtex_exporter.py` with escaping; regression-test hostile titles | 1.2, 1.4 | Fixes live data-corruption drift | LOW | S |
| 2 | Extract BibTeX import parser from `citations.py` into `services/citation_import.py` (balanced-brace scanning) | 1.3, 3.1 | Correctness + router diet | MED | M |
| 3 | Create `core/authors.py`; migrate 6 Python call sites; pin PubMed/arXiv name-convention tests | 1.1 | Kills worst duplication family | MED | M |
| 4 | Hoist `require_project`/`require_document` into `services/auth.py`; convert routers | 1.5 | Policy uniformity; ~150 LOC gone | LOW | S-M |
| 5 | Delete `packages/research`; strip `packages/ai` to types | 5.1, 5.2, 1.6 | ~900 LOC dead parallel stacks removed | LOW | S |
| 6 | Unify Tabby autostart; delete `export_service.py` shim after consumer retarget | 3.3, 2.2 | Ownership clarity | LOW | S |
| 7 | Split `schemas/models.py` into 16 domain modules behind temporary barrel | Plan A | Unblocks future backend work | LOW churn | M |
| 8 | Decompose `rag_service.py` per Plan B; make grounded-answer public for papers router | Plan B, 7.2 | Removes private reach-through | LOW-MED | M |
| 9 | Frontend: extend `paperToBibRef`, extract `useBibliography` + `STYLE_OPTIONS`; retarget both components | 1.9 | Kills 110-line UI dup + label drift | LOW | M |
| 10 | WorkspaceContext modal reducer + `useAIWriting` extraction | Plan E, 2.1 | God-context -> small owners; modal invariant | MED | M |
| 11 | Pick one error envelope; simplify `describeErrorDetail` | 5.3 | Contract clarity | MED | S-M |
| 12 | `Literal` types for `extraction_status`; shared CITATION_STYLES source of truth | 5.5 | Boundary enforcement | LOW | S-M |
| 13 | `normalize_doi`/arXiv grammar into `core/identifiers.py` | 1.7, 1.8 | Consistent cleaning | LOW | S |
| 14 | Split intelligence + pdf_extractor services (Plans C/D); PdfReader + AiResearchChat extractions (Plans F/G) | Plans C/D/F/G | Maintainability compounding | MED | M-L |
| 15 | Shared test fakes module; stable-hash IDs; document HashEmbedding seam | 1.10, 5.4 | Hygiene | LOW | S |

Sequencing notes: #1-#4 are independent and landable as reviewable passes within about a week of focused work. Do #7 before #8/#14 to reduce merge friction. #10 last among frontend items so #9's hooks land first.

---

## Positive Observations

- **Consistent threading discipline:** `anyio.to_thread.run_sync` is the single dominant sync-over-async idiom (7 sites); no `run_in_executor` or mixed-loop sediment. `core/http_client.py` is a genuinely well-built loop-aware pooled client shared by all outbound HTTP.
- **`core/constants.STOP_WORDS`** has exactly one owner feeding both `rag_service` and `graph_service` - the pattern the citation stack should replicate.
- **`services/export/` package** is properly factored per format (bibtex/docx/markdown/pdf/csl_formatter/ast_parser/options/service) with a clean `__init__` - the right shape; it simply needs to absorb its duplicate in `citations.py`.
- **Hermetic test setup:** `conftest.py` provides fresh event loops per test, isolates Redis and provider-key stores, resets rate limiters - excellent hygiene that makes every refactor above safely verifiable.
- **Honest-failure semantics documented** in the `llm_service.py` docstring (return None when unreachable; deterministic fallbacks instead of fabricated output) - rare and valuable.
- **i18n exists** (`apps/web/src/i18n/index.ts`) and one of the two style-option lists already uses it; consolidation restores rather than introduces the pattern.
- **No lineage-named identifiers** (`foo_v2`, `legacy_*`, `*-new`) anywhere - naming hygiene is high; history lives in git.
- **Alembic-managed migrations with baseline stamping** (`main.py:_run_migrations`) replaced ad-hoc `create_all` cleanly, including the pre-Alembic database detection path.
