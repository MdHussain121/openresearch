"""Tests for PdfplumberExtractor (layout analysis, table extraction, equation detection)."""

import asyncio
from unittest.mock import MagicMock, patch

from app.services.pdf.pdfplumber_extractor import PdfplumberExtractor


def test_pdfplumber_extract_tables_and_equations():
    extractor = PdfplumberExtractor()

    mock_page = MagicMock()
    mock_page.extract_text.return_value = (
        "1. Introduction\n"
        "Here is a table:\n"
        "Table 1: Benchmark Results\n"
        "Equation: E = mc^2\n"
        "Another equation: \\begin{equation}x + y = z\\end{equation}\n"
    )
    mock_page.extract_tables.return_value = [
        [
            ["Model", "Accuracy"],
            ["GPT-4", "95%"],
            ["Claude", "94%"],
        ]
    ]

    mock_pdf = MagicMock()
    mock_pdf.pages = [mock_page]
    mock_pdf.__enter__.return_value = mock_pdf

    with patch("pdfplumber.open", return_value=mock_pdf):
        res = asyncio.run(extractor.extract("dummy_paper.pdf", "dummy_paper.pdf"))

        assert res["page_count"] == 1
        assert len(res["tables"]) == 1
        assert res["tables"][0]["headers"] == ["Model", "Accuracy"]
        assert len(res["tables"][0]["rows"]) == 2
        assert len(res["equations"]) >= 1
        assert res["source"] == "local_pdfplumber"


def test_pdfplumber_extract_table_exception_handling():
    extractor = PdfplumberExtractor()

    mock_page = MagicMock()
    mock_page.extract_text.return_value = "Page content without tables"
    mock_page.extract_tables.side_effect = Exception("Table parse failed")

    mock_pdf = MagicMock()
    mock_pdf.pages = [mock_page]
    mock_pdf.__enter__.return_value = mock_pdf

    with patch("pdfplumber.open", return_value=mock_pdf):
        res = asyncio.run(extractor.extract("dummy.pdf", "dummy.pdf"))
        assert res["page_count"] == 1
        assert len(res["tables"]) == 0
