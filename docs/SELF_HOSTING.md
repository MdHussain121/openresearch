# OpenResearch Self-Hosting Guide

**Version:** 1.0 (Phase 9 Release)  
**License:** AGPL-3.0-or-later for code, CC-BY-4.0 for documentation.

---

## 1. Overview

OpenResearch is architected as a **local-first, fully sovereign research platform** (Spec §34, §35b). You can host your own instance on your local laptop, a lab server, or institutional infrastructure with **zero required recurring cloud costs**.

### Key Capabilities
- **Local-First AI:** Run LLM completions and embeddings locally via Ollama with no data leaving your machine.
- **Self-Hosted PDF Extraction:** Structured TEI-XML extraction of academic papers via GROBID.
- **Role-Based Team Workspaces:** Multi-user lab collaboration with `owner`, `editor`, and `viewer` roles.
- **Modular Plugin Extensibility:** Extend research providers, export transformers, and AI backends under clean AGPL-3.0 interfaces.

---

## 2. System & Hardware Requirements

| Component | Minimum | Recommended (with Local LLM) |
|---|---|---|
| **CPU** | 2 cores (x86_64 or Apple Silicon) | 8+ cores (Intel/AMD or Apple M1/M2/M3) |
| **RAM** | 4 GB | 16 GB - 32 GB |
| **GPU** | Optional | NVIDIA RTX 3060+ (8GB+ VRAM) or Apple Unified Memory |
| **Disk** | 10 GB SSD | 50 GB+ NVMe SSD (for papers and embeddings) |
| **OS** | Linux (Ubuntu/Debian), macOS, Windows 10/11 | Linux (Ubuntu 22.04 LTS / 24.04 LTS) |

---

## 3. Near-One-Command Quickstart

### On Linux / macOS:
```bash
git clone https://github.com/openresearch-org/openresearch.git
cd openresearch
chmod +x infrastructure/install.sh
./infrastructure/install.sh
```

### On Windows (PowerShell):
```powershell
git clone https://github.com/openresearch-org/openresearch.git
cd openresearch
powershell -ExecutionPolicy Bypass -File infrastructure\install.ps1
```

After installation:
- 🌐 **Web Interface:** [http://localhost:3000](http://localhost:3000)
- 📡 **API Documentation:** [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)

---

## 4. Docker Architecture

The self-hosting compose stack (`infrastructure/docker-compose.selfhost.yml`) deploys 6 isolated containers:

```text
┌─────────────────────────────────────────────────────────────┐
│                      Reverse Proxy / Browser                │
└──────────────┬──────────────────────────────┬───────────────┘
               │ (Port 3000)                  │ (Port 8000)
       ┌───────▼────────┐             ┌───────▼────────┐
       │   Web (Next.js)│             │  API (FastAPI) │
       └────────────────┘             └───────┬────────┘
                                              │
              ┌───────────────────┬───────────┴───────────┬──────────────────┐
              │                   │                       │                  │
      ┌───────▼─────────┐ ┌───────▼────────┐      ┌───────▼────────┐ ┌───────▼────────┐
      │ Postgres+pgvector│ │  Redis Queue   │      │     GROBID     │ │     Ollama     │
      │   (Port 5432)   │ │  (Port 6379)   │      │  (Port 8070)   │ │  (Port 11434)  │
      └─────────────────┘ └────────────────┘      └────────────────┘ └────────────────┘
```

---

## 5. Local LLM Setup with Ollama

To run completions 100% offline:
1. Ensure Ollama is running (`docker compose -f infrastructure/docker-compose.selfhost.yml up -d ollama`).
2. Pull your desired model into the container:
   ```bash
   docker exec -it openresearch-selfhost-ollama ollama pull llama3:8b
   ```
3. Set `DEFAULT_LLM_PROVIDER=ollama` and `OLLAMA_MODEL=llama3:8b` in your `.env.selfhost`.

---

## 6. Backup & Data Sovereign Retention (Spec §34a)

All user data, papers, and embeddings reside in persistent Docker volumes:
- `openresearch_pgdata`: Relational database and vector embeddings.
- `openresearch_storage`: Uploaded PDF files, extracted metadata, and exported artifacts.

### To Create a Backup:
```bash
docker exec -t openresearch-selfhost-db pg_dump -U openresearch openresearch > openresearch_backup_$(date +%F).sql
tar -czvf storage_backup_$(date +%F).tar.gz storage/
```

### To Restore:
```bash
cat openresearch_backup.sql | docker exec -i openresearch-selfhost-db psql -U openresearch -d openresearch
tar -xzvf storage_backup.tar.gz
```

---

## 7. Diagnostics & Troubleshooting

Run the built-in diagnostic tool to verify all services:
```bash
python infrastructure/healthcheck.py
```
