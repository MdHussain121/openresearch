"""
TipTap AST JSON content parser and block extractor.
"""

import re
from typing import Any

from app.models.document import Document
from app.models.paper import Paper
from app.services.export.csl_formatter import format_inline_marker


class ParsedBlock:
    def __init__(
        self,
        block_type: str,
        content: str = "",
        level: int = 1,
        metadata: dict[str, Any] | None = None,
        children: list["ParsedBlock"] | None = None,
    ) -> None:
        # 'heading', 'paragraph', 'bullet_list', 'ordered_list', 'table', 'blockquote', 'code', 'equation'
        self.block_type = block_type
        self.content = content
        self.level = level
        self.metadata = metadata or {}
        self.children: list[ParsedBlock] = children or []
        self.table_rows: list[list[str]] = []


def extract_inline_text(
    content_list: list[dict[str, Any]], citation_map: dict[str, tuple[Paper, int]], style: str
) -> str:
    """Extract inline text, applying citation formatting and formatting marks."""
    out = []
    for item in content_list:
        item_type = item.get("type", "")
        if item_type == "text":
            text = item.get("text", "")
            marks = [m.get("type") for m in item.get("marks", [])]
            if "bold" in marks and "italic" in marks:
                out.append(f"***{text}***")
            elif "bold" in marks:
                out.append(f"**{text}**")
            elif "italic" in marks:
                out.append(f"*{text}*")
            elif "code" in marks:
                out.append(f"`{text}`")
            else:
                out.append(text)

        elif item_type == "citation":
            paper_id = item.get("attrs", {}).get("paperId") or item.get("attrs", {}).get("paper_id")
            page_num = item.get("attrs", {}).get("pageNumber")
            if paper_id and paper_id in citation_map:
                paper, idx = citation_map[paper_id]
                out.append(format_inline_marker(paper, style, idx, page_num))
            else:
                out.append(item.get("attrs", {}).get("label") or "[Citation]")

        elif item_type == "trustMarker":
            marker_num = item.get("attrs", {}).get("markerNumber", 1)
            out.append(f"[^{marker_num}]")

        elif item_type in ["mathEquation", "math"]:
            latex = item.get("attrs", {}).get("latex", "")
            out.append(f" ${latex}$ ")

    return "".join(out)


def parse_tiptap_node(
    node: dict[str, Any], citation_map: dict[str, tuple[Paper, int]], style: str
) -> list[ParsedBlock]:
    """Recursively parse a Tiptap JSON node into structured document blocks."""
    node_type = node.get("type", "")
    blocks: list[ParsedBlock] = []

    if node_type == "doc":
        for child in node.get("content", []):
            blocks.extend(parse_tiptap_node(child, citation_map, style))

    elif node_type == "heading":
        level = node.get("attrs", {}).get("level", 1)
        text = extract_inline_text(node.get("content", []), citation_map, style)
        blocks.append(ParsedBlock("heading", content=text, level=level))

    elif node_type == "paragraph":
        text = extract_inline_text(node.get("content", []), citation_map, style)
        if text.strip():
            blocks.append(ParsedBlock("paragraph", content=text))

    elif node_type == "blockquote":
        inner_text = "\n".join(
            [
                b.content
                for b in parse_tiptap_node(
                    {"type": "doc", "content": node.get("content", [])}, citation_map, style
                )
            ]
        )
        blocks.append(ParsedBlock("blockquote", content=inner_text))

    elif node_type == "codeBlock":
        code_text = "".join([c.get("text", "") for c in node.get("content", [])])
        blocks.append(ParsedBlock("code", content=code_text))

    elif node_type in ["mathEquation", "math"]:
        latex = node.get("attrs", {}).get("latex", "")
        blocks.append(ParsedBlock("equation", content=latex))

    elif node_type == "bulletList":
        block = ParsedBlock("bullet_list")
        for item in node.get("content", []):
            item_text = extract_inline_text(item.get("content", []), citation_map, style)
            if not item_text:
                for sub in item.get("content", []):
                    item_text += extract_inline_text(sub.get("content", []), citation_map, style)
            block.children.append(ParsedBlock("list_item", content=item_text))
        blocks.append(block)

    elif node_type == "orderedList":
        block = ParsedBlock("ordered_list")
        for item in node.get("content", []):
            item_text = extract_inline_text(item.get("content", []), citation_map, style)
            if not item_text:
                for sub in item.get("content", []):
                    item_text += extract_inline_text(sub.get("content", []), citation_map, style)
            block.children.append(ParsedBlock("list_item", content=item_text))
        blocks.append(block)

    elif node_type == "table":
        block = ParsedBlock("table")
        rows = []
        for row_node in node.get("content", []):
            row_cells = []
            for cell in row_node.get("content", []):
                cell_text = extract_inline_text(cell.get("content", []), citation_map, style)
                if not cell_text:
                    for sub in cell.get("content", []):
                        cell_text += extract_inline_text(
                            sub.get("content", []), citation_map, style
                        )
                row_cells.append(cell_text.strip())
            rows.append(row_cells)
        block.table_rows = rows
        blocks.append(block)

    return blocks


def parse_document_blocks(
    document: Document, citation_map: dict[str, tuple[Paper, int]], style: str
) -> list[ParsedBlock]:
    """Parse document content from JSON AST or fallback to plain text."""
    if (
        document.content_json
        and isinstance(document.content_json, dict)
        and "content" in document.content_json
    ):
        blocks = parse_tiptap_node(document.content_json, citation_map, style)
        if blocks:
            return blocks

    # Fallback to plain text parsing
    blocks = []
    lines = (document.plain_text or "").split("\n")
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("# "):
            blocks.append(ParsedBlock("heading", content=stripped[2:], level=1))
        elif stripped.startswith("## "):
            blocks.append(ParsedBlock("heading", content=stripped[3:], level=2))
        elif stripped.startswith("### "):
            blocks.append(ParsedBlock("heading", content=stripped[4:], level=3))
        elif stripped.startswith("> "):
            blocks.append(ParsedBlock("blockquote", content=stripped[2:]))
        elif stripped.startswith("- ") or stripped.startswith("* "):
            blocks.append(
                ParsedBlock(
                    "bullet_list", children=[ParsedBlock("list_item", content=stripped[2:])]
                )
            )
        elif re.match(r"^\d+\.\s", stripped):
            item_text = re.sub(r"^\d+\.\s", "", stripped)
            blocks.append(
                ParsedBlock("ordered_list", children=[ParsedBlock("list_item", content=item_text)])
            )
        else:
            blocks.append(ParsedBlock("paragraph", content=stripped))

    return blocks
