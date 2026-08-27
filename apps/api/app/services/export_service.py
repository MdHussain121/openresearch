"""
Export Service Engine Facade for OpenResearch.
Re-exports modular export services from app.services.export for backward compatibility.
"""

from app.services.export import (
    ExportOptions,
    ExportService,
    NumberedCanvas,
    ParsedBlock,
    export_service,
    export_to_bibtex,
    export_to_docx,
    export_to_markdown,
    export_to_pdf,
    extract_inline_text,
    format_authors_bibliography,
    format_authors_inline,
    format_bibliography_entry,
    format_inline_marker,
    parse_document_blocks,
    parse_tiptap_node,
    serialize_paper_bibtex,
)

__all__ = [
    "ExportOptions",
    "ExportService",
    "NumberedCanvas",
    "ParsedBlock",
    "export_service",
    "export_to_bibtex",
    "export_to_docx",
    "export_to_markdown",
    "export_to_pdf",
    "extract_inline_text",
    "format_authors_bibliography",
    "format_authors_inline",
    "format_bibliography_entry",
    "format_inline_marker",
    "parse_document_blocks",
    "parse_tiptap_node",
    "serialize_paper_bibtex",
]
