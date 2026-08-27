"""
Unit tests for app.services.pdf_extractor (PDFValidator + _parse_tei_xml).
"""

import pytest

from app.services.pdf_extractor import (
    MATH_SYMBOLS,
    SECTION_PATTERNS,
    PDFExtractionError,
    PDFExtractorService,
    PDFValidator,
)

# ---------------------------------------------------------------------------
# PDFValidator.validate_pdf_bytes
# ---------------------------------------------------------------------------

MINIMAL_PDF = b"%PDF-1.4 minimal test content"


class TestPDFValidatorValidateBytes:
    def test_empty_bytes_raises(self):
        with pytest.raises(PDFExtractionError, match="empty"):
            PDFValidator.validate_pdf_bytes(b"")

    def test_oversized_raises(self):
        big = b"%PDF-" + b"x" * (51 * 1024 * 1024)  # 51 MB
        with pytest.raises(PDFExtractionError, match="exceeds maximum"):
            PDFValidator.validate_pdf_bytes(big)

    def test_not_a_pdf_raises(self):
        with pytest.raises(PDFExtractionError, match="Not a valid PDF"):
            PDFValidator.validate_pdf_bytes(b"Not a PDF file at all")

    def test_valid_pdf_passes(self):
        # Should not raise
        PDFValidator.validate_pdf_bytes(MINIMAL_PDF)

    def test_pdf_magic_bytes_within_first_1024(self):
        # Preamble with PDF header somewhere in first 1024 bytes
        content = b"\x00" * 100 + b"%PDF-1.4" + b"content"
        PDFValidator.validate_pdf_bytes(content)  # should not raise

    def test_pdf_magic_bytes_beyond_1024_raises(self):
        content = b"\x00" * 2000 + b"%PDF-1.4" + b"content"
        with pytest.raises(PDFExtractionError, match="Not a valid PDF"):
            PDFValidator.validate_pdf_bytes(content)


# ---------------------------------------------------------------------------
# PDFValidator.sanitize_filename
# ---------------------------------------------------------------------------


class TestPDFValidatorSanitizeFilename:
    def test_normal_filename(self):
        result = PDFValidator.sanitize_filename("my_paper.pdf")
        assert result == "my_paper.pdf"

    def test_strips_directory_traversal(self):
        result = PDFValidator.sanitize_filename("../../etc/passwd")
        assert ".." not in result

    def test_adds_pdf_extension_if_missing(self):
        result = PDFValidator.sanitize_filename("my_paper")
        assert result.endswith(".pdf")

    def test_special_chars_replaced(self):
        result = PDFValidator.sanitize_filename("my paper (2024).pdf")
        assert " " not in result
        assert "(" not in result

    def test_preserves_alphanumeric_and_safe_chars(self):
        result = PDFValidator.sanitize_filename("safe_file-name.pdf")
        assert result == "safe_file-name.pdf"


# ---------------------------------------------------------------------------
# _parse_tei_xml
# ---------------------------------------------------------------------------

TEI_XML_BASIC = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>Attention Is All You Need</title>
      </titleStmt>
      <publicationStmt>
        <date when="2017-06-12"/>
      </publicationStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author>
              <persName>
                <forename type="first">Ashish</forename>
                <surname>Vaswani</surname>
              </persName>
            </author>
          </analytic>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
    <profileDesc>
      <abstract>
        <p>We propose the Transformer architecture based purely on attention.</p>
      </abstract>
    </profileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <head>Introduction</head>
        <p>Sequence transduction models are generally based on neural networks.</p>
      </div>
      <div>
        <head>Method</head>
        <p>The Transformer uses self-attention mechanisms exclusively.</p>
      </div>
    </body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct>
            <analytic>
              <title>Long Short-Term Memory</title>
              <author>
                <persName>
                  <surname>Hochreiter</surname>
                </persName>
              </author>
            </analytic>
            <monogr>
              <date when="1997"/>
            </monogr>
          </biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>"""

TEI_XML_WITH_DOI = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Test Paper</title></titleStmt>
      <publicationStmt>
        <idno type="DOI">10.1234/test</idno>
        <date when="2021-01-01"/>
      </publicationStmt>
      <sourceDesc><biblStruct><analytic></analytic></biblStruct></sourceDesc>
    </fileDesc>
    <profileDesc><abstract></abstract></profileDesc>
  </teiHeader>
  <text><body></body></text>
</TEI>"""


class TestParseTeiXml:
    def setup_method(self):
        self.service = PDFExtractorService(grobid_url=None)

    def test_title_extracted(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        assert result["title"] == "Attention Is All You Need"

    def test_abstract_extracted(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        assert "attention" in result["abstract"].lower()

    def test_authors_extracted(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        authors = result["authors"]
        assert len(authors) >= 1
        assert authors[0]["familyName"] == "Vaswani"
        assert authors[0]["givenName"] == "Ashish"

    def test_year_extracted(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        assert result["year"] == 2017

    def test_sections_extracted(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        sections = result["sections"]
        section_titles = [s["title"] for s in sections]
        assert "Introduction" in section_titles or "Abstract" in section_titles

    def test_references_extracted(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        refs = result["references"]
        assert len(refs) >= 1
        assert refs[0]["title"] == "Long Short-Term Memory"

    def test_doi_extracted(self):
        result = self.service._parse_tei_xml(TEI_XML_WITH_DOI)
        assert result["doi"] == "10.1234/test"

    def test_no_doi_returns_none(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        assert result["doi"] is None

    def test_result_has_required_keys(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        for key in ["title", "authors", "abstract", "doi", "year", "sections", "references"]:
            assert key in result

    def test_confidence_and_unverified_in_sections(self):
        result = self.service._parse_tei_xml(TEI_XML_BASIC)
        for section in result["sections"]:
            assert "confidence" in section
            assert "unverified" in section


# ---------------------------------------------------------------------------
# PDFExtractorService init
# ---------------------------------------------------------------------------


class TestPDFExtractorServiceInit:
    def test_default_grobid_url_from_settings(self):
        service = PDFExtractorService()
        assert service.grobid_url is not None

    def test_custom_grobid_url(self):
        service = PDFExtractorService(grobid_url="http://localhost:8070")
        assert service.grobid_url == "http://localhost:8070"


# ---------------------------------------------------------------------------
# Module-level constants sanity checks
# ---------------------------------------------------------------------------


class TestModuleConstants:
    def test_section_patterns_not_empty(self):
        assert len(SECTION_PATTERNS) > 0

    def test_math_symbols_not_empty(self):
        assert len(MATH_SYMBOLS) > 0

    def test_section_patterns_are_strings(self):
        for p in SECTION_PATTERNS:
            assert isinstance(p, str)
