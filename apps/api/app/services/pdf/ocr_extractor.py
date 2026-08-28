import logging
from typing import Any

import anyio

from .base_extractor import BaseExtractor

logger = logging.getLogger("openresearch.pdf.ocr_extractor")


class OCRExtractor(BaseExtractor):
    def __init__(self, dpi: int = 300, lang: str = "eng"):
        super().__init__()
        self.dpi = dpi
        self.lang = lang

    async def extract(self, file_path: str, original_filename: str = "") -> dict[str, Any]:
        """
        Extract text from PDF using OCR (Tesseract via pdf2image).
        Converts PDF pages to images, runs OCR on each page.
        """
        return await anyio.to_thread.run_sync(self._extract_sync, file_path, original_filename)

    def _extract_sync(self, file_path: str, original_filename: str = "") -> dict[str, Any]:
        pages_text: list[dict[str, Any]] = []
        total_chars = 0

        try:
            import pytesseract
            from pdf2image import convert_from_path
        except ImportError as e:
            logger.error("OCR dependencies not available: %s", e)
            return self._empty_result("OCR dependencies not installed")

        try:
            images = convert_from_path(file_path, dpi=self.dpi)
        except Exception as e:
            logger.error("Failed to convert PDF to images: %s", e)
            return self._empty_result(f"PDF to image conversion failed: {e}")

        page_count = len(images)

        for page_idx, image in enumerate(images):
            page_num = page_idx + 1
            try:
                text = pytesseract.image_to_string(image, lang=self.lang, config="--psm 6")
            except Exception as e:
                logger.warning("OCR failed on page %d: %s", page_num, e)
                text = ""

            pages_text.append({"page_number": page_num, "text": text})
            total_chars += len(text.strip())

        full_doc_text = "\n\n".join(p["text"] for p in pages_text)

        if not full_doc_text.strip():
            return self._empty_result("No text extracted by OCR")

        title, authors, abstract, year, doi, arxiv_id = self._extract_metadata_from_text(
            pages_text[0]["text"] if pages_text else "", full_doc_text, original_filename
        )

        sections = self._segment_sections(pages_text, abstract)
        references = self._extract_references(full_doc_text)

        confidence, _status = self._calculate_confidence(
            title=title,
            abstract=abstract,
            sections=sections,
            total_chars=total_chars,
            page_count=page_count,
        )

        for sec in sections:
            sec["unverified"] = True

        return {
            "title": title,
            "authors": authors,
            "abstract": abstract,
            "doi": doi,
            "arxiv_id": arxiv_id,
            "pmid": None,
            "year": year,
            "page_count": page_count,
            "extraction_status": "unverified",
            "confidence_score": min(confidence, 0.55),
            "sections": sections,
            "tables": [],
            "equations": [],
            "references": references,
            "pages": pages_text,
            "source": "local_ocr",
            "ocr_triggered": True,
            "ocr_dpi": self.dpi,
            "ocr_lang": self.lang,
        }

    def _empty_result(self, reason: str) -> dict[str, Any]:
        """Return an empty result when OCR fails completely."""
        return {
            "title": "Untitled Research Paper",
            "authors": [{"familyName": "Unknown Author", "literal": "Unknown Author"}],
            "abstract": None,
            "doi": None,
            "arxiv_id": None,
            "pmid": None,
            "year": None,
            "page_count": 0,
            "extraction_status": "unverified",
            "confidence_score": 0.0,
            "sections": [],
            "tables": [],
            "equations": [],
            "references": [],
            "pages": [],
            "source": "local_ocr",
            "ocr_triggered": True,
            "ocr_error": reason,
        }
