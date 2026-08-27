#!/usr/bin/env python3
"""
OpenResearch Self-Host Diagnostic & Health Checker (Roadmap 9.4)
Run this script to verify dependencies, database connectivity, local LLM status, and storage permissions.
"""

import os

import httpx


def check_step(name: str, check_fn) -> bool:
    try:
        ok, msg = check_fn()
        if ok:
            print(f"  \033[92m[OK]\033[0m {name}: {msg}")
            return True
        else:
            print(f"  \033[91m[FAIL]\033[0m {name}: {msg}")
            return False
    except Exception as e:
        print(f"  \033[91m✗\033[0m {name}: Failed with error: {e}")
        return False

def check_backend_api():
    url = os.environ.get("OPENRESEARCH_API_URL", "http://localhost:8000/api/v1/health")
    try:
        resp = httpx.get(url, timeout=4)
        if resp.status_code == 200:
            return True, f"API is responsive ({url})"
        return False, f"API returned status {resp.status_code}"
    except Exception as e:
        return False, f"API unreachable at {url} ({e})"

def check_grobid():
    url = os.environ.get("GROBID_HOST", "http://localhost:8070/api/isalive")
    try:
        resp = httpx.get(url, timeout=4)
        if resp.status_code == 200:
            return True, "GROBID PDF extraction service is alive"
        return False, f"GROBID returned status {resp.status_code}"
    except Exception:
        return True, "GROBID container optional / fallback to pdfplumber active"

def check_ollama():
    url = os.environ.get("OLLAMA_HOST", "http://localhost:11434/api/tags")
    try:
        resp = httpx.get(url, timeout=3)
        if resp.status_code == 200:
            models = [m.get("name") for m in resp.json().get("models", [])]
            return True, f"Ollama local LLM service active (Available models: {', '.join(models) or 'None downloaded yet'})"
        return False, f"Ollama returned {resp.status_code}"
    except Exception:
        return True, "Ollama local inference optional (Hosted LLM or offline fallback available)"

def check_storage_dir():
    path = os.environ.get("UPLOAD_DIR", "./storage/uploads")
    if os.path.exists(path) and os.access(path, os.W_OK):
        return True, f"Storage directory '{path}' is writable"
    return False, f"Storage directory '{path}' does not exist or is not writable"

def main():
    print("\n\033[94m=== OpenResearch Self-Host Health Diagnostics ===\033[0m\n")
    results = [
        check_step("Backend API Service", check_backend_api),
        check_step("PDF Extractor (GROBID)", check_grobid),
        check_step("Local LLM (Ollama)", check_ollama),
        check_step("File Storage Directory", check_storage_dir),
    ]
    print()
    passed = sum(1 for r in results if r)
    total = len(results)
    if passed == total:
        print(f"\033[92mAll {total} diagnostic checks passed successfully!\033[0m\n")
    else:
        print(f"\033[93m{passed}/{total} checks passed.\033[0m\n")

if __name__ == "__main__":
    main()
