import logging
import re
import uuid
from typing import Any

import anyio
import pdfplumber

from .base_extractor import BaseExtractor

logger = logging.getLogger("openresearch.pdf.pdfplumber_extractor")


MATH_SYMBOLS = [
    "∑", "∫", "∏", "√", "∈", "∀", "∃", "∂", "∇", "≈", "≠", "≤", "≥", "→",
    "λ", "θ", "α", "β", "γ", "σ", "μ", "ω",
]
LATEX_PATTERNS = [
    r"\$([^\$]+)\$",
    r"\\begin\{equation\}(.*?)\\end\{equation\}",
    r"\\begin\{align\}(.*?)\\end\{align\}",
    r"([a-zA-Z_0-9]+\s*=\s*[\d\w\+\-\*\/\(\)\^\_\{\}\\]+)",
]


class PdfplumberExtractor(BaseExtractor):
    def __init__(self):
        super().__init__()

    async def extract(self, file_path: str, original_filename: str = "") -> dict[str, Any]:
        """
        High-fidelity local PDF extraction using pdfplumber:
        - Layout analysis
        - Section detection & segmentation
        - Structured Table extraction (rows/columns)
        - Equation detection (LaTeX or marked 'not text-searchable' with page anchor)
        - Quality confidence score calculation
        """
        return await anyio.to_thread.run_sync(self._extract_sync, file_path, original_filename)

    def _extract_sync(self, file_path: str, original_filename: str = "") -> dict[str, Any]:
        pages_text: list[dict[str, Any]] = []
        tables: list[dict[str, Any]] = []
        equations: list[dict[str, Any]] = []
        all_raw_text: list[str] = []
        total_chars = 0

        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)

            for page_idx, page in enumerate(pdf.pages):
                page_num = page_idx + 1
                text = page.extract_text(layout=True) or page.extract_text() or ""
                pages_text.append({"page_number": page_num, "text": text})
                all_raw_text.append(text)
                total_chars += len(text.strip())

                # 1. Structured Table Extraction (pdfplumber-specific)
                try:
                    raw_tables = page.extract_tables()
                    for t_idx, tbl in enumerate(raw_tables):
                        if tbl and len(tbl) > 0:
                            cleaned_rows = [
                                [(cell.strip() if cell else "") for cell in row]
                                for row in tbl
                                if any(row)
                            ]
                            if len(cleaned_rows) >= 2:
                                headers = cleaned_rows[0]
                                rows = cleaned_rows[1:]
                                caption = f"Table {t_idx + 1} (Page {page_num})"
                                cap_match = re.search(
                                    rf"(Table\s+{t_idx + 1}[:\.\-][^\n]+)", text, re.IGNORECASE
                                )
                                if cap_match:
                                    caption = cap_match.group(1).strip()

                                tables.append(
                                    {
                                        "id": str(uuid.uuid4()),
                                        "page_number": page_num,
                                        "caption": caption,
                                        "headers": headers,
                                        "rows": rows,
                                        "raw_text": "\n".join(["\t".join(r) for r in cleaned_rows]),
                                    }
                                )
                except Exception as ex:
                    logger.debug("Table extraction error on page %s: %s", page_num, ex)

                # 2. Equation Detection (pdfplumber-specific, uses base class constants)
                lines = text.split("\n")
                for line in lines:
                    trimmed = line.strip()
                    if not trimmed:
                        continue

                    is_math = any(sym in trimmed for sym in MATH_SYMBOLS)
                    has_latex = any(re.search(pat, trimmed) for pat in LATEX_PATTERNS)
                    is_numbered_eq = bool(
                        re.search(r"=\s*.*\(\d+\)\s*$", trimmed)
                        or re.search(r"^\(\d+\)\s*.*=", trimmed)
                    )

                    if (is_math or has_latex or is_numbered_eq) and len(trimmed) < 160:
                        is_searchable = bool(
                            has_latex
                            or (
                                len(re.findall(r"[a-zA-Z0-9\+\-\*\/\=\(\)\<\>]", trimmed))
                                > len(trimmed) * 0.7
                            )
                        )

                        latex_repr = trimmed
                        if not latex_repr.startswith("$") and "\\begin" not in latex_repr:
                            latex_repr = f"$${latex_repr}$$"

                        equations.append(
                            {
                                "id": str(uuid.uuid4()),
                                "page_number": page_num,
                                "latex": latex_repr if is_searchable else "",
                                "raw_text": trimmed,
                                "is_text_searchable": is_searchable,
                                "status_label": "LaTeX recovered"
                                if is_searchable
                                else "not text-searchable (image anchor)",
                            }
                        )

        full_doc_text = "\n\n".join(all_raw_text)

        # Use base class methods for metadata, sections, references, confidence
        title, authors, abstract, year, doi, arxiv_id = self._extract_metadata_from_text(
            pages_text[0]["text"] if pages_text else "", full_doc_text, original_filename
        )

        sections = self._segment_sections(pages_text, abstract)
        references = self.reference_extractor.extract(full_doc_text)

        confidence, status = self._calculate_confidence(
            title=title,
            abstract=abstract,
            sections=sections,
            total_chars=total_chars,
            page_count=page_count,
        )

        for sec in sections:
            sec["unverified"] = status == "unverified"

        return {
            "title": title,
            "authors": authors,
            "abstract": abstract,
            "doi": doi,
            "arxiv_id": arxiv_id,
            "pmid": None,
            "year": year,
            "page_count": page_count,
            "extraction_status": status,
            "confidence_score": confidence,
            "sections": sections,
            "tables": tables,
            "equations": equations,
            "references": references,
            "pages": pages_text,
            "source": "local_pdfplumber",
        }
