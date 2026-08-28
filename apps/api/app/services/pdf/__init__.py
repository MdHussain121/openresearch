"""
PDF Extraction Services Package

Provides a modular PDF extraction pipeline with GROBID integration, local fallback, and OCR.
"""

from typing import Any

from app.core.config import settings

from .grobid_client import GrobidClient
from .ocr_extractor import OCRExtractor
from .pdfplumber_extractor import PdfplumberExtractor
from .reference_extractor import ReferenceExtractor
from .tei_parser import TeiParser
from .validator import PDFExtractionError, PDFValidator


class PDFExtractor:
    """
    Facade that composes all PDF extraction components.

    Maintains the exact same public API as the original pdf_extractor module.
    """

    def __init__(
        self,
        grobid_url: str | None = None,
        ocr_enabled: bool = True,
        ocr_dpi: int = 300,
        ocr_lang: str = "eng",
        ocr_threshold_chars_per_page: int = 150,
    ):
        self.grobid_client = GrobidClient(grobid_url)
        self.tei_parser = TeiParser()
        self.local_extractor = PdfplumberExtractor()
        self.ocr_extractor = OCRExtractor(dpi=ocr_dpi, lang=ocr_lang) if ocr_enabled else None
        self.ocr_threshold_chars_per_page = ocr_threshold_chars_per_page

    @property
    def grobid_url(self) -> str | None:
        return self.grobid_client.grobid_url

    async def extract_pdf(self, file_path: str, filename: str = "") -> dict[str, Any]:
        """
        Full extraction pipeline:
        1. Attempt GROBID extraction if service is reachable.
        2. Local layout-aware extraction with pdfplumber (tables, equations, sections).
        3. OCR fallback if text density is below threshold (scanned/image PDFs).
        4. Calculate extraction confidence and verified/unverified status.
        """
        grobid_data = None
        if self.grobid_client.grobid_url:
            try:
                tei_xml = await self.grobid_client.extract(file_path)
                if tei_xml:
                    grobid_data = self.tei_parser.parse(tei_xml)
            except Exception as e:
                import logging
                logger = logging.getLogger("openresearch.pdf_extractor")
                logger.info(
                    "GROBID service unavailable or failed (%s), using local extractor fallback.", e
                )

        # Local extraction is always used for table structuring, equations & as fallback
        local_data = await self.local_extractor.extract(file_path, filename)

        # OCR fallback check - if text density is too low, run OCR
        if self.ocr_extractor:
            pages = local_data.get("pages", [])
            page_count = local_data.get("page_count", 1)
            if pages and page_count > 0:
                avg_chars = sum(len(p.get("text", "")) for p in pages) / page_count
                if avg_chars < self.ocr_threshold_chars_per_page:
                    import logging
                    logger = logging.getLogger("openresearch.pdf_extractor")
                    logger.info(
                        "Low text density (%.0f chars/page < %d threshold), triggering OCR fallback",
                        avg_chars, self.ocr_threshold_chars_per_page
                    )
                    ocr_data = await self.ocr_extractor.extract(file_path, filename)
                    local_data = self._merge_ocr(local_data, ocr_data)
                    local_data["pre_ocr_chars_per_page"] = round(avg_chars, 1)

        if grobid_data:
            # Merge Grobid high-precision metadata with local table/equation analysis
            return self._merge_extractions(grobid_data, local_data)

        return local_data

    # Backward compat shims - tests call these private methods on service
    def _parse_tei_xml(self, xml_text: str) -> dict[str, Any]:
        return self.tei_parser.parse(xml_text)

    def _extract_metadata_from_text(self, first_page_text: str, full_text: str, original_filename: str = ""):
        return self.local_extractor._extract_metadata_from_text(first_page_text, full_text, original_filename)

    def _segment_sections(self, pages: list, abstract: str = "") -> list:
        return self.local_extractor._segment_sections(pages, abstract)

    def _extract_references_from_text(self, text: str) -> list:
        return ReferenceExtractor().extract(text)

    def _calculate_confidence(self, *args, **kwargs):
        return self.local_extractor._calculate_confidence(*args, **kwargs)

    def _merge_ocr(self, base: dict[str, Any], ocr: dict[str, Any]) -> dict[str, Any]:
        """Merge OCR text extraction with local layout data (tables, equations)."""
        # Keep local tables and equations (pdfplumber-specific)
        tables = base.get("tables", [])
        equations = base.get("equations", [])

        # Use OCR pages, sections, references
        pages = ocr.get("pages", [])
        sections = ocr.get("sections", [])
        references = ocr.get("references", [])

        # Metadata from OCR (may be better for scanned docs)
        title = ocr.get("title") or base.get("title")
        authors = ocr.get("authors") or base.get("authors")
        abstract = ocr.get("abstract") or base.get("abstract")
        doi = ocr.get("doi") or base.get("doi")
        arxiv_id = ocr.get("arxiv_id") or base.get("arxiv_id")
        year = ocr.get("year") or base.get("year")
        page_count = ocr.get("page_count") or base.get("page_count", 1)

        # OCR is inherently less reliable
        confidence = min(ocr.get("confidence_score", 0.45), base.get("confidence_score", 0.0))
        status = "unverified"

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
            "confidence_score": round(confidence, 2),
            "sections": sections,
            "tables": tables,
            "equations": equations,
            "references": references,
            "pages": pages,
            "source": "local_pdfplumber_ocr",
            "ocr_triggered": True,
            "pre_ocr_chars_per_page": base.get("pre_ocr_chars_per_page"),
        }

    # Compatibility for legacy tests that monkeypatch / call private grobid/pdfplumber helpers
    def _extract_with_grobid(self, file_path: str):  # pragma: no cover - legacy test shim
        import asyncio

        try:
            return asyncio.run(self.grobid_client.extract(file_path))
        except RuntimeError:
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(self.grobid_client.extract(file_path))
            finally:
                loop.close()

    def _extract_with_pdfplumber(self, file_path: str, filename: str = "") -> dict[str, Any]:  # pragma: no cover - legacy test shim
        import asyncio

        try:
            return asyncio.run(self.local_extractor.extract(file_path, filename))
        except RuntimeError:
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(self.local_extractor.extract(file_path, filename))
            finally:
                loop.close()

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

        # Tables and equations always come from layout extractor
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


# Singleton extractor instance for backward compatibility
pdf_extractor = PDFExtractor(
    grobid_url=settings.GROBID_URL,
    ocr_enabled=settings.OCR_ENABLED,
    ocr_dpi=settings.OCR_DPI,
    ocr_lang=settings.OCR_LANG,
    ocr_threshold_chars_per_page=settings.OCR_THRESHOLD_CHARS_PER_PAGE,
)

__all__ = [
    "GrobidClient",
    "PDFExtractionError",
    "PDFExtractor",
    "PDFValidator",
    "PdfplumberExtractor",
    "ReferenceExtractor",
    "TeiParser",
    "pdf_extractor",
]
