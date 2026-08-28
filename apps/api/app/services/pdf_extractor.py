"""
PDF Extraction - Thin wrapper for backward compatibility.

This module re-exports from the new modular pdf package.
Original monolithic implementation has been split into:
- pdf/validator.py
- pdf/grobid_client.py
- pdf/tei_parser.py
- pdf/pdfplumber_extractor.py
- pdf/reference_extractor.py
"""

from app.services.pdf import (
    GrobidClient,
    PDFExtractionError,
    PDFExtractor,
    PdfplumberExtractor,
    PDFValidator,
    ReferenceExtractor,
    TeiParser,
    pdf_extractor,
)
from app.services.pdf.base_extractor import MATH_SYMBOLS, SECTION_PATTERNS

# Backward compat alias - tests import PDFExtractorService
PDFExtractorService = PDFExtractor

__all__ = [
    "MATH_SYMBOLS",
    "SECTION_PATTERNS",
    "GrobidClient",
    "PDFExtractionError",
    "PDFExtractor",
    "PDFExtractorService",
    "PDFValidator",
    "PdfplumberExtractor",
    "ReferenceExtractor",
    "TeiParser",
    "pdf_extractor",
]
