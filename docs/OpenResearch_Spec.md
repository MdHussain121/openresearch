# Product Specification: OpenResearch — Open-Source AI Academic Research & Writing Assistant

> **v2 — Revised.** This version resolves the gaps raised in the internal review: license & funding model (§35a), competitive landscape (§2a), autocomplete cost/latency strategy (§9), PDF extraction pipeline incl. tables/equations (§11a), multi-source citation attribution rules (§26a), team-workspace-ready data model (§31), narrowed v1 scope for gap detection & claim verification (§21, §25), accessibility requirements (§48), i18n scope (§49), data retention/training policy (§34), copyright/legal posture for stored PDF text (§34a), provider pricing caveats (§19), and contributor/self-host success metrics (§44). Changes are marked inline where they revise prior text.

## 1. Product Overview

**OpenResearch** is an open-source alternative to AI academic writing platforms such as Jenni AI.

The goal is not to copy Jenni's proprietary implementation, but to build an independent, transparent research workspace with similar core capabilities:

> **Find → Read → Understand → Write → Cite → Review → Export**

OpenResearch combines an academic editor, AI autocomplete, AI chat, citation management, research library, PDF reader, research assistance, and export tools into one open-source workspace.

---

# 2. Problem Statement

Academic researchers currently have to switch between multiple applications:

- Google Docs / Word for writing
- Zotero for references
- Google Scholar / Semantic Scholar for papers
- PDF readers for research
- ChatGPT/Claude for understanding papers
- Citation generators for formatting
- Separate tools for proofreading

This creates several problems:

- Context is scattered.
- Citations are manually managed.
- AI-generated claims can be difficult to verify.
- Researchers repeatedly upload or copy the same papers.
- Literature-review workflows are fragmented.

**OpenResearch combines these workflows into one open-source workspace.**

---

# 2a. Competitive Landscape

Jenni AI is the closest proprietary reference point, but it is not the only relevant comparison. Positioning against the full field sharpens what OpenResearch must actually be best at:

| Product | What it does well | Gap OpenResearch fills |
|---|---|---|
| **Zotero** | Reference management, huge plugin ecosystem, well-trusted by researchers | No writing environment or AI assistance — OpenResearch is Zotero + editor + AI, not a replacement for Zotero's plugin depth |
| **Elicit / Consensus** | Q&A over the broader literature, not just uploaded papers | Not writing-integrated — good for discovery, not for drafting with grounded citations inline |
| **NotebookLM** | Source-grounded chat over uploaded documents — conceptually close to §10 | No academic editor, no citation formatting, no bibliography, closed source |
| **scite.ai** | Classifies citations at scale as supporting/contradicting/mentioning a claim — directly relevant to §25 | Not embedded in a writing loop; it's a separate lookup tool researchers still have to context-switch to |

**The real differentiator is not any single feature above — it's doing source-grounded verification *inside* the writing loop**, so the researcher never leaves the editor to check whether a claim is supported. §46's core differentiator (source traceability) is what makes this defensible rather than a "ChatGPT + PDF upload" wrapper. Every feature decision should be tested against this: does it keep the researcher inside the writing loop, or does it send them somewhere else?

---

# 3. Target Users

### Primary

- University students
- Undergraduate researchers
- Master's students
- PhD students
- Independent researchers

### Secondary

- Research labs
- Academic teams
- Professors
- Technical writers
- Open-source research communities

---

# 4. Product Goals

### Must achieve

1. Provide a proper academic writing environment.
2. Allow users to upload and organize research papers.
3. Allow AI to understand uploaded papers.
4. Provide source-grounded AI writing assistance.
5. Make citations easy to insert.
6. Automatically generate bibliographies.
7. Allow users to verify AI-generated claims.
8. Export papers to common formats.
9. Keep the core application open source.
10. Support local/self-hosted AI models.

### Non-goals for V1

Do not attempt to build:

- A complete Google Docs replacement
- A massive academic search engine
- 10,000+ citation styles immediately
- Full real-time collaboration
- Mobile applications
- Advanced plagiarism detection
- AI-generated images
- A proprietary foundation model

These can come later.

---

# 5. Core User Workflow

The primary workflow should be:

```text
Create Project
      ↓
Upload Research Papers
      ↓
Build Research Library
      ↓
Read / Search Papers
      ↓
Ask AI Questions
      ↓
Create Outline
      ↓
Write Paper
      ↓
AI Assistance
      ↓
Insert Citations
      ↓
Review Claims
      ↓
Generate References
      ↓
Export
```

---

# 6. Application Structure

The application should have five major areas:

