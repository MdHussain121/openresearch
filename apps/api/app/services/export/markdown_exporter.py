"""
Markdown Exporter (.md) for OpenResearch Export Engine.
"""

from app.models.citation import Citation
from app.models.document import Document
from app.models.paper import Paper
from app.services.export.ast_parser import parse_document_blocks
from app.services.export.csl_formatter import (
    format_authors_inline,
    format_bibliography_entry,
)
from app.services.export.options import ExportOptions


def export_to_markdown(
    document: Document,
    citations: list[Citation],
    papers: list[Paper],
    citation_style: str = "apa",
    include_bibliography: bool = True,
    include_trust_markers: bool = True,
    options: ExportOptions | None = None,
) -> str:
    """Generate structured Markdown with headings, tables, equations, footnotes & bibliography."""
    if options is not None:
        citation_style = options.citation_style
        include_bibliography = options.include_bibliography
        include_trust_markers = options.include_trust_markers

    paper_dict = {paper.id: paper for paper in papers}

    # Build citation index map
    citation_map: dict[str, tuple[Paper, int]] = {}
    ordered_papers: list[Paper] = []

    for citation in citations:
        paper = paper_dict.get(citation.paper_id)
        if paper and paper.id not in citation_map:
            ordered_papers.append(paper)
            citation_map[paper.id] = (paper, len(ordered_papers))

    # Include all papers in bibliography if citations list was empty
    if not ordered_papers and papers:
        for paper in papers:
            ordered_papers.append(paper)
            citation_map[paper.id] = (paper, len(ordered_papers))

    blocks = parse_document_blocks(document, citation_map, citation_style)
    lines: list[str] = [f"# {document.title or 'Untitled Paper'}\n"]

    footnote_counter = 1
    footnotes: list[str] = []

    for block in blocks:
        if block.block_type == "heading":
            prefix = "#" * min(6, block.level)
            lines.append(f"\n{prefix} {block.content}\n")

        elif block.block_type == "paragraph":
            lines.append(f"\n{block.content}\n")

        elif block.block_type == "blockquote":
            lines.append(f"\n> {block.content}\n")

        elif block.block_type == "code":
            lines.append(f"\n```\n{block.content}\n```\n")

        elif block.block_type == "equation":
            lines.append(f"\n$$\n{block.content}\n$$\n")

        elif block.block_type == "bullet_list":
            lines.append("")
            for item in block.children:
                lines.append(f"- {item.content}")
            lines.append("")

        elif block.block_type == "ordered_list":
            lines.append("")
            for index, item in enumerate(block.children, 1):
                lines.append(f"{index}. {item.content}")
            lines.append("")

        elif block.block_type == "table" and block.table_rows:
            lines.append("")
            headers = block.table_rows[0]
            lines.append("| " + " | ".join(headers) + " |")
            lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
            for row in block.table_rows[1:]:
                # Pad row if needed
                padded_row = row + [""] * (len(headers) - len(row))
                lines.append("| " + " | ".join(padded_row[: len(headers)]) + " |")
            lines.append("")

    # Trust markers degradation to footnote provenance (UI/UX §5.2)
    if include_trust_markers and citations:
        for citation in citations:
            paper = paper_dict.get(citation.paper_id)
            if paper:
                authors_str = format_authors_inline(paper.authors or [], citation_style)
                page_info = f", p. {citation.page_number}" if citation.page_number else ""
                scope_info = (
                    f" ({citation.attribution_scope}-level attribution)"
                    if citation.attribution_scope
                    else ""
                )
                footnotes.append(
                    f"[^{footnote_counter}]: Source-grounded: *{paper.title}*, {authors_str} "
                    f"({paper.year or 'n.d.'}){page_info}{scope_info}"
                )
                footnote_counter += 1

    if footnotes:
        lines.append("\n---\n### Footnotes & Source Provenance\n")
        lines.extend(footnotes)
        lines.append("")

    # Bibliography section
    if include_bibliography and ordered_papers:
        lines.append("\n---\n## References\n")
        for index, paper in enumerate(ordered_papers, 1):
            ref_entry = format_bibliography_entry(paper, citation_style, index)
            lines.append(f"{ref_entry}\n")

    return "\n".join(lines).strip() + "\n"
