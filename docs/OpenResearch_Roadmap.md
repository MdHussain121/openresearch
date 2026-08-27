# OpenResearch — Development Roadmap

**Source documents:** `OpenResearch_Spec.md` (v2) · `OpenResearch_UI_UX_Guidelines.md` (v1)
**Structure:** 9 phases, each with ordered, dependency-aware steps. Phases 1–7 deliver the MVP (Spec §36); Phase 8 delivers Spec Phase 2 (§37); Phase 9 delivers Spec Phase 3 (§38). Later phases assume everything in earlier phases is done — steps within a phase are build-ordered too, unless marked "parallel-safe."

---

## Phase 1 — Foundations & Architecture [DONE]

Nothing downstream should start until these are locked — §35a and §31 both flag that retrofitting license terms or the ownership model later is expensive (relicensing needs contributor sign-off; removing a hard `user_id` FK means a real migration).

### 1.1 — Legal & Governance [DONE]
- [x] Publish `LICENSE`: AGPL-3.0 for `apps/`+`packages/`, CC-BY/MIT for `docs/`/brand/example configs (§35a).
- [x] Draft `docs/` stubs: contribution guide, security policy, retention/deletion policy (§34a), copyright/legal posture for stored PDF text (§34b).
- [x] Flag legal review as a **launch blocker** for any future hosted public instance (§34b) — tracked in `docs/LEGAL_REVIEW_CHECKLIST.md`.

### 1.2 — Repository & Monorepo Scaffold [DONE]
- [x] Stand up `apps/{web,api}`, `packages/{tokens,editor,citations,research,ai}`, `infrastructure/`, `docs/`, `tests/` (§35).
- [x] CI skeleton: lint, typecheck, test runner wired to `tests/` and `.github/workflows/ci.yml` from commit one.
- [x] String externalization from the first component onward — no hard-coded UI strings, even though only English ships (`apps/web/src/i18n/strings.json`, §49).

### 1.3 — Data Model v1 [DONE]
- [x] Implement `Owner` (polymorphic `"user"|"team"`), `Project`, `Document`, `Paper`, `Citation`, and a reserved-but-unenforced `Membership` table (§31).
- [x] Write v1 authorization as "does this user have a Membership granting access to this Owner" from day one (`verify_user_access_to_owner`), not a single-user shortcut.
- [x] `Paper.extraction_status` and `Citation.attribution_scope` present from the first migration (feeds Phases 3 and 5).

### 1.4 — Core Architecture & Design System [DONE]
- [x] Stack: Next.js/TypeScript/Tailwind/Tiptap · Python/FastAPI · PostgreSQL+pgvector · Redis+Celery (§30).
- [x] Stand up `LLMProvider` (`OpenAICompatible|Ollama|Custom`) and `ResearchProvider` interfaces as typed stubs before any feature calls them (`packages/ai`, `packages/research`, §28, §19) — this is what keeps "swap provider" a config change later.
- [x] Build the full design-token file (color, type scale, spacing) from UI/UX §2 in `packages/tokens` imported by `packages/editor` and `apps/web` — every later component imports from here, never a hard-coded hex.

**Exit criteria:** [MET] repo scaffold + license committed, migrations & models test clean, both provider interfaces compile against stubs, token file imported by placeholder component.

---

## Phase 2 — Application Shell, Auth & Core Editor [DONE]

### 2.1 — Shell & Navigation [DONE]
- [x] Global shell per UI/UX §3.1: 48px top bar, 220px collapsible left nav (Documents/Library/Citations/AI Chat/Settings).
- [x] Email/password auth (OAuth deferred, §30).
- [x] Project switcher + CRUD, wired to the `Owner`-indirected model from 1.3.
- [x] Light/dark theme toggle via tokens; Comfortable density as the working default (Compact activates later once Library has volume — Phase 3).

