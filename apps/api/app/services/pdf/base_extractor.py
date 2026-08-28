import logging
import os
import re
import uuid
from typing import Any

from .reference_extractor import ReferenceExtractor

logger = logging.getLogger("openresearch.pdf.base_extractor")


SECTION_PATTERNS = [
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:abstract|summary)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:introduction|background|overview)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:related\s+work|prior\s+work|literature\s+review)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:method|methodology|proposed\s+method|approach|model|architecture"
    r"|system\s+design)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:experiment|experiments|experimental\s+setup|evaluation|implementation)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:results|findings|empirical\s+results|analysis)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:discussion|implications|limitations|future\s+work)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:conclusion|conclusions|concluding\s+remarks)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:references|bibliography|works\s+cited)\b",
    r"^(?:(?:\d+\.|\d+\.?\d*)\s*)?(?:acknowledgments?|appendix|supplementary)\b",
]

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


class BaseExtractor:
    def __init__(self):
        self.reference_extractor = ReferenceExtractor()

    def _extract_metadata_from_text(
        self, first_page_text: str, full_text: str, original_filename: str
    ) -> tuple[str, list[dict[str, Any]], str, int | None, str | None, str | None]:
        """Extract title, authors, abstract, year, DOI, and arXiv ID from text heuristics."""
        lines = [line.strip() for line in first_page_text.split("\n") if line.strip()]

        doi = None
        doi_match = re.search(r"\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)\b", full_text)
        if doi_match:
            doi = doi_match.group(1).rstrip(".;,)")

        arxiv_id = None
        arxiv_match = re.search(r"\barXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)\b", full_text, re.IGNORECASE)
        if arxiv_match:
            arxiv_id = arxiv_match.group(1)

        year = None
        year_matches = re.findall(r"\b(19\d\d|20[0-2]\d)\b", first_page_text[:1500])
        if year_matches:
            valid_years = [int(y) for y in year_matches if 1950 <= int(y) <= 2030]
            if valid_years:
                year = valid_years[0]

        abstract = ""
        abstract_match = re.search(
            r"\bAbstract\b[:\s\-\.]*(.+?)(?:\b(?:1\.?\s+|I\.?\s+)?Introduction\b|\bKeywords\b|\bIndex Terms\b|\n\n\n)",
            full_text,
            re.DOTALL | re.IGNORECASE,
        )
        if abstract_match:
            abstract = abstract_match.group(1).strip()
            abstract = re.sub(r"\s+", " ", abstract)

        title = ""
        candidate_lines = []
        for line in lines[:8]:
            if re.search(
                r"^(?:arxiv|preprint|proceedings|journal|ieee|acm|nature|science|springer|elsevier|volume|vol\."
                r"|issue|page|\d+)",
                line,
                re.IGNORECASE,
            ):
                continue
            if re.search(r"\babstract\b", line, re.IGNORECASE):
                break
            candidate_lines.append(line)

        if candidate_lines:
            title = " ".join(candidate_lines[:2]).strip()

        if not title or len(title) < 5:
            if original_filename:
                clean_name = os.path.splitext(os.path.basename(original_filename))[0]
                title = clean_name.replace("_", " ").replace("-", " ").title()
            else:
                title = "Untitled Research Paper"

        authors: list[dict[str, Any]] = []
        author_text_block = ""
        if len(candidate_lines) > 2:
            author_text_block = " ".join(candidate_lines[2:])
        elif len(lines) > 2:
            for line in lines[2:8]:
                if re.search(r"\babstract\b", line, re.IGNORECASE) or re.search(
                    r"\bintroduction\b", line, re.IGNORECASE
                ):
                    break
                if (
                    "@" in line
                    or "university" in line.lower()
                    or "department" in line.lower()
                    or "institute" in line.lower()
                ):
                    continue
                author_text_block += " " + line

        if author_text_block:
            raw_authors = re.split(r"[,;]|\band\b|&", author_text_block)
            for raw in raw_authors:
                cleaned = re.sub(r"[\d\*\†\‡\§\^]", "", raw).strip()
                words = cleaned.split()
                if 1 <= len(words) <= 4 and not any(
                    w.lower()
                    in ["university", "dept", "school", "lab", "email", "abstract", "department"]
                    for w in words
                ):
                    if len(words) == 1:
                        authors.append({"familyName": words[0], "literal": words[0]})
                    else:
                        authors.append(
                            {
                                "givenName": " ".join(words[:-1]),
                                "familyName": words[-1],
                                "literal": cleaned,
                            }
                        )

        if not authors:
            authors = [{"familyName": "Unknown Author", "literal": "Unknown Author"}]

        return title, authors, abstract, year, doi, arxiv_id

    def _segment_sections(self, pages: list[dict[str, Any]], abstract: str) -> list[dict[str, Any]]:
        """Segment paper text into structured sections with headings and page numbers."""
        sections: list[dict[str, Any]] = []

        if abstract:
            sections.append(
                {
                    "id": str(uuid.uuid4()),
                    "title": "Abstract",
                    "page_number": 1,
                    "text": abstract,
                    "confidence": 0.95,
                    "unverified": False,
                }
            )

        current_title = "Introduction"
        current_page = 1
        current_paras: list[str] = []

        for page in pages:
            p_num = page["page_number"]
            text = page["text"]
            lines = text.split("\n")

            for line in lines:
                trimmed = line.strip()
                if not trimmed:
                    continue

                is_heading = False
                matched_heading = None
                for pat in SECTION_PATTERNS:
                    if re.search(pat, trimmed, re.IGNORECASE) and len(trimmed) < 80:
                        is_heading = True
                        matched_heading = trimmed
                        break

                if is_heading and matched_heading:
                    if current_paras:
                        sec_text = "\n\n".join(current_paras).strip()
                        if current_title.lower() != "abstract" and len(sec_text) > 30:
                            sections.append(
                                {
                                    "id": str(uuid.uuid4()),
                                    "title": current_title,
                                    "page_number": current_page,
                                    "text": sec_text,
                                    "confidence": 0.92,
                                    "unverified": False,
                                }
                            )
                    current_title = matched_heading
                    current_page = p_num
                    current_paras = []
                else:
                    current_paras.append(trimmed)

        if current_paras:
            sec_text = "\n\n".join(current_paras).strip()
            if len(sec_text) > 30:
                sections.append(
                    {
                        "id": str(uuid.uuid4()),
                        "title": current_title,
                        "page_number": current_page,
                        "text": sec_text,
                        "confidence": 0.90,
                        "unverified": False,
                    }
                )

        if not sections and pages:
            for p in pages:
                if p["text"].strip():
                    sections.append(
                        {
                            "id": str(uuid.uuid4()),
                            "title": f"Page {p['page_number']}",
                            "page_number": p["page_number"],
                            "text": p["text"].strip(),
                            "confidence": 0.85,
                            "unverified": False,
                        }
                    )

        return sections

    def _calculate_confidence(
        self,
        title: str,
        abstract: str,
        sections: list[dict[str, Any]],
        total_chars: int,
        page_count: int,
    ) -> tuple[float, str]:
        """
        Calculate extraction confidence:
        Checks character density, section presence, title quality.
        Returns: (confidence_score: float, extraction_status: "ok" | "unverified")
        """
        score = 0.0

        if title and title != "Untitled Research Paper" and len(title) > 8:
            score += 0.25

        if abstract and len(abstract) > 60:
            score += 0.25

        if len(sections) >= 2:
            score += 0.25
        elif len(sections) == 1:
            score += 0.10

        avg_chars_per_page = total_chars / max(page_count, 1)
        if avg_chars_per_page > 400:
            score += 0.25
        elif avg_chars_per_page > 150:
            score += 0.15
        elif avg_chars_per_page > 50:
            score += 0.05

        score = round(min(score, 1.0), 2)
        status = "ok" if score >= 0.60 else "unverified"
        return score, status

    def _extract_equations(self, pages_text: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Extract equations from page text."""
        equations: list[dict[str, Any]] = []

        for page in pages_text:
            page_num = page["page_number"]
            text = page["text"]
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

        return equations

    def _extract_references(self, full_text: str) -> list[dict[str, Any]]:
        """Extract references from full document text."""
        return self.reference_extractor.extract(full_text)
