# OpenResearch — System Architecture

> **Stack:** Next.js 14 (App Router) · FastAPI · SQLAlchemy · PostgreSQL (SQLite in dev) · TipTap Editor · npm Workspaces monorepo

## System Overview

```mermaid
graph TB
    subgraph Client["Browser"]
        UI["Next.js 14 App<br/>apps/web"]
        TIPTAP["TipTap Academic Editor<br/>packages/editor"]
        COLLAB["Collab WebSocket Client"]
    end

    subgraph Packages["Shared Workspace Packages"]
        CITATIONS["@openresearch/citations<br/>BibTeX parser · CSL styles"]
        RESEARCH["@openresearch/research<br/>OpenAlex · Crossref · arXiv · S2"]
        AI_PKG["@openresearch/ai<br/>LLM providers · prompts"]
        TOKENS["@openresearch/tokens<br/>design tokens"]
        UI_PKG["@openresearch/ui<br/>Radix + CVA primitives"]
    end

    subgraph API["FastAPI Backend · apps/api"]
        ROUTERS["API Routers /api/v1<br/>auth · papers · documents · citations<br/>intelligence · teams · versions · zotero"]
        MIDDLEWARE["Middleware<br/>auth (optional in local mode) · correlation IDs · error envelope"]

        subgraph Services["Service Layer"]
            RAG["rag_service<br/>chunking · embeddings · hybrid search"]
            AI_SVC["ai_writing_service<br/>ghost text · SSE streaming"]
            INTEL["intelligence_service<br/>claim verification · research gaps"]
            EXPORT["export service<br/>markdown · docx · pdf · bibtex"]
            PDF["pdf_extractor<br/>GROBID + pdfplumber fallback"]
            CACHE["provider_cache_service<br/>LRU + optional Redis"]
            PLUGINS["plugin_service<br/>AGPL-boundary hooks"]
            ZOTERO["zotero_service"]
        end
    end

    subgraph Infra["External & Storage"]
        DB[("PostgreSQL / SQLite<br/>SQLAlchemy ORM")]
        VEC[("Embeddings<br/>JSON columns (hash vectors)<br/>pgvector-ready · migration pending")]
        GROBID["GROBID<br/>PDF TEI extraction"]
        OLLAMA["Ollama / OpenAI<br/>LLM inference"]
        EXTERNAL["Academic APIs<br/>OpenAlex · Crossref · ArXiv"]
        REDIS["Redis<br/>cache · pub/sub scaling"]
    end

    UI -->|"REST /api/v1"| ROUTERS
    UI -->|"SSE stream"| AI_SVC
    COLLAB -->|"/ws/collaborate/{doc_id}"| MIDDLEWARE

    TIPTAP --> CITATIONS
    UI --> TOKENS
    UI --> UI_PKG
    AI_PKG --> AI_SVC

    ROUTERS --> MIDDLEWARE
    MIDDLEWARE --> Services
    RAG --> DB
    RAG --> VEC
    PDF --> GROBID
    AI_SVC --> OLLAMA
    INTEL --> OLLAMA
    RESEARCH --> EXTERNAL
    CACHE --> REDIS
    ZOTERO -->|"api.zotero.org"| EXTERNAL
    EXPORT --> DB
```

## Data Flow: Grounded Writing Pipeline

```mermaid
sequenceDiagram
    participant U as User (TipTap)
    participant W as Next.js Web App
    participant A as FastAPI
    participant R as RAG Service
    participant L as LLM Provider
    participant D as Database

    U->>W: Types "@citation" / requests continuation
    W->>A: POST /papers/{id}/chat or ghost-text request
    A->>R: hybrid_search(query, project scope)
    R->>D: Embedding similarity over JSON-stored hash vectors + BM25 lexical scoring
    D-->>R: Ranked GroundedPassages
    R->>R: Trust filtering (grounding state per passage)
    A->>L: Prompt with grounded context
    L-->>A: Generated text with citation markers [1]
    A-->>W: SSE stream (text + source_passages)
    W->>U: Ghost text preview with grounding badge
    U->>W: Tab to accept → citation node inserted
```

## Key Architectural Decisions

| Concern | Decision |
|---|---|
| **Polymorphic ownership** | All resources hang off an `Owner` (user or team) via `Membership` rows with role-based access (`owner`/`editor`/`viewer`) |
| **Grounding contract** | Every AI-generated segment carries a `GroundingState`; unverified extractions receive retrieval penalties |
| **Citation integrity** | Citations are first-class `Citation` nodes linking documents ↔ papers with attribution scope (sentence/clause) and page numbers |
| **Chunking** | Papers are segmented into abstract/section/table/equation chunks with sliding-window overlap on long paragraphs; each chunk stores a normalized embedding (currently a JSON column with a hash-based vector — pgvector-ready schema, migration pending) for hybrid retrieval |
| **Local-first auth** | Authentication endpoints exist, but the product runs in single-user local mode where requests resolve to a local workspace user; JWT bearer tokens remain supported for API clients (e.g., the browser extension) but are not required locally |
| **Provider abstraction** | External dependencies (LLMs, academic APIs) sit behind provider interfaces so local models (Ollama) work offline |
| **Plugin boundary** | Plugins execute through typed hooks (`on_paper_extract`, `on_citation_format`, `on_export`) inside the AGPL-3.0 compliance boundary |

## Repository Layout

```text
├── apps/
│   ├── web/                 # Next.js 14 frontend (App Router, Tailwind, Radix)
│   └── api/                 # FastAPI backend (services, models, Alembic migrations)
├── packages/
│   ├── editor/              # TipTap extensions (citations, math, ghost text, trust markers)
│   ├── citations/           # BibTeX parsing + CSL style formatting
│   ├── ai/                  # LLM provider abstraction (OpenAI, Ollama, custom)
│   ├── research/            # Academic metadata providers
│   ├── ui/                  # Shared Radix/CVA component primitives
│   ├── tokens/              # Design tokens (WCAG AA verified)
│   └── plugins/             # Plugin lifecycle types
├── infrastructure/          # Dockerfiles, docker-compose (self-host)
├── docs/                    # product spec, audits, policies, this architecture doc
└── .github/workflows/ci.yml # lint → typecheck → test → build pipeline
```
