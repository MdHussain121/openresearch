"""Comprehensive tests for PDF extraction pipeline (OCRExtractor, GrobidClient, PDFExtractor facade)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.pdf import PDFExtractor
from app.services.pdf.grobid_client import GrobidClient
from app.services.pdf.ocr_extractor import OCRExtractor


class TestGrobidClient:
    def test_missing_grobid_url(self):
        client = GrobidClient()
        client.grobid_url = ""
        assert asyncio.run(client.extract("some_path.pdf")) is None
        assert asyncio.run(client.health_check()) is False

    @patch("app.services.pdf.grobid_client.get_async_http_client")
    @patch("builtins.open", MagicMock())
    def test_extract_success(self, mock_get_client):
        mock_http = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "<TEI>sample tei xml</TEI>"
        mock_http.post = AsyncMock(return_value=mock_resp)
        mock_get_client.return_value = mock_http

        client = GrobidClient(grobid_url="http://localhost:8070")
        tei = asyncio.run(client.extract("test.pdf"))
        assert tei == "<TEI>sample tei xml</TEI>"

    @patch("app.services.pdf.grobid_client.get_async_http_client")
    @patch("builtins.open", MagicMock())
    def test_extract_failure_status_and_exception(self, mock_get_client):
        mock_http = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Internal error"
        mock_http.post = AsyncMock(return_value=mock_resp)
        mock_get_client.return_value = mock_http

        client = GrobidClient(grobid_url="http://localhost:8070")
        assert asyncio.run(client.extract("test.pdf")) is None

        # Network exception
        mock_http.post = AsyncMock(side_effect=Exception("Connection refused"))
        assert asyncio.run(client.extract("test.pdf")) is None

    @patch("app.services.pdf.grobid_client.get_async_http_client")
    def test_health_check(self, mock_get_client):
        mock_http = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_http.get = AsyncMock(return_value=mock_resp)
        mock_get_client.return_value = mock_http

        client = GrobidClient(grobid_url="http://localhost:8070")
        assert asyncio.run(client.health_check()) is True

        mock_resp.status_code = 503
        assert asyncio.run(client.health_check()) is False

        mock_http.get = AsyncMock(side_effect=Exception("Unreachable"))
        assert asyncio.run(client.health_check()) is False


class TestOCRExtractor:
    def test_ocr_missing_dependencies(self):
        extractor = OCRExtractor()
        with patch.dict("sys.modules", {"pdf2image": None, "pytesseract": None}):
            res = asyncio.run(extractor.extract("dummy.pdf", "dummy.pdf"))
            assert res["extraction_status"] == "unverified"
            assert res["ocr_triggered"] is True
            assert "dependencies not installed" in res["ocr_error"]

    def test_ocr_pdf_conversion_failure(self):
        extractor = OCRExtractor()
        mock_pdf2image = MagicMock()
        mock_pdf2image.convert_from_path.side_effect = Exception("Corrupted PDF")
        mock_pytesseract = MagicMock()
        with patch.dict("sys.modules", {"pdf2image": mock_pdf2image, "pytesseract": mock_pytesseract}):
            res = asyncio.run(extractor.extract("corrupted.pdf", "corrupted.pdf"))
            assert res["extraction_status"] == "unverified"
            assert "conversion failed" in res["ocr_error"]

    def test_ocr_success_flow(self):
        extractor = OCRExtractor()
        mock_image = MagicMock()
        mock_pdf2image = MagicMock()
        mock_pdf2image.convert_from_path.return_value = [mock_image]
        mock_pytesseract = MagicMock()
        mock_pytesseract.image_to_string.return_value = "Deep Learning in Academic Writing\n\nAbstract\nThis paper explores AI.\n\n1. Introduction\nAdvances in NLP..."

        with patch.dict("sys.modules", {"pdf2image": mock_pdf2image, "pytesseract": mock_pytesseract}):
            res = asyncio.run(extractor.extract("sample.pdf", "sample.pdf"))
            assert res["extraction_status"] == "unverified"
            assert res["confidence_score"] <= 0.55
            assert res["ocr_triggered"] is True
            assert len(res["pages"]) == 1
            assert len(res["sections"]) >= 1

    def test_ocr_empty_text_extracted(self):
        extractor = OCRExtractor()
        mock_image = MagicMock()
        mock_pdf2image = MagicMock()
        mock_pdf2image.convert_from_path.return_value = [mock_image]
        mock_pytesseract = MagicMock()
        mock_pytesseract.image_to_string.return_value = "   "

        with patch.dict("sys.modules", {"pdf2image": mock_pdf2image, "pytesseract": mock_pytesseract}):
            res = asyncio.run(extractor.extract("empty.pdf", "empty.pdf"))
            assert res["extraction_status"] == "unverified"
            assert res["ocr_error"] == "No text extracted by OCR"


class TestPDFExtractorFacade:
    def test_merge_extractions_grobid_and_local(self):
        facade = PDFExtractor(grobid_url="http://localhost:8070")
        grobid_data = {
            "title": "GROBID Title",
            "authors": [{"familyName": "Smith"}],
            "abstract": "GROBID Abstract",
            "doi": "10.1000/182",
            "year": 2024,
            "sections": [{"title": "Sec 1", "text": "Text 1"}, {"title": "Sec 2", "text": "Text 2"}],
            "references": [{"title": "Ref 1"}],
        }
        local_data = {
            "title": "Local Title",
            "authors": [],
            "abstract": "",
            "doi": None,
            "arxiv_id": "2401.00001",
            "year": None,
            "page_count": 5,
            "sections": [],
            "tables": [{"title": "Table 1"}],
            "equations": [{"latex": "x^2"}],
            "pages": [{"page_number": 1, "text": "..."}],
        }

        merged = facade._merge_extractions(grobid_data, local_data)
        assert merged["title"] == "GROBID Title"
        assert merged["doi"] == "10.1000/182"
        assert merged["arxiv_id"] == "2401.00001"
        assert merged["source"] == "grobid_enhanced"
        assert merged["confidence_score"] == 0.95
        assert len(merged["tables"]) == 1
        assert len(merged["equations"]) == 1

    def test_merge_ocr_and_local(self):
        facade = PDFExtractor()
        base_data = {
            "title": "Base Title",
            "page_count": 2,
            "confidence_score": 0.2,
            "tables": [{"id": "t1"}],
            "equations": [{"id": "e1"}],
            "pre_ocr_chars_per_page": 20.0,
        }
        ocr_data = {
            "title": "OCR Extracted Title",
            "authors": [{"familyName": "Jones"}],
            "abstract": "Scanned Abstract",
            "doi": "10.1000/ocr",
            "year": 2021,
            "page_count": 2,
            "confidence_score": 0.45,
            "sections": [{"title": "Intro", "text": "OCR Text"}],
            "references": [],
            "pages": [{"page_number": 1, "text": "OCR Text"}],
        }

        merged = facade._merge_ocr(base_data, ocr_data)
        assert merged["title"] == "OCR Extracted Title"
        assert merged["source"] == "local_pdfplumber_ocr"
        assert merged["ocr_triggered"] is True
        assert len(merged["tables"]) == 1
        assert len(merged["equations"]) == 1
        assert merged["extraction_status"] == "unverified"
