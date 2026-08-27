"""
PDF Document Exporter (.pdf) for OpenResearch Export Engine using ReportLab.
"""

import io
import re
from datetime import UTC, datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)
from reportlab.platypus import (
    Table as RLTable,
)

from app.models.citation import Citation
from app.models.document import Document
from app.models.paper import Paper
from app.services.export.ast_parser import parse_document_blocks
from app.services.export.csl_formatter import (
    format_authors_inline,
    format_bibliography_entry,
)
from app.services.export.options import ExportOptions


class NumberedCanvas(canvas.Canvas):
    """Canvas that performs a two-pass calculation of total page numbers."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, object]] = []

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, total_pages: int):
        self.saveState()
        self.setFont("Helvetica", 8.5)
        self.setFillColor(colors.HexColor("#5C5B57"))

        # Header (pages > 1)  # noqa: ERA001
        if self._pageNumber > 1:
            self.drawString(54, 750, "OpenResearch — Academic Document")
            self.setStrokeColor(colors.HexColor("#E4E2DE"))
            self.setLineWidth(0.5)
            self.line(54, 742, 558, 742)

        # Footer (all pages)
        footer_text = f"Page {self._pageNumber} of {total_pages}"
        self.drawRightString(558, 36, footer_text)
        self.drawString(54, 36, "Source-Grounded Research Document")
        self.setStrokeColor(colors.HexColor("#E4E2DE"))
        self.setLineWidth(0.5)
        self.line(54, 48, 558, 48)
        self.restoreState()


def export_to_pdf(
    document: Document,
    citations: list[Citation],
    papers: list[Paper],
    citation_style: str = "apa",
    include_bibliography: bool = True,
    include_trust_markers: bool = True,
    options: ExportOptions | None = None,
) -> io.BytesIO:
    """Generate high-quality academic PDF document using ReportLab."""
    if options is not None:
        citation_style = options.citation_style
        include_bibliography = options.include_bibliography
        include_trust_markers = options.include_trust_markers

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54,
    )

    styles = getSampleStyleSheet()
    paper_dict = {paper.id: paper for paper in papers}

    # Custom Academic Styles
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#1A1A18"),
        spaceAfter=6,
    )
    meta_style = ParagraphStyle(
        "DocMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#5C5B57"),
        spaceAfter=14,
    )
    h1_style = ParagraphStyle(
        "DocH1",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#1A1A18"),
        spaceBefore=12,
        spaceAfter=6,
    )
    h2_style = ParagraphStyle(
        "DocH2",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#2C5F4A"),
        spaceBefore=10,
        spaceAfter=4,
    )
    h3_style = ParagraphStyle(
        "DocH3",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#1A1A18"),
        spaceBefore=8,
        spaceAfter=3,
    )
    body_style = ParagraphStyle(
        "DocBody",
        parent=styles["Normal"],
        fontName="Times-Roman",
        fontSize=10.5,
        leading=15,
        textColor=colors.HexColor("#1A1A18"),
        spaceAfter=6,
    )
    quote_style = ParagraphStyle(
        "DocQuote",
        parent=styles["Normal"],
        fontName="Times-Italic",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#3A3935"),
        leftIndent=24,
        rightIndent=24,
        spaceBefore=6,
        spaceAfter=6,
    )
    code_style = ParagraphStyle(
        "DocCode",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#2C2C30"),
        leftIndent=12,
        spaceBefore=4,
        spaceAfter=4,
    )
    eq_style = ParagraphStyle(
        "DocEquation",
        parent=styles["Normal"],
        fontName="Times-Italic",
        fontSize=11,
        leading=14,
        alignment=1,  # Center
        spaceBefore=6,
        spaceAfter=6,
    )
    ref_style = ParagraphStyle(
        "DocRef",
        parent=styles["Normal"],
        fontName="Times-Roman",
        fontSize=9.5,
        leading=13.5,
        leftIndent=18,
        firstLineIndent=-18,
        spaceAfter=4,
    )

    story = []

    # Title & Header
    story.append(Paragraph(document.title or "Untitled Research Paper", title_style))
    date_str = datetime.now(UTC).strftime("%B %d, %Y")
    story.append(
        Paragraph(
            f"OpenResearch Academic Workspace • {date_str} • {citation_style.upper()} Citation Format",
            meta_style,
        )
    )
    story.append(
        HRFlowable(
            width="100%",
            thickness=1,
            color=colors.HexColor("#E4E2DE"),
            spaceBefore=0,
            spaceAfter=12,
        )
    )

    # Citation map
    citation_map: dict[str, tuple[Paper, int]] = {}
    ordered_papers: list[Paper] = []
    for citation in citations:
        paper = paper_dict.get(citation.paper_id)
        if paper and paper.id not in citation_map:
            ordered_papers.append(paper)
            citation_map[paper.id] = (paper, len(ordered_papers))
    if not ordered_papers and papers:
        for paper in papers:
            ordered_papers.append(paper)
            citation_map[paper.id] = (paper, len(ordered_papers))

    blocks = parse_document_blocks(document, citation_map, citation_style)

    for block in blocks:
        # Clean text for ReportLab XML tags
        clean_text = block.content.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        clean_text = re.sub(r"\*\*\*(.*?)\*\*\*", r"<b><i>\1</i></b>", clean_text)
        clean_text = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", clean_text)
        clean_text = re.sub(r"\*(.*?)\*", r"<i>\1</i>", clean_text)
        clean_text = re.sub(r"`(.*?)`", r'<font face="Courier">\1</font>', clean_text)

        if block.block_type == "heading":
            if block.level == 1:
                story.append(Paragraph(clean_text, h1_style))
            elif block.level == 2:
                story.append(Paragraph(clean_text, h2_style))
            else:
                story.append(Paragraph(clean_text, h3_style))

        elif block.block_type == "paragraph":
            story.append(Paragraph(clean_text, body_style))

        elif block.block_type == "blockquote":
            story.append(Paragraph(clean_text, quote_style))

        elif block.block_type == "code":
            story.append(Paragraph(clean_text, code_style))

        elif block.block_type == "equation":
            story.append(Paragraph(f"$$ {clean_text} $$", eq_style))

        elif block.block_type == "bullet_list":
            for item in block.children:
                item_clean = (
                    item.content.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                )
                story.append(Paragraph(f"• &nbsp; {item_clean}", body_style))

        elif block.block_type == "ordered_list":
            for idx, item in enumerate(block.children, 1):
                item_clean = (
                    item.content.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                )
                story.append(Paragraph(f"{idx}. &nbsp; {item_clean}", body_style))

        elif block.block_type == "table" and block.table_rows:
            table_data = []
            for row in block.table_rows:
                row_paras = [Paragraph(cell.replace("&", "&amp;"), body_style) for cell in row]
                table_data.append(row_paras)
            if table_data:
                rl_table = RLTable(
                    table_data, colWidths=[504 / len(table_data[0])] * len(table_data[0])
                )
                rl_table.setStyle(
                    TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F0EE")),
                            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1A1A18")),
                            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E4E2DE")),
                            ("TOPPADDING", (0, 0), (-1, -1), 4),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                        ]
                    )
                )
                story.append(Spacer(1, 4))
                story.append(rl_table)
                story.append(Spacer(1, 6))

    # Footnotes & Trust Provenance
    if include_trust_markers and citations:
        story.append(Spacer(1, 10))
        story.append(Paragraph("Footnotes &amp; Source Provenance", h2_style))
        for index, citation in enumerate(citations, 1):
            paper = paper_dict.get(citation.paper_id)
            if paper:
                authors_str = format_authors_inline(paper.authors or [], citation_style)
                page_info = f", p. {citation.page_number}" if citation.page_number else ""
                clean_title = paper.title.replace("&", "&amp;")
                fn_text = (
                    f"<b>[{index}]</b> Source-grounded: <i>{clean_title}</i>, {authors_str} "
                    f"({paper.year or 'n.d.'}){page_info}"
                )
                story.append(Paragraph(fn_text, ref_style))

    # References Section
    if include_bibliography and ordered_papers:
        story.append(Spacer(1, 12))
        story.append(Paragraph("References", h1_style))
        for index, paper in enumerate(ordered_papers, 1):
            ref_entry = format_bibliography_entry(paper, citation_style, index)
            clean_entry = ref_entry.replace("&", "&amp;")
            story.append(Paragraph(clean_entry, ref_style))

    doc.build(story, canvasmaker=NumberedCanvas)
    buf.seek(0)
    return buf