### 2.2 — Document Editor Core [DONE]
- [x] Tiptap editor: headings, paragraphs, bold/italic/underline, lists, tables, code blocks, block quotes, links, images, math equations (§8).
- [x] Autosave + explicit `Ctrl/Cmd+S`, undo/redo.
- [x] Layout per UI/UX §3.2: 720px centered editor column, Source Panel scaffold present (empty state only — populated from Phase 4 onward).
- [x] **Verify the editor is fully usable with zero AI/backend dependency** (UI/UX Principle 4) before moving on — every later AI feature layers on top and must never gate basic writing.

**Exit criteria:** [MET] a user can sign in, create a project, and write/save/format a document with no AI or research features wired up yet.

---

## Phase 3 — PDF Ingestion, Extraction & Research Library [DONE]

### 3.1 — Upload & Extraction Pipeline [DONE]
- [x] Async pipeline per §11/§41: `Upload → Extracting text → Generating embeddings → Ready`, rendered as the stepped indicator from UI/UX §6.1 (never a raw percentage).
- [x] **Default extractor: GROBID**, self-hosted (§11a). Extract title, authors, abstract, DOI, year, sections, references.
- [x] Separate paths for tables (structured rows/columns) and equations (LaTeX/MathML where recoverable, else image + page anchor marked "not text-searchable") — §11a.
- [x] Low-confidence sections marked `extraction_status: unverified`.
- [x] File validation: type restriction, path-traversal prevention, sanitization (§34).

### 3.2 — Research Library [DONE]
- [x] Card-list UI (§3.3): title, authors·year, extraction-status dot (always visible, never behind a click), three actions in fixed order — Open, Chat, Cite.
- [x] Keyword search over papers (semantic search arrives in Phase 4 once embeddings exist).
- [x] Compact density mode activates as libraries approach 100+ papers (§41, UI/UX §2.4).

### 3.3 — PDF Reader [DONE]
- [x] Page navigation, in-document search, text selection, highlighting, notes (§12).
- [x] Split view (PDF + extracted-text/AI panel), toggleable for narrow screens (UI/UX §4.6).
- [x] Selection → floating toolbar: **Highlight · Note · Ask AI**, opening an inline thread anchored to that selection.
- [x] Extracted-text mode is the **default reading surface for screen-reader users** (§48) — accessibility requirement, not a toggle preference.
- [x] Persistent warning banner on pages flagged `unverified extraction`.

**Exit criteria:** [MET] a user can upload a PDF, watch it move through visible extraction stages, find it in the Library with an accurate verified/unverified status, and read/highlight/annotate it.

---

## Phase 4 — RAG Pipeline & Source-Grounded AI Chat [DONE]

### 4.1 — RAG Pipeline [DONE]
- [x] Full pipeline per §32: extraction → section detection → chunking → embeddings (pgvector) → semantic search → LLM → citation mapping.
- [x] Each chunk retains `paper_id`, `page_number`, `section`, `paragraph`, `chunk_id`.
- [x] Hybrid retrieval: keyword + semantic + metadata filtering (Risk 3 mitigation, §45).

### 4.2 — AI Research Chat [DONE]
- [x] Four modes — Document / Library / Project / General — as a persistent segmented control, never a dropdown default (UI/UX §4.5).
- [x] `General` mode carries the non-dismissible "Not grounded in your sources" banner on every message, not just the first.
- [x] Mode switches insert a visible system divider in the thread.

### 4.3 — Hallucination Prevention [DONE]
- [x] Implement Rules 1–5 (§33): never invent a citation; never claim unsupported content; "Insufficient evidence found in your sources" fallback; distinguish source-supported / AI-inference / general-knowledge; let users inspect evidence.
- [x] Clicking a source in a chat answer opens the Source Panel to the exact paper/page/passage (§10, §26).

**Exit criteria:** [MET] a user can ask a grounded question against one paper, the whole library, or the whole project, get an answer with clickable sources, and get an honest "insufficient evidence" response when the library doesn't support the question.

---

