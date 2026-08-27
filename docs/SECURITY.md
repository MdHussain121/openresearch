# Security Policy

OpenResearch treats security and data privacy with utmost priority. Because researchers frequently work with unpublished research and sensitive intellectual property, our architectural baseline emphasizes security and isolation.

## 1. Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x (MVP) | :white_check_mark: |
| < 0.1.0 | :x:                |

## 2. Reporting a Vulnerability

If you discover a security vulnerability in OpenResearch, please **do not open a public issue**. Instead, send a detailed report to our security team:

- **Email**: `security@openresearch.org` (or security contact defined in repo settings)
- Please include:
  1. Description of the vulnerability
  2. Steps to reproduce
  3. Potential impact
  4. Suggested mitigation (if any)

We will acknowledge receipt within 48 hours and provide updates as the fix is developed.

## 3. Core Security Principles (Spec §34)

1. **Local-First Default**: OpenResearch is designed to run entirely locally (local LLM via Ollama, local PostgreSQL, local filesystem storage) without external cloud transmission.
2. **Tenant & Data Isolation**: All documents, PDFs, embeddings, and chat histories belong strictly to an `Owner`. Project-level access controls prevent unauthorized cross-user or cross-project data leakage.
3. **No Unsanitized File Access**: Uploaded PDF files are validated for MIME type, sanitized against path traversal (`../`), and stored with randomized UUID identifiers.
4. **Encryption in Transit & at Rest**: TLS/HTTPS is mandatory in production deployments. Sensitive credentials and API keys are stored securely and never committed to version control.
5. **No Third-Party Training**: User research papers and draft writings are strictly isolated and never used to train foundation models.