```text
┌───────────────────────────────────────────────┐
│ OpenResearch                                  │
├──────────────┬────────────────────────────────┤
│              │                                │
│  Workspace   │        Document Editor         │
│              │                                │
│  Research    │                                │
│  Library     │                                │
│              │                                │
│  Documents   │                                │
│              │                                │
│  Citations   │                                │
│              │                                │
│  Settings    │                                │
│              │                                │
└──────────────┴────────────────────────────────┘
```

---

# 7. Research Projects

Users should be able to create separate research projects.

Example:

```text
Projects

├── AI Hallucination Research
├── Computer Vision Paper
├── Final Year Project
└── Literature Review
```

Each project contains:

- Documents
- Research papers
- Citations
- Notes
- AI conversations
- Collections

---

# 8. Document Editor

The editor is the central component.

It should support:

- Headings
- Paragraphs
- Bold
- Italic
- Underline
- Lists
- Tables
- Code blocks
- Block quotes
- Links
- Images
- Mathematical equations
- Citations
- References

The editor should be designed around academic writing rather than generic document editing.

---

# 9. AI Autocomplete

This is one of the most important features.

While the user writes:

> Transformer models have demonstrated strong performance in...

The AI can suggest a continuation.

The suggestion should be based on:

1. Current paragraph
2. Previous paragraphs
3. Section heading
4. User-selected papers
5. Research project context

### Important requirement

AI suggestions should **never silently fabricate citations**.

Every research-backed suggestion should expose its source.

### Cost & Latency Strategy (v1 requirement, not optional)

Autocomplete is the flagship feature, so its trigger strategy and provider trade-off must be decided before build, not discovered during it:

- **Trigger, not stream.** Do not call the LLM on every keystroke. Trigger on a pause (e.g. ~600–800ms of no typing) or an explicit shortcut (`Ctrl/Cmd + /` per §40). This bounds API calls to roughly one per completed thought, not one per character.
- **Two-tier suggestion depth.**
  - *Inline ghost-text* (next few words): only offered when latency budget allows — target **<300ms** perceived latency. This tier should prefer a small/fast local or hosted model, or be skipped entirely on slower providers rather than degrade the typing feel.
  - *Paragraph-level continuation* (explicit request via shortcut, not automatic): can tolerate 1–3s and use the user's configured provider from §28, since it's an intentional action, not a background one.
- **Provider-aware degradation.** Map the four §28 provider options to expected latency class at build time (hosted API < 1s typical; local model latency depends on hardware — often too slow for inline ghost-text on a laptop). When the active provider can't hit the inline-tier budget, disable ghost-text automatically and fall back to explicit-request-only, rather than shipping a laggy default experience.
- **Cost ceiling.** Debounced triggers + a per-session/per-hour suggestion cap (configurable) keep hosted-API cost predictable. Surface the setting in Settings rather than hard-coding it, since acceptable cost differs by whether the user is on a free community instance, a paid hosted plan, or self-hosting.

---

# 10. Source-Grounded AI

This is the core differentiator.

Instead of:

```text
User → LLM → Answer
```

use:

```text
User question
      ↓
Search research library
      ↓
Retrieve relevant passages
      ↓
LLM
      ↓
Answer + Sources
```

Example:

**User:**

> What are the main limitations of RAG systems?

**AI:**

```text
RAG systems commonly face:

1. Retrieval errors
2. Poor document ranking
3. Context limitations
4. Retrieval latency

Sources:
[1] Relevant paper
[2] Relevant paper
```

Clicking a source should open the relevant paper location.

---

# 11. PDF Research Library

Users can upload PDF research papers.

The system should extract:

- Title
- Authors
- Abstract
- DOI
- Year
- Sections
- References

and store the document.

### 11a. Extraction Pipeline (default: GROBID)

"PDF processing" must not stay undefined — academic PDFs are a genuinely hard parsing problem (two-column layouts, tables/equations that break naive extraction, references bleeding into body text).

