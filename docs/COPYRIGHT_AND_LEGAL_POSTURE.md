# Copyright & Legal Posture for Stored PDF Text

**Governing Section:** `OpenResearch_Spec.md` §34b

OpenResearch processes academic literature to enable local, source-grounded synthesis and citation assistance. This document defines the legal posture and architectural boundaries governing stored PDF text and vector embeddings.

---

## 1. Scope of User Rights

1. **Personal / Institutional Research Use**: OpenResearch functions as an AI-powered personal reference manager (analogous to Zotero or Mendeley). Users store and analyze literature for their own legitimate scholarly research and personal study under applicable fair use / fair dealing exceptions.
2. **User Responsibility**: Users should only upload research papers and publications they have lawful access to via open-access licenses, personal purchases, or institutional subscriptions.

---

## 2. Strict Prohibition on Redistribution

1. **No Public Document Repository**: OpenResearch is **not** a public file-sharing service or document repository.
2. **Tenant Isolation**: Extracted full text, figures, and vector embeddings belonging to one user or project are cryptographically and logically isolated. They are never servable or downloadable by any other user on a shared instance who lacks explicit project membership.
3. **No Cross-Tenant Search**: Vector similarity queries are strictly filtered by the authenticated `project_id` and authorized `owner_id`.
