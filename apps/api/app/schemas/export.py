"""Export schemas."""

from pydantic import BaseModel


class ExportRequest(BaseModel):
    export_format: str = "markdown"  # 'docx' | 'pdf' | 'markdown' | 'md' | 'bibtex' | 'bib'
    citation_style: str = "apa"  # See SUPPORTED_CITATION_STYLES in app.core.text_utils
    include_bibliography: bool = True
    include_trust_markers: bool = True
    include_source_footnotes: bool = True
