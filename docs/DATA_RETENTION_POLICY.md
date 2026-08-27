# Data Retention, Deletion & AI Training Policy

**Governing Section:** `OpenResearch_Spec.md` §34a

Because researchers frequently upload unpublished manuscripts, grant proposals, and confidential lab notes, OpenResearch provides clear, legally binding guarantees regarding data retention, deletion, and AI model training.

---

## 1. Zero Model Training Guarantee

- **Never Used for Training**: User documents, uploaded PDFs, extracted text, vector embeddings, annotations, and AI chat histories are **never used to train, fine-tune, or align any AI model** (hosted or bundled).
- **Opt-In Only**: Any future community telemetry or evaluation datasets will always be strictly opt-in, disabled by default, and fully anonymized.

---

## 2. Retention & Hard Deletion Policy

- **Hard Deletion**: When a user or team deletes a project, document, or uploaded research paper, the system executes a permanent hard deletion:
  1. Source PDF files are unlinked and permanently removed from storage.
  2. Extracted plain-text and structured XML/JSON are purged from the primary database.
  3. Vector embeddings associated with document chunks are deleted from `pgvector`.
  4. Related chat messages, highlights, and annotations are removed.
- **Backup Window**: Database backups and disaster recovery snapshots retain point-in-time data for a maximum window of **30 days** before automated cryptographic rotation and overwriting.

---

## 3. Third-Party LLM Provider Disclosure

- When using a hosted provider (e.g. OpenAI, Anthropic, or custom endpoints):
  - Request payloads containing document context or chunk excerpts are governed by the respective provider's enterprise data privacy policy (e.g., zero data retention / zero API training terms).
  - OpenResearch surfaces a visible indicator in the UI disclosing the active provider before any text transmission.
- **Local LLM Recommendation**: For highly sensitive, classified, or unpublished intellectual property, OpenResearch explicitly recommends configuring local models via **Ollama** or custom on-premises endpoints (§28).