- **Default extractor: [GROBID](https://github.com/kermitt2/grobid)**, the de facto open-source tool for scholarly PDF parsing, already used in production at HAL, ResearchGate, and CERN. It should run as a self-hosted service in the architecture (§29), consistent with the local-first principle.
- **Known limitation to design around:** GROBID renders tables and equations as images rather than extractable structured text. Since clean, traceable passages are the whole product pitch (§10, §26), tables and equations need a **separate extraction path**:
  - Tables → a dedicated table-extraction step (e.g. layout-aware table detection) producing structured rows/columns, not just an image blob, so a table cell can still be cited with a page/location reference.
  - Equations → extracted as image + LaTeX/MathML where recoverable (e.g. via an OCR-for-math step); when not recoverable, store as image with a page anchor and mark it "not text-searchable" rather than silently dropping it.
- **Failure mode is visible, not silent.** If extraction confidence is low for a section, mark that section as "unverified extraction" in the paper's metadata so downstream AI answers can decline to cite from it (consistent with §33 Rule 3).

### Library UI

```text
Research Library

Search papers...

┌───────────────────────────────────┐
│ Attention Is All You Need         │
│ Vaswani et al. · 2017             │
│ [Open] [Chat] [Cite]              │
└───────────────────────────────────┘
```

---

# 12. PDF Reader

The PDF reader should support:

- Page navigation
- Search
- Text selection
- Highlighting
- Notes
- Ask AI about selection
- Ask AI about page
- Ask AI about entire paper

Example:

User highlights a statement and selects:

**Ask AI → Explain**

The assistant explains the claim using surrounding context.

---

# 13. Research Chat

Each research project should have an AI chat.

### Document mode

Answers based on the current paper.

### Library mode

Answers based on selected papers.

### Project mode

Answers based on all project research.

### General mode

Normal AI assistance, clearly marked as **not source-grounded**.

Users should always know whether an answer comes from their research sources.

---

# 14. Citation System

Users should be able to type:

```text
@
```

inside the editor.

Example:

```text
Recent research suggests that...
@
```

The application opens a source search:

```text
Search sources

┌─────────────────────────────────────┐
│ transformer efficiency              │
├─────────────────────────────────────┤
│ Vaswani et al. (2017)               │
│ Attention Is All You Need            │
│ [Cite]                              │
│                                     │
│ Devlin et al. (2018)                │
│ BERT                                │
│ [Cite]                              │
└─────────────────────────────────────┘
```

---

# 15. Citation Styles

### V1

Support:

- APA 7
- MLA 9
- Chicago
- IEEE
- Harvard
- Vancouver

### V2

Integrate the CSL ecosystem for broad citation-style support.

---

# 16. Automatic Bibliography

Whenever the user inserts a citation, the reference list automatically updates.

Example:

```text
References

[1] Vaswani, A. et al. (2017).
    Attention Is All You Need.

[2] Devlin, J. et al. (2018).
    BERT: Pre-training of Deep Bidirectional
    Transformers for Language Understanding.
```

Deleting a citation should automatically remove its unused bibliography entry.

---

# 17. DOI Support

Users should be able to paste a DOI.

The system should automatically retrieve metadata.

Supported identifiers:

- DOI
- arXiv ID
- PMID

The user should be able to preview metadata before adding it.

---

# 18. BibTeX Support

### Import

```text
.bib
```

### Export

```text
.bib
```

This makes the project useful for researchers already using LaTeX/Zotero workflows.

---

# 19. Research Search

Do not build your own academic database initially.

Create a provider abstraction:

```text
ResearchProvider
       │
       ├── Provider A
       ├── Provider B
       └── Provider C
```

Search example:

```text
"small language models"
```

Results should allow users to:

- Read
- Save
- Cite
- Add to project
- Ask AI

### Default Providers

**OpenAlex + Crossref + arXiv + Semantic Scholar** are the natural v1 defaults for the `ResearchProvider` abstraction — all license-compatible with an open-source project and free for typical individual-researcher usage.

**Caveat to design around:** OpenAlex introduced usage-based API pricing in February 2026. Basic use and single-record lookups stay free; heavier querying (bulk/high-volume) now costs money. "Free provider" is therefore a moving target, not a permanent assumption:

- Cache provider responses (metadata rarely changes) to keep per-user query volume low.
- Surface provider status/quota in Settings so a self-hoster on the free tier can see when they're approaching a paid threshold, rather than hitting a silent rate limit.
- Keep the abstraction genuinely swappable — if OpenAlex terms change again, a different provider should be a config change, not a code change.

---

# 20. Literature Review Assistant

User selects multiple papers and asks:

> Create a literature review matrix.

Example:

| Paper | Method | Dataset | Results | Limitations |
|---|---|---|---|---|
| Paper A | Transformer | Dataset X | 91% | Small dataset |
| Paper B | CNN | Dataset Y | 89% | High compute |
| Paper C | Hybrid | Dataset X | 94% | Limited evaluation |

Every cell should have a source reference.

---

# 21. Research Gap Assistant

This can make the project substantially more interesting.

The system analyzes:

- Research questions
- Methods
- Datasets
- Limitations
- Results
- Future work

Then produces:

```text
Potential Research Gaps

Gap #1

Existing studies evaluate X primarily on dataset A.

Missing:
Evaluation on dataset B.

Evidence:
Paper 1 → limitation
Paper 2 → future work
Paper 3 → dataset limitation

Confidence: Medium
```

### Important

The system must say:

> **Potential research gap**

not:

> **This is definitely a research gap.**

The researcher must verify it manually.

### v1 Scope — Be Explicit About What's Buildable

Full "judge whether a gap is non-trivial and genuinely unaddressed" is closer to an open NLP research problem than a shippable v1 feature, and the "Confidence: Medium" label implies a calibration system that doesn't yet exist. Do not let Phase 2 imply this and claim verification (§25) are equally tractable — they aren't.

**v1 (buildable, ships in Phase 2 as originally planned):**
- Flag sentences/claims across the selected papers with **zero supporting citation** — a mechanical, high-precision check.
- Surface explicit **author-stated limitations and "future work"** language verbatim-adjacent (paraphrased) from the papers themselves — this is extraction, not judgment.
- Present these as raw evidence ("3 papers flag this as a limitation") without a confidence score.

**Not v1 (deferred until a real calibration/eval dataset exists, per §43):**
- Any claim that a gap is "non-trivial" or "genuinely unaddressed" in the wider literature.
- The "Confidence: Medium/High" label — do not ship a confidence score until it's backed by the evaluation methodology in §43's Research Gap Detection subsection.

---

# 22. AI Editing

Select text and choose:

- Improve clarity
- Make academic
- Simplify
- Shorten
- Expand
- Fix grammar
- Improve flow
- Translate
- Explain

The original text should never be destroyed automatically.

Use:

```text
Original → Suggested → Accept / Reject
```

---

# 23. AI Outline Generator

User:

> Create an outline for a research paper about efficient LLM inference.

Output:

```text
1. Introduction
2. Background
3. Related Work
4. Methodology
5. Experimental Setup
6. Results
7. Discussion
8. Limitations
9. Conclusion
```

User can regenerate or manually modify the outline.

---

# 24. Research Paper Review

A review engine should analyze:

### Structure

- Missing sections
- Poor organization
- Repetition

### Citations

- Unsupported claims
- Missing citations
- Citation mismatch

### Writing

- Grammar
- Clarity
- Academic tone

### Argumentation

- Weak claims
- Contradictions
- Unsupported conclusions

### Sources

- Low-quality sources
- Outdated sources
- Claims that need stronger evidence

---

# 25. Claim Verification

Example:

> "Transformer models require less computational power than CNNs."

The system flags:

```text
⚠ Potentially unsupported claim

No supporting citation detected.

Suggested action:
Find supporting sources
```

If a citation exists:

```text
✓ Citation found

Support strength: Moderate

Source:
Relevant paper
Page 7
```

### v1 Scope

Ship the **"no supporting citation detected"** flag first — this is mechanical and reliable. "Support strength: Moderate/Strong" scoring is a Phase 2+ feature, gated on the evaluation work in §43, for the same reason confidence scoring is deferred in §21.

---

# 26. Source Traceability

Every important AI-generated research claim should ideally contain:

```text
Claim
 ↓
Source
 ↓
Paper
 ↓
Page
 ↓
Relevant passage
```

Example:

```text
AI statement

"Method X improves accuracy by 12%."

Source
↓
Paper XYZ
↓
Page 8
↓
Results section
```

This is one of the most important trust features.

### 26a. Multi-Source Attribution (resolves the single-fact-lookup limitation)

§32's RAG pipeline (chunk → retrieve → LLM → cite) works cleanly for single-fact lookup, but a large share of real academic writing assistance is **synthesizing multiple papers into one sentence** — the pipeline as described doesn't say how attribution works then. This is foundational to §46's core differentiator claim, not an edge case, so it's resolved here rather than left implicit:

**Attribution granularity rule:** citations attach at the **clause level**, not just the sentence level, whenever a sentence synthesizes more than one source.

- *Single source, whole sentence* → one citation at sentence end, as today.
- *Multiple sources, one synthesized sentence* → each clause carries its own citation marker as soon as its content stops being supported by the previous clause's source. Example: *"Method X improves accuracy by 12% [1], though this gain shrinks on smaller datasets [2]."* — two clauses, two sources, two markers, not one citation covering the whole sentence.
- *A synthesized claim with no single source supporting the combination* (i.e., the AI's synthesis itself, not any one paper) → the AI must label this explicitly as **AI inference**, distinct from source-supported content, consistent with §33 Rule 4. Example: *"Together, these results suggest a trade-off between accuracy and dataset size [1][2] — a pattern not stated directly in either paper (AI inference)."*
- **Decline-to-synthesize threshold:** if the AI cannot cleanly attribute which part of a synthesized sentence comes from which source, it must not silently merge them into a single unlabeled claim. Default behavior is to either (a) split the synthesis into separately-cited component claims, or (b) explicitly flag the merged claim as AI inference per §33 Rule 3/4. It should never present a multi-source synthesis as if it were a single source's direct claim.

This rule applies uniformly across autocomplete (§9), research chat (§13), and AI editing (§22) — anywhere the AI generates source-grounded prose.

---

# 27. Export

### V1

- `.docx`
- `.pdf`
- `.md`
- `.bib`

### V2

- `.tex`
- `.html`

The exported document should preserve:

- Formatting
- Citations
- Bibliography
- Headings
- Tables
- Equations

---

# 28. Local AI Support

Users should not be forced to use a proprietary AI API.

Support configurable providers:

```text
AI Provider

○ OpenAI-compatible API
○ Ollama
○ Local model
○ Custom endpoint
```

Use a common interface:

```text
LLMProvider
├── OpenAICompatible
├── Ollama
└── Custom
```

This makes the platform model-agnostic.

---

# 29. Recommended Architecture

```text
                    ┌───────────────┐
                    │   Frontend    │
                    │   Web App     │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │   API Layer   │
                    └───────┬───────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
   ┌────────────┐    ┌─────────────┐   ┌─────────────┐
   │ Documents  │    │ AI Service  │   │ Research    │
   │ Service    │    │             │   │ Service     │
   └─────┬──────┘    └──────┬──────┘   └──────┬──────┘
         │                   │                  │
         ▼                   ▼                  ▼
   ┌───────────┐      ┌────────────┐     ┌────────────┐
   │ PostgreSQL│      │ Vector DB  │     │ Academic   │
   │           │      │            │     │ APIs       │
   └───────────┘      └────────────┘     └────────────┘
```

---

# 30. Suggested Tech Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- Tiptap

### Backend

- Python
- FastAPI

### Database

- PostgreSQL

### Vector Search

Start with:

**pgvector**

rather than introducing a separate vector database.

### Background Jobs

- Redis
- Celery or equivalent

### PDF Processing

Use established PDF parsing libraries.

### Citation

Use the **CSL ecosystem** for citation formatting.

### Authentication

Support:

- Email/password
- OAuth later

---

# 31. Data Model

### Revision note (v2)

The v1 model in §38 is single-owner (User → Project). Phase 3 (§38) promises team workspaces, which almost always means **projects owned by a team**, with role-based permissions on shared papers — not owned by a single user. Building v1 with `Project.user_id` as a hard foreign key makes that migration painful later (every query, permission check, and URL scheme has to change).

**The fix costs nothing extra to build in v1** and avoids the migration: introduce an `Owner` indirection now, even though only `User`-type owners exist until Phase 3.

Core entities:

```text
Owner (polymorphic: "user" today, "team" from Phase 3)
 └── Projects
       ├── Documents
       ├── Papers
       ├── Collections
       └── Chats

User
 ├── owns → Owner (type="user", 1:1 in v1)
 └── Settings
```

### Project

```text
Project
- id
- owner_id       -- FK to Owner, not directly to User
- owner_type     -- "user" | "team" (only "user" populated pre-Phase 3)
- name
- created_at
```

### Document

```text
Document
- id
- project_id
- title
- content
- created_at
- updated_at
```

### Paper

```text
Paper
- id
- project_id
- title
- authors
- abstract
- doi
- year
- pdf_path
- metadata
- extraction_status   -- e.g. "ok" | "unverified" (see §11a)
```

### Citation

```text
Citation
- id
- document_id
- paper_id
- position
- citation_style
- attribution_scope   -- "sentence" | "clause" (see §26a)
```

### Membership (schema reserved now, enforced from Phase 3)

```text
Membership
- id
- owner_id     -- the team-type Owner
- user_id
- role         -- "owner" | "editor" | "viewer" (values used starting Phase 3)
```

Reserving this table now — even unused until Phase 3 — means v1 authorization logic can be written as "does this user have a Membership granting access to this Owner" from day one, instead of a single-user shortcut that has to be rewritten later.

---

# 32. AI/RAG Pipeline

The AI system should use a RAG architecture:

```text
PDF
 ↓
Text extraction
 ↓
Section detection
 ↓
Chunking
 ↓
Embeddings
 ↓
Vector database
 ↓
Semantic search
 ↓
Relevant passages
 ↓
LLM
 ↓
Answer
 ↓
Citation mapping
```

Each chunk should retain metadata:

```text
paper_id
page_number
section
paragraph
chunk_id
```

This allows the application to show where an answer came from.

---

# 33. Hallucination Prevention

The system should implement strict rules.

### Rule 1

Never invent a citation.

### Rule 2

Never claim that a paper says something unless the retrieved content supports it.

### Rule 3

If evidence is insufficient:

```text
Insufficient evidence found in your sources.
```

### Rule 4

Distinguish:

```text
Source-supported
AI inference
General knowledge
```

### Rule 5

Allow users to inspect the evidence.

---

# 34. Security & Privacy

Because users may upload unpublished research, privacy is critical.

### Requirements

- Encrypt data in transit.
- Encrypt sensitive data at rest.
- Secure authentication.
- Per-user authorization.
- Project-level access control.
- Secure file storage.
- Validate uploaded files.
- Restrict file types.
- Prevent path traversal.
- Rate-limit APIs.
- Sanitize editor content.
- Never expose another user's documents.

### Local-first option

Users should be able to run:

```text
OpenResearch locally
+
Local LLM
+
Local database
+
Local PDF storage
```

with no cloud dependency.

### 34a. Retention, Deletion & Training Policy

§34 covers encryption but not what happens to the data afterward — usually the *first* question a researcher asks before uploading unpublished work, and the doc itself flags this content as sensitive. This must be an explicit, published policy, not silence:

- **Deletion:** deleting a project or paper deletes the source PDF, extracted text, embeddings, and chat history referencing it within a stated window (e.g. 30 days, covering backup rotation) — not just a soft "hide from UI" flag.
- **Training:** uploaded content and chat history are **never used to train or fine-tune any model**, hosted or default-bundled, by default. If a future opt-in analytics/training program is ever introduced, it must be explicit opt-in, off by default, and disclosed per-instance (a self-hosted instance's policy is the operator's choice, not Anthropic's or OpenResearch's).
- **Third-party LLM calls:** when a hosted provider (§28) is used, the request payload sent to that provider (paper excerpts, chat text) is governed by that provider's own data policy — this should be surfaced to the user in-product ("This message will be sent to [Provider]") rather than left implicit, especially for OpenAI-compatible hosted APIs.
- **Local-first is the strongest privacy answer** the product has (§34's local-first option) — it should be presented as the default recommendation for unpublished/sensitive research, not an equal alternative buried in Settings.

### 34b. Copyright & Legal Posture (stored/served extracted text)

Storing and re-serving extracted text from copyrighted, often paywalled academic PDFs at multi-tenant scale is a **legal question distinct from infra security**, and needs an explicit position rather than silence:

- **Scope the claim:** OpenResearch stores extracted text/embeddings *for the uploading user's own research use* (comparable to a personal reference manager), not as a public-facing document repository. Extracted full text of a paper should not be servable to a different user who did not upload it, even within the same self-hosted instance, unless that user also has independent access rights.
- **No redistribution feature.** v1 should not ship any feature that lets one user's uploaded PDF become readable/downloadable by another user who didn't upload it — this is a product-design constraint on §7's project model, not just a legal footnote.
- **Publish a plain-language statement** (in `docs/`, per §35) telling users what "upload a paywalled PDF for your own AI-assisted analysis" means for them legally, and recommending they only upload papers they have legitimate access to. This isn't a substitute for actual legal review before a hosted public launch — flag that review as a launch blocker, not a nice-to-have.

---

# 35. Open-Source Philosophy

The project should be genuinely open source.

Suggested repository:

```text
openresearch/
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── editor/
│   ├── citations/
│   ├── research/
│   └── ai/
│
├── infrastructure/
├── docs/
├── tests/
└── README.md
```

Include:

- Setup instructions
- Architecture documentation
- API documentation
- Contribution guide
- Development guide
- Security policy
- Roadmap

### 35a. License Decision (was previously unstated)

§35 has conviction about openness but never named a license — a bigger gap than it looks, because it's the difference between "genuinely open" and "open now, capturable later."

**Decision: AGPL-3.0** for `apps/` and `packages/` (the core product).

Reasoning:
- MIT/Apache-2.0 are genuinely open, but nothing stops a well-resourced competitor from taking the code, hosting it, and out-marketing the original while contributing nothing back.
- AGPL-3.0 is still OSI-approved and genuinely open source — it doesn't restrict use, modification, or self-hosting in any way — but it requires anyone who runs a **modified version as a network service** to publish their changes too. This directly protects against a fork-and-hide-behind-a-SaaS-wrapper outcome, which is the realistic threat to a project like this.
- **Known limit, stated honestly:** AGPL is not bulletproof. MongoDB was already AGPL-licensed and still moved to the stricter, non-open-source SSPL in 2018, specifically because cloud providers found ways to offer it as a hosted service without collaborating back. AGPL is the right trade-off *for a project this size*, not a permanent guarantee — revisit if OpenResearch reaches MongoDB-scale cloud-provider interest.
- **Non-core assets** (docs, brand assets, example configs) can use a permissive license (CC-BY / MIT) since there's no capture risk there.

This decision should be written into `LICENSE` and `docs/` before the first public commit, not added later — retrofitting a license after contributors have already submitted code under an unstated default is a real headache (requires contributor sign-off or relicensing).

### 35b. Funding Model (was previously unstated)

PDF processing, embeddings, and per-message LLM calls are not free at any real scale. §28 supports both local models and hosted APIs, but nothing in this spec says **who pays for a hosted instance**, or whether an official hosted instance exists at all. Without an answer here, the "1,000+ research papers" performance target (§41) is a funding question before it's an engineering one — the answer determines whether the target is about local-hardware efficiency, hosted-infra cost, or both.

**Decision: local-first is the funded default; hosting is optional and separately monetized.**

- **v1 ships with zero required hosted costs for a self-hoster**: local LLM (Ollama), local database, local PDF storage, and free-tier research providers (§19) at typical individual usage. Anyone can run OpenResearch at no ongoing cost beyond their own hardware.
- **An official hosted instance (if one launches) is a separate, later decision** — not a v1 requirement — and would need its own pricing model (e.g. free tier with rate limits + paid tier for heavier LLM/embedding usage) to cover its own hosted-API and infra costs. This specification does not commit to building or operating one; it commits to not *requiring* one.
- **Community/instance operators bear their own hosted-API costs** if they choose to run a shared instance with a hosted LLM provider — this should be called out in `docs/` deployment guidance so an operator doesn't discover a large API bill after the fact.
- Re-scope §41's "1,000+ research papers" target explicitly as a **local-hardware and self-hosted-infra performance target**, not an assumption about a funded hosted service that doesn't yet exist.

---

# 36. MVP

Do not build everything initially.

### MVP should contain:

#### Writing

- Rich text editor
- Documents
- Autosave
- Basic formatting

#### Research

- PDF upload
- PDF reader
- Research library
- PDF search

#### AI

- AI chat
- Ask questions about papers
- AI autocomplete
- AI editing

#### Citations

- DOI lookup
- Citation insertion
- APA/IEEE/MLA
- Automatic bibliography

#### Export

- DOCX
- PDF
- Markdown

That is enough to create a genuinely useful first release.

---

# 37. Phase 2

Add:

- Literature review matrix
- Research-gap assistant
- Claim verification
- Source-quality analysis
- Zotero integration
- BibTeX
- More citation styles
- Browser extension
- Better semantic search

---

# 38. Phase 3

Add:

- Real-time collaboration
- Comments
- Version history
- Team workspaces
- Advanced paper discovery
- Research graphs
- Self-hosting installer
- Plugin system

---

# 39. UI/UX Direction

The interface should feel like a combination of:

**Notion + Google Docs + Zotero + AI research assistant**

but significantly simpler.

### Layout

```text
┌───────────────────────────────────────────┐
│ OpenResearch             Search    User   │
├────────────┬──────────────────────────────┤
│            │                              │
│ Project    │                              │
│            │       Research Paper         │
│ Documents  │                              │
│            │       ──────────────         │
│ Library    │                              │
│            │       Content...             │
│ Citations  │                              │
│            │                              │
│ AI Chat    │                              │
│            │                              │
└────────────┴──────────────────────────────┘
```

Keep the UI:

- Minimal
- Fast
- Clean
- Academic
- Low visual noise
- Keyboard-friendly

---

# 40. Key Keyboard Shortcuts

```text
Ctrl/Cmd + S        Save
Ctrl/Cmd + Z        Undo
Ctrl/Cmd + Shift Z  Redo
Ctrl/Cmd + F        Find
Ctrl/Cmd + /        AI assistance
@                   Citation search
```

---

# 41. Performance Requirements

The application should remain responsive with:

- 100+ documents
- 1,000+ research papers
- Large research projects
- Long documents

PDF processing should happen asynchronously.

Example:

```text
Upload PDF
    ↓
Processing...
    ↓
Metadata extracted
    ↓
Text extracted
    ↓
Embeddings generated
    ↓
Ready
```

The UI should never freeze while processing.

---

# 42. Testing

### Unit tests

Test:

- Citation formatting
- Metadata extraction
- Document operations
- Search
- RAG retrieval
- AI response parsing

### Integration tests

Test:

```text
Upload PDF
→ extract
→ index
→ search
→ AI answer
→ citation
```

### E2E tests

Test the complete researcher workflow.

---

# 43. AI Evaluation

Do not evaluate the AI only by asking:

> "Does the answer sound good?"

Measure:

### Retrieval

- Recall@K
- Precision@K

### Citations

- Citation correctness
- Citation completeness
- Citation relevance

### Generation

- Faithfulness
- Groundedness
- Answer relevance

### Research gap detection

Evaluate whether proposed gaps are:

- Supported by literature
- Non-trivial
- Not obvious contradictions
- Actually absent from the selected literature

---

# 44. Success Metrics

### Product

- Time from PDF upload → usable research context
- Citation insertion time
- Documents created
- Papers added
- AI questions asked
- Exported papers

### Quality

- Citation correctness > 95% target
- Low unsupported-claim rate
- High retrieval relevance

Exact targets should be established through benchmarking rather than assumed.

### Open-Source Health (was previously untracked)

§35's stated goal is being "genuinely open source" — but every metric above is a product-usage number. For a project whose value proposition is openness, these are arguably just as important, and should be tracked from v1:

- Contributor count (unique PR authors, not just commits)
- Self-hosted deployment count (opt-in, anonymized telemetry ping only — never required, and disclosed per §34a's policy)
- External packages/forks depending on `packages/*`
- Issue response time and PR merge time (health-of-community signals, not vanity metrics)

---

# 45. Biggest Technical Risks

### Risk 1 — AI hallucination

**Solution:** strict RAG + citation verification.

### Risk 2 — Bad PDF extraction

**Solution:** preserving page/section metadata tells you where a bad extraction came from, not how to avoid one — the actual mitigation is naming a real extraction pipeline (§11a: GROBID as default, with a separate table/equation path) and marking low-confidence sections as "unverified extraction" so downstream AI answers decline to cite from them (§33 Rule 3).

### Risk 3 — Poor retrieval

**Solution:** hybrid search:

```text
Keyword search
+
Semantic search
+
Metadata filtering
```

### Risk 4 — Citation errors

**Solution:** use established bibliographic metadata and CSL rather than implementing citation formatting manually.

### Risk 5 — Scope explosion

**Solution:**

> Build the **research writing loop** first.

Do not try to recreate every feature of Jenni immediately.

---

# 46. Final MVP Definition

The first release should answer one question:

> **Can a student upload their research papers, understand them, write a paper, cite those papers, and export the final document without constantly switching applications?**

If yes, the MVP succeeds.

The ideal first version is therefore:

```text
              OpenResearch

       ┌───────────────────────┐
       │      PDF Library      │
       └───────────┬───────────┘
                   ↓
       ┌───────────────────────┐
       │      AI Research      │
       │         Chat          │
       └───────────┬───────────┘
                   ↓
       ┌───────────────────────┐
       │    Academic Editor    │
       └───────────┬───────────┘
                   ↓
       ┌───────────────────────┐
       │  Citations + Sources  │
       └───────────┬───────────┘
                   ↓
       ┌───────────────────────┐
       │     Export Paper      │
       └───────────────────────┘
```

## Core Differentiator

The strongest differentiator should be **source traceability**:

> Every important AI-generated research claim should lead the user back to the actual paper, page, and relevant passage.

This makes OpenResearch more than a generic "ChatGPT + PDF upload" application. It becomes a transparent, source-grounded academic research environment.

---

# 48. Accessibility Requirements (was previously absent)

§3 names professors and labs as named users, and universities frequently **require WCAG/VPAT conformance** for procured software — omitting this isn't just an ethics gap, it's a distribution blocker for the institutional-adoption path.

**v1 requirement: WCAG 2.1 AA conformance**, specifically:

- Full keyboard operability for the editor, citation search (`@`), AI chat, and PDF reader — not just the shortcuts listed in §40, but tab order, focus visibility, and no keyboard traps.
- Screen-reader support for the editor (via the underlying rich-text framework's ARIA support), the citation picker, and AI-generated suggestions (suggestions must be announced, not just visually inserted).
- Color contrast ≥ 4.5:1 for body text in both light and dark themes (see the companion UI/UX Guidelines document for the actual palette).
- PDF reader: text selection and highlighting must work with assistive tech, and extracted-text mode (from §11a) should be the default reading surface for screen-reader users rather than relying on rendering the raw PDF.
- A `VPAT`-style accessibility conformance statement should live in `docs/`, maintained alongside the security policy from §35, since it's the artifact universities' procurement processes actually ask for.

Treat this as a v1 requirement, not a "nice to have added later" — retrofitting accessibility into a rich-text editor and custom widgets after the fact is materially more expensive than building it in.

---

# 49. Internationalization (i18n) Scope

§22's AI "Translate" action is not an i18n strategy on its own — it translates content, not the product. Scope this explicitly rather than leaving it implicit:

**v1 (in scope):**
- UI string externalization from day one (even if only English ships at launch) — i.e., no hard-coded strings in components — so adding a locale later is a translation task, not a refactor.
- Unicode-correct handling throughout (author names, non-Latin titles, diacritics) in citation formatting and the editor, since academic sources are frequently non-English.

**Not v1 (explicitly deferred, stated so it isn't assumed "already handled"):**
- Non-English UI localization (translated interface).
- Multilingual semantic retrieval (embeddings tuned for cross-lingual search).
- Non-Latin citation style conventions (e.g., name-ordering conventions that differ from APA/MLA defaults).

The AI "Translate" editing action (§22) remains useful as a writing aid regardless of this scoping — it's a content feature, not a substitute for the product-level i18n work above.

---

# 47. Development Principles

1. **Source-grounded over fluent.**
2. **Open-source over vendor lock-in.**
3. **Local-first where practical.**
4. **Researcher remains in control.**
5. **Never fabricate citations.**
6. **Every important claim should be traceable.**
7. **Keep the MVP focused.**
8. **Use existing standards instead of reinventing them.**
9. **Measure AI quality with real evaluation datasets.**
10. **Build the research workflow before adding collaboration or social features.**
