import logging
import os
import re

from app.core.constants import BYTES_PER_MB

logger = logging.getLogger("openresearch.pdf.validator")


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
