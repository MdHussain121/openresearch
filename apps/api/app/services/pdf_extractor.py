import logging
import os
import re
import uuid
from typing import Any

import anyio
import defusedxml.ElementTree as ET

from app.core.config import settings
from app.core.constants import BYTES_PER_MB
from app.core.http_client import get_async_http_client

logger = logging.getLogger("openresearch.pdf_extractor")

# Section heading detection patterns
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

# Math / equation detection heuristics
MATH_SYMBOLS = [
    "∑",
    "∫",
    "∏",
    "√",
    "∈",
    "∀",
    "∃",
    "∂",
    "∇",
    "≈",
    "≠",
    "≤",
    "≥",
    "→",
    "λ",
    "θ",
    "α",
    "β",
    "γ",
    "σ",
    "μ",
    "ω",
]
LATEX_PATTERNS = [
    r"\$([^\$]+)\$",
    r"\\begin\{equation\}(.*?)\\end\{equation\}",
    r"\\begin\{align\}(.*?)\\end\{align\}",
    r"([a-zA-Z_0-9]+\s*=\s*[\d\w\+\-\*\/\(\)\^\_\{\}\\]+)",
]


class PDFExtractionError(Exception):
    pass


class PDFValidator:
    @staticmethod
    def validate_pdf_bytes(content: bytes, max_mb: int = 50) -> None:
        """Validate PDF content against size, magic header, and non-empty structure."""
        if not content:
            raise PDFExtractionError("Uploaded file is empty.")

        max_bytes = max_mb * BYTES_PER_MB
        if len(content) > max_bytes:
            raise PDFExtractionError(
                f"File size ({len(content) / BYTES_PER_MB:.1f} MB) exceeds maximum limit of {max_mb} MB."
            )

        PDFValidator.validate_pdf_header(content)

    @staticmethod
    def validate_pdf_header(head: bytes) -> None:
        """Validate the PDF magic header from an arbitrary leading byte slice."""
        if not head.startswith(b"%PDF-") and b"%PDF-" not in head[:1024]:
            raise PDFExtractionError(
                "Invalid file format: Not a valid PDF document (missing %PDF header)."
            )

    @staticmethod
    def validate_pdf_file(file_path: str, max_mb: int = 50) -> None:
        """Validate an on-disk PDF against size and magic-header constraints."""
        size_bytes = os.path.getsize(file_path)
        if size_bytes == 0:
            raise PDFExtractionError("Uploaded file is empty.")
        max_bytes = max_mb * BYTES_PER_MB
        if size_bytes > max_bytes:
            raise PDFExtractionError(
                f"File size ({size_bytes / BYTES_PER_MB:.1f} MB) exceeds maximum limit of {max_mb} MB."
            )
        with open(file_path, "rb") as f:
            head = f.read(1024)
        PDFValidator.validate_pdf_header(head)

    @staticmethod
    def sanitize_filename(filename: str) -> str:
        """Prevent path traversal and sanitize filename."""
        base = os.path.basename(filename)
        sanitized = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", base)
        if not sanitized.lower().endswith(".pdf"):
            sanitized += ".pdf"
        return sanitized