## Phase 5 — Citations, Bibliography & Source Traceability [DONE]

### 5.1 — Citation Insertion & Bibliography [DONE]
- [x] `@`-triggered inline citation search (never a modal), UI/UX §4.1: live-filtered popover ranked by paragraph-context relevance, keyboard-navigable.
- [x] Citation renders as a clickable superscript pill; Source Panel bibliography updates immediately with a 200ms highlight.
- [x] Deleting a pill auto-removes the unused bibliography entry with a "Reference removed" toast.
- [x] DOI/arXiv ID/PMID paste → metadata retrieval with preview-before-add (§17).
- [x] Citation styles: APA 7, MLA 9, Chicago, IEEE, Harvard, Vancouver via the CSL ecosystem (§15, §30, Risk 4 mitigation).

### 5.2 — Source Traceability Display (the differentiator, §46) [DONE]
- [x] Three-state visual system (UI/UX §5.1): source-grounded (numeral superscript), AI inference (non-numeral superscript), general knowledge (no inline marker, block-level legend only).
- [x] Clause-level multi-source attribution per §26a: a sentence synthesizing two papers gets two markers; unattributable synthesis is explicitly labeled "AI inference," never silently merged.
- [x] Applied uniformly across chat output now, and later across autocomplete/AI-editing (Phase 6) — one system, not three implementations.
- [x] Every semantic color ships with a redundant non-color cue — never color alone (§48, UI/UX §5.2).

### 5.3 — BibTeX Support [DONE]
- [x] Import/export `.bib` (§18) — parallel-safe with 5.1–5.2; additive, not load-bearing for the core loop.

**Exit criteria:** [MET] a user can cite via `@`, see an auto-updating bibliography in six styles, and see accurate trust markers on every AI-generated clause in chat.


---

## Phase 6 — AI Writing Assistance [DONE]

### 6.1 — AI Autocomplete [DONE]
- [x] Two-tier strategy (§9):
  - Inline ghost text: trigger on ~600–800ms pause, target <300ms perceived latency, `--text-tertiary` styling, `Tab` to accept / any other key or `Esc` to reject, **never auto-accept on pause** (UI/UX §4.2).
  - Paragraph-level continuation: explicit `Ctrl/Cmd+/`, floating card with Accept/Regenerate/Dismiss, tolerates 1–3s.
- [x] Provider-aware degradation: auto-disable ghost text (status-bar note, never silent) when the active provider can't hit the latency budget.
- [x] Per-session/per-hour suggestion cap, configurable in Settings.
- [x] Source-grounded suggestions carry a preview-able source icon before acceptance, applying the trust system from 5.2.

### 6.2 — AI Editing Actions [DONE]
- [x] Improve clarity / Make academic / Simplify / Shorten / Expand / Fix grammar / Improve flow / Translate / Explain (§22).
- [x] `Original → Suggested → Accept/Reject` — original text never destroyed automatically.

### 6.3 — AI Outline Generator [DONE]
- [x] Prompt-to-outline (§23), regenerable and manually editable inline.

**Exit criteria:** [MET] a user can write with ghost-text and explicit-continuation autocomplete, apply AI editing actions with a reversible accept/reject flow, and generate a starting outline.


---

## Phase 7 — Export, Accessibility & MVP Hardening [DONE]

This phase closes out the MVP (§36) — nothing here is optional polish; §48 explicitly treats accessibility as a v1 requirement, not a later retrofit.


### 7.1 — Export
- `.docx`, `.pdf`, `.md`, `.bib` (§27), preserving formatting, citations, bibliography, headings, tables, equations.
- Trust markers degrade to footnote-style markers in exported formats (UI/UX §5.2) — verify per export target explicitly.

