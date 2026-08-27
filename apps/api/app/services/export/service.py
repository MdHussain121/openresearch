"""
Export Service Engine Dispatcher for OpenResearch.
"""

import re
from typing import Any

from app.models.citation import Citation
from app.models.document import Document
from app.models.paper import Paper
from app.services.export.bibtex_exporter import export_to_bibtex
from app.services.export.docx_exporter import export_to_docx
from app.services.export.markdown_exporter import export_to_markdown
from app.services.export.options import ExportOptions
from app.services.export.pdf_exporter import export_to_pdf


class ExportService:
    @staticmethod
    def export_document(
        document: Document,
        citations: list[Citation],
        papers: list[Paper],
        export_format: str = "markdown",
        citation_style: str = "apa",
        include_bibliography: bool = True,
        include_trust_markers: bool = True,
        options: ExportOptions | None = None,
    ) -> tuple[Any, str, str]:
        """
        Exports a document to the requested format using bundled options or individual parameters.
        Returns tuple of: (content_data, filename, mime_type)
        """
        if options is not None:
            export_format = options.export_format
            citation_style = options.citation_style
            include_bibliography = options.include_bibliography
            include_trust_markers = options.include_trust_markers

        format_normalized = (export_format or "markdown").lower().strip()
        safe_title = (
            re.sub(r"[^a-zA-Z0-9_\- ]", "", document.title or "Untitled").strip().replace(" ", "_")
            or "Paper"
        )

        if format_normalized in ["markdown", "md"]:
            content = export_to_markdown(
                document,
                citations,
                papers,
                citation_style,
                include_bibliography,
                include_trust_markers,
            )
            filename = f"{safe_title}.md"
            mime_type = "text/markdown; charset=utf-8"
            return content, filename, mime_type

        if format_normalized in ["bibtex", "bib"]:
            content = export_to_bibtex(document, citations, papers)
            filename = f"{safe_title}_references.bib"
            mime_type = "application/x-bibtex; charset=utf-8"
            return content, filename, mime_type

        if format_normalized in ["docx", "word"]:
            buf = export_to_docx(
                document,
                citations,
                papers,
                citation_style,
                include_bibliography,
                include_trust_markers,
            )
            filename = f"{safe_title}.docx"
            mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            return buf, filename, mime_type

        if format_normalized in ["pdf"]:
            buf = export_to_pdf(
                document,
                citations,
                papers,
                citation_style,
                include_bibliography,
                include_trust_markers,
            )
            filename = f"{safe_title}.pdf"
            mime_type = "application/pdf"
            return buf, filename, mime_type

        raise ValueError(
            f"Unsupported export format '{export_format}'. Supported formats: markdown, bibtex, docx, pdf."
        )


export_service = ExportService()