class PDFExtractorService:
    def __init__(self, grobid_url: str | None = None):
        self.grobid_url = grobid_url or settings.GROBID_URL

    async def extract_pdf(self, file_path: str, filename: str = "") -> dict[str, Any]:
        """
        Full extraction pipeline:
        1. Attempt GROBID extraction if service is reachable.
        2. Fall back to local layout-aware extraction with pdfplumber/pdfminer.
        3. Extract structured tables & equations (§11a).
        4. Calculate extraction confidence and verified/unverified status.
        """
        grobid_data = None
        if self.grobid_url:
            try:
                grobid_data = await self._extract_with_grobid(file_path)
            except Exception as e:
                logger.info(
                    "GROBID service unavailable or failed (%s), using local extractor fallback.", e
                )

        # Local extraction is always used for table structuring, equations & as fallback
        local_data = await anyio.to_thread.run_sync(
            self._extract_with_pdfplumber, file_path, filename
        )

        if grobid_data:
            # Merge Grobid high-precision metadata with local table/equation analysis
            return self._merge_extractions(grobid_data, local_data)

        return local_data

    async def _extract_with_grobid(self, file_path: str) -> dict[str, Any] | None:
        """Call GROBID REST API and parse TEI XML."""
        client = get_async_http_client()
        file_bytes = await anyio.to_thread.run_sync(lambda: open(file_path, "rb").read())
        files = {"input": (os.path.basename(file_path), file_bytes, "application/pdf")}
        data = {
            "generateIDs": "1",
            "consolidateHeader": "1",
            "consolidateCitations": "1",
            "includeRawCitations": "1",
        }
        resp = await client.post(
            f"{self.grobid_url.rstrip('/')}/api/processFulltextDocument",
            files=files,
            data=data,
            timeout=30.0,
        )
        if resp.status_code != 200:
            logger.warning("GROBID returned status %s: %s", resp.status_code, resp.text[:200])
            return None

        return self._parse_tei_xml(resp.text)

    def _parse_tei_xml(self, xml_text: str) -> dict[str, Any]:
        """Parse GROBID TEI XML response into structured research document representation."""
        root = ET.fromstring(xml_text)
        ns = {"tei": "http://www.tei-c.org/ns/1.0"}

        # Title
        title_elem = root.find(".//tei:titleStmt/tei:title", ns)
        title = (
            title_elem.text.strip()
            if title_elem is not None and title_elem.text
            else "Untitled Academic Paper"
        )

        # Abstract
        abstract_elem = root.find(".//tei:profileDesc/tei:abstract", ns)
        abstract_paragraphs = []
        if abstract_elem is not None:
            for p in abstract_elem.findall(".//tei:p", ns):
                if p.text:
                    abstract_paragraphs.append(p.text.strip())
        abstract = "\n\n".join(abstract_paragraphs)

        # Authors
        authors: list[dict[str, Any]] = []
        for author in root.findall(".//tei:sourceDesc//tei:author", ns):
            persName = author.find("tei:persName", ns)
            if persName is not None:
                forename = persName.find("tei:forename[@type='first']", ns)
                surname = persName.find("tei:surname", ns)
                given = forename.text.strip() if forename is not None and forename.text else ""
                family = surname.text.strip() if surname is not None and surname.text else ""
                if family or given:
                    authors.append(
                        {
                            "givenName": given,
                            "familyName": family or given,
                            "literal": f"{given} {family}".strip(),
                        }
                    )

        # DOI & Year
        doi = None
        year = None
        idno = root.find(".//tei:idno[@type='DOI']", ns)
        if idno is not None and idno.text:
            doi = idno.text.strip()

        date_elem = root.find(".//tei:publicationStmt/tei:date", ns)
        if date_elem is not None and date_elem.get("when"):
            when = date_elem.get("when", "")
            match = re.search(r"\b(19\d\d|20\d\d)\b", when)
            if match:
                year = int(match.group(1))

        # Body Sections
        sections: list[dict[str, Any]] = []
        if abstract:
            sections.append(
                {
                    "id": str(uuid.uuid4()),
                    "title": "Abstract",
                    "page_number": 1,
                    "text": abstract,
                    "confidence": 0.98,
                    "unverified": False,
                }
            )

        body = root.find(".//tei:body", ns)
        if body is not None:
            for div in body.findall("tei:div", ns):
                head = div.find("tei:head", ns)
                sec_title = head.text.strip() if head is not None and head.text else "Section"
                paragraphs = []
                for p in div.findall("tei:p", ns):
                    if p.text:
                        paragraphs.append(p.text.strip())
                if paragraphs:
                    sections.append(
                        {
                            "id": str(uuid.uuid4()),
                            "title": sec_title,
                            "page_number": 1,
                            "text": "\n\n".join(paragraphs),
                            "confidence": 0.95,
                            "unverified": False,
                        }
                    )

        # References
        references: list[dict[str, Any]] = []
        for bibl in root.findall(".//tei:listBibl/tei:biblStruct", ns):
            ref_title_elem = bibl.find(".//tei:title", ns)
            ref_title = (
                ref_title_elem.text.strip()
                if ref_title_elem is not None and ref_title_elem.text
                else "Reference"
            )
            ref_year = None
            ref_date = bibl.find(".//tei:date", ns)
            if ref_date is not None and ref_date.get("when"):
                m = re.search(r"\b(19\d\d|20\d\d)\b", ref_date.get("when", ""))
                if m:
                    ref_year = int(m.group(1))

            ref_authors = []
            for a in bibl.findall(".//tei:author", ns):
                s = a.find("tei:persName/tei:surname", ns)
                if s is not None and s.text:
                    ref_authors.append(s.text.strip())

            references.append(
                {
                    "id": str(uuid.uuid4()),
                    "title": ref_title,
                    "authors": ref_authors,
                    "year": ref_year,
                    "raw_text": f"{', '.join(ref_authors)} ({ref_year or 'n.d.'}). {ref_title}",
                }
            )

        return {
            "title": title,
            "authors": authors,
            "abstract": abstract,
            "doi": doi,
            "year": year,
            "sections": sections,
            "references": references,
            "source": "grobid",
        }

    def _extract_with_pdfplumber(
        self, file_path: str, original_filename: str = ""
    ) -> dict[str, Any]:
        """
        High-fidelity local PDF extraction using pdfplumber:
        - Layout analysis
        - Section detection & segmentation
        - Structured Table extraction (rows/columns)
        - Equation detection (LaTeX or marked 'not text-searchable' with page anchor)
        - Quality confidence score calculation
        """
        import pdfplumber

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

                # 1. Structured Table Extraction (§11a)
                try:
                    raw_tables = page.extract_tables()
                    for t_idx, tbl in enumerate(raw_tables):
                        if tbl and len(tbl) > 0:
                            # Clean up None values in cells
                            cleaned_rows = [
                                [(cell.strip() if cell else "") for cell in row]
                                for row in tbl
                                if any(row)
                            ]
                            if len(cleaned_rows) >= 2:
                                headers = cleaned_rows[0]
                                rows = cleaned_rows[1:]
                                caption = f"Table {t_idx + 1} (Page {page_num})"
                                # Search surrounding text for caption
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

                # 2. Equation Detection & Mathematical Formula Recovery (§11a)
                lines = text.split("\n")
                for line in lines:
                    trimmed = line.strip()
                    if not trimmed:
                        continue

                    # Heuristic for equation detection:
                    # - Line contains mathematical symbols or LaTeX markup
                    # - Line is short with equality/relation or numbered equation tag (e.g. "(1)")
                    is_math = any(sym in trimmed for sym in MATH_SYMBOLS)
                    has_latex = any(re.search(pat, trimmed) for pat in LATEX_PATTERNS)
                    is_numbered_eq = bool(
                        re.search(r"=\s*.*\(\d+\)\s*$", trimmed)
                        or re.search(r"^\(\d+\)\s*.*=", trimmed)
                    )

                    if (is_math or has_latex or is_numbered_eq) and len(trimmed) < 160:
                        # Determine if formula is cleanly text-searchable or recoverable LaTeX
                        is_searchable = bool(
                            has_latex
                            or (
                                len(re.findall(r"[a-zA-Z0-9\+\-\*\/\=\(\)\<\>]", trimmed))
                                > len(trimmed) * 0.7
                            )
                        )

                        # Generate LaTeX equivalent representation
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

        # 3. Extract Metadata (Title, Authors, Abstract, Year, DOI)
        title, authors, abstract, year, doi, arxiv_id = self._extract_metadata_from_text(
            pages_text[0]["text"] if pages_text else "", full_doc_text, original_filename
        )

        # 4. Extract Structured Sections
        sections = self._segment_sections(pages_text, abstract)

        # 5. Extract References
        references = self._extract_references_from_text(full_doc_text)

        # 6. Extraction Quality & Confidence Scoring (§11a)
        confidence, status = self._calculate_confidence(
            title=title,
            abstract=abstract,
            sections=sections,
            total_chars=total_chars,
            page_count=page_count,
        )

        # Mark unverified sections if overall confidence is low
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

    def _extract_metadata_from_text(
        self, first_page_text: str, full_text: str, original_filename: str
    ) -> tuple[str, list[dict[str, Any]], str, int | None, str | None, str | None]:
        """Extract title, authors, abstract, year, DOI, and arXiv ID from text heuristics."""
        lines = [line.strip() for line in first_page_text.split("\n") if line.strip()]

        # DOI Detection
        doi = None
        doi_match = re.search(r"\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)\b", full_text)
        if doi_match:
            doi = doi_match.group(1).rstrip(".;,)")

        # arXiv ID Detection
        arxiv_id = None
        arxiv_match = re.search(r"\barXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)\b", full_text, re.IGNORECASE)
        if arxiv_match:
            arxiv_id = arxiv_match.group(1)

        # Year Detection
        year = None
        year_matches = re.findall(r"\b(19\d\d|20[0-2]\d)\b", first_page_text[:1500])
        if year_matches:
            # Filter reasonable publication years
            valid_years = [int(y) for y in year_matches if 1950 <= int(y) <= 2030]
            if valid_years:
                year = valid_years[0]

        # Abstract Detection
        abstract = ""
        abstract_match = re.search(
            r"\bAbstract\b[:\s\-\.]*(.+?)(?:\b(?:1\.?\s+|I\.?\s+)?Introduction\b|\bKeywords\b|\bIndex Terms\b|\n\n\n)",
            full_text,
            re.DOTALL | re.IGNORECASE,
        )
        if abstract_match:
            abstract = abstract_match.group(1).strip()
            # Clean up multi-space line wraps
            abstract = re.sub(r"\s+", " ", abstract)

        # Title Detection: Usually the first prominent non-header line(s) before authors or Abstract
        title = ""
        candidate_lines = []
        for line in lines[:8]:
            # Skip page headers, conferences, arxiv preprints
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
            # Title is typically the first 1-2 prominent lines
            title = " ".join(candidate_lines[:2]).strip()

        if not title or len(title) < 5:
            # Fallback to sanitized filename
            if original_filename:
                clean_name = os.path.splitext(os.path.basename(original_filename))[0]
                title = clean_name.replace("_", " ").replace("-", " ").title()
            else:
                title = "Untitled Research Paper"

        # Authors Detection: Lines following the title and before Abstract
        authors: list[dict[str, Any]] = []
        author_text_block = ""
        if len(candidate_lines) > 2:
            author_text_block = " ".join(candidate_lines[2:])
        elif len(lines) > 2:
            # Look between title and abstract
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
            # Split authors by commas, 'and', '&'
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

                # Check if this line is a section heading
                is_heading = False
                matched_heading = None
                for pat in SECTION_PATTERNS:
                    if re.search(pat, trimmed, re.IGNORECASE) and len(trimmed) < 80:
                        is_heading = True
                        matched_heading = trimmed
                        break

                if is_heading and matched_heading:
                    # Save previous section if it has content
                    if current_paras:
                        sec_text = "\n\n".join(current_paras).strip()
                        # Avoid duplicating abstract
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

        # Append final section
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
            # Fallback if no headings were matched: create page-based sections
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

    def _extract_references_from_text(self, full_text: str) -> list[dict[str, Any]]:
        """Extract structured reference entries from bibliography section."""
        references: list[dict[str, Any]] = []
        ref_match = re.search(
            r"\b(?:References|Bibliography|Works Cited)\b[:\s\-\.]*(.*)$",
            full_text,
            re.DOTALL | re.IGNORECASE,
        )
        if not ref_match:
            return references

        ref_block = ref_match.group(1).strip()
        # Split by bracketed numbers e.g. [1], [2] or author/year line breaks
        entries = re.split(r"\n(?=\[\d+\]|\b[A-Z][a-zA-Z\s\.,\-]+,\s*(?:19|20)\d\d)", ref_block)

        for idx, entry in enumerate(entries[:50]):  # Cap at 50 references for speed
            cleaned = re.sub(r"\s+", " ", entry).strip()
            if len(cleaned) < 15:
                continue

            year_match = re.search(r"\b(19\d\d|20[0-2]\d)\b", cleaned)
            year = int(year_match.group(1)) if year_match else None

            # Title heuristics: text between quotes or after authors
            ref_title = cleaned
            quote_match = re.search(r'["“]([^"”]+)["”]', cleaned)
            if quote_match:
                ref_title = quote_match.group(1).strip()
            else:
                parts = cleaned.split(".")
                if len(parts) >= 2:
                    ref_title = parts[1].strip()

            references.append(
                {
                    "id": str(uuid.uuid4()),
                    "index": idx + 1,
                    "title": ref_title[:200],
                    "year": year,
                    "raw_text": cleaned,
                }
            )

        return references

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

        # Title check
        if title and title != "Untitled Research Paper" and len(title) > 8:
            score += 0.25

        # Abstract check
        if abstract and len(abstract) > 60:
            score += 0.25

        # Sections check
        if len(sections) >= 2:
            score += 0.25
        elif len(sections) == 1:
            score += 0.10

        # Text density per page (average ≥ 200 characters per page indicates good OCR/text)
        avg_chars_per_page = total_chars / max(page_count, 1)
        if avg_chars_per_page > 400:
            score += 0.25
        elif avg_chars_per_page > 150:
            score += 0.15
        elif avg_chars_per_page > 50:
            score += 0.05

        score = round(min(score, 1.0), 2)
        # Low confidence threshold: < 0.60 marks extraction as unverified (§11a)
        status = "ok" if score >= 0.60 else "unverified"
        return score, status

    def _merge_extractions(self, grobid: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
        """Merge high-precision GROBID metadata with local table/equation and page layout data."""
        title = grobid.get("title") or local.get("title")
        authors = grobid.get("authors") or local.get("authors")
        abstract = grobid.get("abstract") or local.get("abstract")
        doi = grobid.get("doi") or local.get("doi")
        year = grobid.get("year") or local.get("year")

        # Prefer Grobid sections if available and rich, else local sections
        grobid_sections = grobid.get("sections")
        sections = (
            grobid_sections
            if (grobid_sections and len(grobid_sections) >= 2)
            else local.get("sections", [])
        )
        grobid_refs = grobid.get("references")
        references = (
            grobid_refs if (grobid_refs and len(grobid_refs) > 0) else local.get("references", [])
        )

        # Tables and equations always come from layout extractor (§11a)
        tables = local.get("tables", [])
        equations = local.get("equations", [])
        pages = local.get("pages", [])
        page_count = local.get("page_count", 1)

        confidence = 0.95
        status = "ok"

        return {
            "title": title,
            "authors": authors,
            "abstract": abstract,
            "doi": doi,
            "arxiv_id": local.get("arxiv_id"),
            "pmid": None,
            "year": year,
            "page_count": page_count,
            "extraction_status": status,
            "confidence_score": confidence,
            "sections": sections,
            "tables": tables,
            "equations": equations,
            "references": references,
            "pages": pages,
            "source": "grobid_enhanced",
        }


# Singleton extractor instance
pdf_extractor = PDFExtractorService()