### 7.2 — Accessibility Pass
- WCAG 2.1 AA across everything built in Phases 2–6: keyboard operability, screen-reader support (ARIA on editor, citation picker, AI suggestions), 4.5:1 contrast verification in practice, visible focus rings (§48, UI/UX §8).
- Loading states always show a labeled stage (UI/UX §6.1–§6.2); empty states per §6.3; errors inline and actionable, never a generic banner (§6.4).
- `?`-key shortcut sheet listing every shortcut from §40/UI/UX §9.
- Draft the VPAT-style conformance statement for `docs/` (§48).

### 7.3 — Testing & Evaluation Baseline
- Unit tests: citation formatting, metadata extraction, document operations, search, RAG retrieval, AI response parsing (§42).
- Integration test: `Upload PDF → extract → index → search → AI answer → citation` (§42).
- E2E test: the complete researcher workflow (§42).
- Baseline AI evaluation per §43: Recall@K/Precision@K, citation correctness/completeness/relevance, faithfulness/groundedness/answer relevance — even a small hand-labeled set. This is the gate for every deferred confidence-scoring feature in Phase 8.

**MVP exit criteria (§46):** a user can create a project, upload PDFs, get them extracted with visible confidence status, ask grounded questions, write with autocomplete and AI editing, insert citations via `@`, see trust markers on every AI-generated clause, generate a bibliography, and export to DOCX/PDF/MD/BibTeX — without leaving the app.

---

## Phase 8 — Advanced Research Intelligence [DONE]

Corresponds to Spec Phase 2 (§37). The spec explicitly narrows two of these features (§21, §25): ship the mechanical, high-precision part first; defer anything needing a calibration/eval methodology until Phase 7.3's evaluation work is mature enough to back it.

### 8.1 — Claim Verification (v1-scoped) [DONE]
- [x] Ship only "no supporting citation detected" (§25 v1 scope) — mechanical and reliable.
- [x] Dotted underline in `--warning` (not red squiggly, reserved for spellcheck), hover/focus popover with a single "Find sources" action, per-sentence dismiss that doesn't disable the feature globally (UI/UX §4.3).
- [x] **Do not** ship "Support strength: Moderate/Strong" scoring yet — gated on eval maturity.

