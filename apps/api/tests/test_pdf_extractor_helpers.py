"""
Unit tests for pdf_extractor helper methods (no I/O required).
"""

import pytest

from app.services.pdf_extractor import PDFExtractorService


@pytest.fixture
def svc():
    return PDFExtractorService(grobid_url="http://localhost:8070")


# ---------------------------------------------------------------------------
# _extract_metadata_from_text
# ---------------------------------------------------------------------------


class TestExtractMetadataFromText:
    def test_extracts_doi(self, svc):
        full_text = "Some text with DOI 10.1234/test.paper in it."
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text(
            "", full_text, ""
        )
        assert doi == "10.1234/test.paper"

    def test_extracts_arxiv_id(self, svc):
        full_text = "arXiv:2301.12345 preprint paper."
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text(
            "", full_text, ""
        )
        assert arxiv_id == "2301.12345"

    def test_extracts_year(self, svc):
        first_page = "Published in 2021. Some title here."
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text(
            first_page, first_page, ""
        )
        assert year == 2021

    def test_extracts_abstract(self, svc):
        full_text = (
            "Title Here\n"
            "Abstract: This paper presents a novel approach to machine learning.\n"
            "1. Introduction\nMore text here."
        )
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text(
            full_text[:500], full_text, ""
        )
        assert "machine learning" in abstract.lower()

    def test_title_from_filename_fallback(self, svc):
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text(
            "", "", "my_research_paper.pdf"
        )
        assert len(title) > 4
        assert "my" in title.lower() or "research" in title.lower()

    def test_untitled_fallback(self, svc):
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text("", "", "")
        assert title == "Untitled Research Paper"

    def test_unknown_author_fallback(self, svc):
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text("", "", "")
        assert authors[0]["familyName"] == "Unknown Author"

    def test_no_doi_returns_none(self, svc):
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text(
            "Just some plain text.", "Just some plain text.", ""
        )
        assert doi is None

    def test_no_arxiv_returns_none(self, svc):
        title, authors, abstract, year, doi, arxiv_id = svc._extract_metadata_from_text(
            "No arXiv here.", "No arXiv here.", ""
        )
        assert arxiv_id is None


# ---------------------------------------------------------------------------
# _segment_sections
# ---------------------------------------------------------------------------


class TestSegmentSections:
    def test_abstract_section_added_when_present(self, svc):
        pages = [{"page_number": 1, "text": "Introduction\nThis is the intro."}]
        sections = svc._segment_sections(pages, abstract="This is the abstract text.")
        titles = [s["title"] for s in sections]
        assert "Abstract" in titles

    def test_section_headings_detected(self, svc):
        text = (
            "Abstract\nThis is the abstract.\n\n"
            "Introduction\nThis is the introduction to the paper.\n\n"
            "Conclusion\nWe conclude this paper with findings."
        )
        pages = [{"page_number": 1, "text": text}]
        sections = svc._segment_sections(pages, abstract="")
        titles = [s["title"] for s in sections]
        assert any("introduction" in t.lower() for t in titles) or any(
            "conclusion" in t.lower() for t in titles
        )

    def test_fallback_page_sections_when_no_headings(self, svc):
        text = "This is some random text without any known section headings in it."
        pages = [{"page_number": 1, "text": text}]
        sections = svc._segment_sections(pages, abstract="")
        # Should create page-based fallback sections
        assert len(sections) >= 1

    def test_empty_pages_returns_empty_list(self, svc):
        sections = svc._segment_sections([], abstract="")
        assert sections == []

    def test_section_confidence_and_unverified_fields(self, svc):
        pages = [
            {
                "page_number": 1,
                "text": "Abstract\nSome text here.\nIntroduction\nSome more text here.",
            }
        ]
        sections = svc._segment_sections(pages, abstract="")
        for sec in sections:
            assert "confidence" in sec
            assert "unverified" in sec
            assert "id" in sec


# ---------------------------------------------------------------------------
# _extract_references_from_text
# ---------------------------------------------------------------------------


class TestExtractReferencesFromText:
    def test_extracts_bracketed_references(self, svc):
        text = (
            "Main text.\n\n"
            "References\n"
            "[1] Hochreiter, S. (1997). Long short-term memory.\n"
            "[2] Vaswani, A. (2017). Attention is all you need."
        )
        refs = svc._extract_references_from_text(text)
        assert len(refs) >= 1

    def test_returns_empty_when_no_references_section(self, svc):
        text = "Just a paper with no references listed."
        refs = svc._extract_references_from_text(text)
        assert refs == []

    def test_reference_has_required_keys(self, svc):
        text = "References\n[1] Smith, J. (2020). Deep learning advances."
        refs = svc._extract_references_from_text(text)
        if refs:
            ref = refs[0]
            for key in ["id", "title", "year", "raw_text"]:
                assert key in ref

    def test_year_extracted_from_reference(self, svc):
        text = "References\n[1] Smith, J. (2020). Deep learning advances in NLP research."
        refs = svc._extract_references_from_text(text)
        if refs:
            assert refs[0]["year"] == 2020


