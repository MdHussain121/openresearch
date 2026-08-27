# Contributing to OpenResearch

Thank you for your interest in contributing to **OpenResearch** â€” the open-source AI academic research and writing assistant!

## 1. Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please be respectful, constructive, and collaborative.

## 2. Licensing

OpenResearch uses a dual-licensing structure (Spec Â§35a):
- **Core Applications & Packages (`apps/`, `packages/`)**: Licensed under **GNU Affero General Public License v3.0 (AGPL-3.0)**. Any modifications deployed as a network service must also be made available under the AGPL-3.0.
- **Documentation & Non-code Assets (`docs/`, brand assets, configurations)**: Licensed under **CC-BY-4.0 / MIT**.

By contributing, you agree that your contributions will be licensed under these respective licenses.

## 3. Architecture & Repository Structure

OpenResearch is structured as a monorepo:

```text
openresearch/
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ web/               # Next.js web application (App Router, Tailwind, TypeScript)
â”‚   â””â”€â”€ api/               # FastAPI Python backend (PostgreSQL, pgvector, Celery)
â”œâ”€â”€ packages/
â”‚   â”œâ”€â”€ tokens/            # Design tokens & CSS custom properties
â”‚   â”œâ”€â”€ editor/            # Tiptap academic editor extensions & utilities
â”‚   â”œâ”€â”€ citations/         # Citation formatting, CSL stubs, BibTeX handling
â”‚   â”œâ”€â”€ research/          # ResearchProvider abstraction (OpenAlex, Crossref, arXiv, etc.)
â”‚   â””â”€â”€ ai/                # LLMProvider abstraction (OpenAI, Ollama, Custom)
â”œâ”€â”€ infrastructure/        # Docker Compose configs (Postgres, Redis, Grobid)
â”œâ”€â”€ docs/                  # Architectural specs, product spec, UX guidelines, policies
â””â”€â”€ tests/                 # End-to-end and integration tests
```

## 4. Development Principles

1. **Source-grounded over fluent**: Never fabricate citations or claims.
2. **Design-token discipline**: Never hard-code hex values; use CSS custom properties from `packages/tokens`.
3. **i18n String Hygiene**: Externalize all UI strings in `apps/web/src/i18n/strings.json` from day one (Â§49).
4. **Accessibility (WCAG 2.1 AA)**: Ensure all interactive components have proper keyboard navigation and ARIA support (Â§48).
5. **Polymorphic Ownership**: Maintain the `Owner` / `Membership` abstraction in all database models (Â§31).

## 5. Getting Started

### Prerequisites
- Node.js >= 18.0.0, npm >= 9.0.0
- Python >= 3.11
- Docker & Docker Compose (for PostgreSQL + pgvector and Redis)

### Setup
```bash
# Clone the repository
git clone https://github.com/openresearch-org/openresearch.git
cd openresearch

# Install frontend & monorepo dependencies
npm install

# Setup backend virtual environment
cd apps/api
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate
pip install -r requirements.txt
```

### Running Tests
```bash
# Frontend typecheck & lint
npm run typecheck
npm run lint

# Backend tests
cd apps/api
pytest
```