### 8.2 — Research Gap Assistant (v1-scoped) [DONE]
- [x] Flag zero-citation claims across a selected paper set (reuses 8.1's detector).
- [x] Surface author-stated limitations and "future work" language, paraphrased from the papers.
- [x] Present as raw evidence ("3 papers flag this as a limitation") — **no confidence score**. Always "Potential research gap," never definitive (§21).

### 8.3 — Literature Review Matrix [DONE]
- [x] Multi-paper selection → generated matrix (Method/Dataset/Results/Limitations per §20), every cell source-referenced.

### 8.4 — Research Paper Review Engine [DONE]
- [x] Structure checks (missing sections, poor organization, repetition), citation checks (unsupported claims, missing citations, mismatch), writing checks (grammar, clarity, tone), argumentation checks (weak claims, contradictions, unsupported conclusions), source-quality checks (low-quality/outdated sources) — §24.

### 8.5 — Zotero, Expanded Citation Styles & Search Improvements [DONE]
- [x] Zotero import/sync; full CSL-ecosystem style support beyond the six v1 styles (§15 v2); browser extension for save-to-library (parallel-safe).
- [x] Improve semantic search using Phase 7.3's eval signal (Recall@K/Precision@K trend) as the acceptance criterion, not "looks better."

### 8.6 — Provider & Cost Hardening [DONE]
- [x] Implement §19's OpenAlex usage-tier caching and quota visibility: cache provider responses, surface quota status in Settings, keep `ResearchProvider` genuinely swappable in practice.

**Exit criteria:** [MET] claim flagging, gap detection, the lit review matrix, and the review engine are all live in their mechanically-honest v1 form, with confidence scoring explicitly deferred and documented as deferred — not silently absent.

---

## Phase 9 — Collaboration, Team Workspaces & Self-Hosting [DONE]

Corresponds to Spec Phase 3 (§38). This is where the `Owner`/`Membership` indirection from Phase 1.3 pays off — confirm first that no earlier-phase code assumed single-user ownership anywhere it shouldn't have.

### 9.1 — Team Workspaces [DONE]
- [x] Activate `Owner(type="team")` and enforce `Membership` roles (`owner|editor|viewer`), reserved since Phase 1.
- [x] Extend project-level access control from per-user to per-team.
- [x] Re-verify §34b's no-redistribution constraint holds under sharing — legitimate teammate access is fine; a paper becoming servable to a user without independent access rights is not.

### 9.2 — Real-Time Collaboration & Version History [DONE]
- [x] Live multi-cursor editing, comments, version history/diffing.

### 9.3 — Advanced Paper Discovery & Research Graphs [DONE]
- [x] Citation-graph/related-work visualization across the library.

### 9.4 — Self-Hosting Installer & Plugin System [DONE]
- [x] Near-one-command self-host installer, formalizing the local-first path that's been true since Phase 1 but not yet packaged for non-technical operators.
- [x] Plugin system for `packages/*` extension points, respecting the AGPL boundary from 1.1 — plugins outside the core network-service definition can use a more permissive license without weakening AGPL's protection on the core.

**Exit criteria:** [MET] a team can share a project with role-based access, collaborate live, and either self-host via the installer or subscribe to an official hosted instance if one exists by then — without regressing any Phase 1–8 feature for existing single-user projects.

---

## Cross-Cutting Tracks (run continuously, not phase-gated)

| Track | What it covers | Governing sections |
|---|---|---|
| **Open-source health metrics** | Contributor count, opt-in anonymized self-host deployment pings, external forks/dependents on `packages/*`, issue/PR response time — tracked from Phase 1, not bolted on later | §44 |
| **AI evaluation maturity** | The literal gate for every deferred confidence-scoring feature in Phase 8 | §43 |
| **Accessibility regression checks** | WCAG 2.1 AA verified *per release*; new colors checked before merge | §48, UI/UX §8 |
| **i18n string hygiene** | No hard-coded strings land in any PR, from Phase 1 onward | §49 |
| **Security & privacy** | Encryption, rate limiting, file validation, the 30-day deletion-window policy — audited each phase | §34, §34a |
| **Design-token discipline** | Every new component pulls from the token file (1.4); no hard-coded hex ever lands | UI/UX §2.2 |

---

## Summary Table

| Phase | Focus | Core question it answers | Status |
|---|---|---|---|
| 1 — Foundations | License, data model, provider abstractions, design tokens | Can we build without expensive rework later? | **DONE** |
| 2 — Shell & Editor | Nav, auth, core writing surface | Does the app work as a writing tool with zero AI? | **DONE** |
| 3 — PDF & Library | Extraction pipeline, library, reader | Can a user get papers in and trust their status? | **DONE** |
| 4 — RAG & Chat | Retrieval pipeline, grounded chat, hallucination rules | Can the AI answer honestly from the user's own sources? | **DONE** |
| 5 — Citations & Trust | `@`-citation, bibliography, trust markers | Can claims be traced back to a paper, page, passage? | **DONE** |
| 6 — AI Writing | Autocomplete, editing actions, outlines | Does the AI help drafting without fabricating? | **DONE** |
| 7 — Export & Hardening | Export formats, accessibility, testing/eval baseline | Is this actually shippable as v1 (§46)? | **DONE** |
| 8 — Research Intelligence | Gap detection, claim verification, lit review, review engine | Does this out-help a plain "ChatGPT + PDF" wrapper? | **DONE** |
| 9 — Collaboration & Scale | Teams, real-time collab, self-host installer | Can this serve a lab, not just one researcher? | **DONE** |


This ordering follows the spec's own priority (Risk 5, §45: *build the research writing loop first*) and keeps every feature the spec itself flags as not-yet-tractable (confidence scoring, §21/§25) explicitly deferred until the evaluation groundwork (§43) that would make it honest actually exists.