# ---------------------------------------------------------------------------
# _calculate_confidence
# ---------------------------------------------------------------------------


class TestCalculateConfidence:
    def test_high_confidence_all_fields(self, svc):
        sections = [
            {"title": "Abstract", "text": "A" * 100},
            {"title": "Introduction", "text": "B" * 200},
            {"title": "Conclusion", "text": "C" * 150},
        ]
        score, status = svc._calculate_confidence(
            title="A Good Title Here",
            abstract="A long abstract " * 5,
            sections=sections,
            total_chars=5000,
            page_count=5,
        )
        assert score >= 0.75
        assert status == "ok"

    def test_low_confidence_minimal_content(self, svc):
        score, status = svc._calculate_confidence(
            title="", abstract="", sections=[], total_chars=10, page_count=1
        )
        assert score < 0.60
        assert status == "unverified"

    def test_one_section_partial_score(self, svc):
        sections = [{"title": "Abstract", "text": "Some text"}]
        score, status = svc._calculate_confidence(
            title="Paper Title Here Long",
            abstract="Nice abstract content here " * 4,
            sections=sections,
            total_chars=2000,
            page_count=5,
        )
        assert 0.0 < score <= 1.0

    def test_score_capped_at_1(self, svc):
        sections = [{"title": s, "text": "X" * 500} for s in ["A", "B", "C", "D", "E"]]
        score, status = svc._calculate_confidence(
            title="Great Title Of Paper",
            abstract="Long abstract " * 10,
            sections=sections,
            total_chars=50000,
            page_count=10,
        )
        assert score <= 1.0

    def test_moderate_text_density_scoring(self, svc):
        score, status = svc._calculate_confidence(
            title="Untitled Research Paper", abstract="", sections=[], total_chars=800, page_count=4
        )
        # avg_chars_per_page = 200 → score += 0.15
        assert score > 0.0


# ---------------------------------------------------------------------------
# _merge_extractions
# ---------------------------------------------------------------------------


class TestMergeExtractions:
    def test_prefers_grobid_metadata(self, svc):
        grobid = {
            "title": "Grobid Title",
            "authors": [{"familyName": "Grobid Author"}],
            "abstract": "GROBID abstract",
            "doi": "10.1234/grobid",
            "year": 2023,
            "sections": [{"title": "Intro"}, {"title": "Method"}],
            "references": [{"title": "Ref1"}],
        }
        local = {
            "title": "Local Title",
            "authors": [{"familyName": "Local Author"}],
            "abstract": "Local abstract",
            "doi": "10.9999/local",
            "year": 2020,
            "sections": [{"title": "Page 1"}],
            "references": [],
            "tables": [{"id": "t1"}],
            "equations": [{"id": "e1"}],
            "pages": [{"page_number": 1, "text": "x"}],
            "page_count": 3,
            "arxiv_id": "2301.12345",
        }
        merged = svc._merge_extractions(grobid, local)
        assert merged["title"] == "Grobid Title"
        assert merged["doi"] == "10.1234/grobid"
        assert merged["year"] == 2023

    def test_falls_back_to_local_when_grobid_empty(self, svc):
        grobid = {
            "title": None,
            "authors": None,
            "abstract": "",
            "doi": None,
            "year": None,
            "sections": [],
            "references": [],
        }
        local = {
            "title": "Local Title",
            "authors": [{"familyName": "Local"}],
            "abstract": "Local abstract",
            "doi": "10.1234/local",
            "year": 2021,
            "sections": [{"title": "Sec"}],
            "references": [{"title": "Ref"}],
            "tables": [],
            "equations": [],
            "pages": [],
            "page_count": 1,
            "arxiv_id": None,
        }
        merged = svc._merge_extractions(grobid, local)
        assert merged["title"] == "Local Title"
        assert merged["doi"] == "10.1234/local"

    def test_tables_and_equations_always_from_local(self, svc):
        grobid = {
            "title": "G",
            "authors": [],
            "abstract": "",
            "doi": None,
            "year": None,
            "sections": [],
            "references": [],
        }
        local = {
            "title": "L",
            "authors": [],
            "abstract": "",
            "doi": None,
            "year": None,
            "sections": [],
            "references": [],
            "tables": [{"id": "t1"}, {"id": "t2"}],
            "equations": [{"id": "eq1"}],
            "pages": [],
            "page_count": 2,
            "arxiv_id": "9999.0001",
        }
        merged = svc._merge_extractions(grobid, local)
        assert len(merged["tables"]) == 2
        assert len(merged["equations"]) == 1
        assert merged["source"] == "grobid_enhanced"
        assert merged["confidence_score"] == 0.95
        assert merged["arxiv_id"] == "9999.0001"
