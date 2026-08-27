"""
Export Options Data Transfer Object for OpenResearch Export Engine.
"""

from dataclasses import dataclass


@dataclass
class ExportOptions:
    """Options and formatting preferences for document export."""

    export_format: str = "markdown"
    citation_style: str = "apa"
    include_bibliography: bool = True
    include_trust_markers: bool = True
