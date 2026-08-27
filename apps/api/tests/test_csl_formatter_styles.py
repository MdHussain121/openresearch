"""Tests for csl_formatter.py — uncovered citation styles."""

from unittest.mock import MagicMock

from app.models.paper import Paper
from app.services.export.csl_formatter import format_bibliography_entry


def _paper(**overrides):
    p = MagicMock(spec=Paper)
    p.title = "Attention Is All You Need"
    p.year = 2017
    p.authors = [{"familyName": "Vaswani", "givenName": "Ashish"}]
    p.doi = "10.48550/arXiv.1706.03762"
    p.metadata_json = overrides.pop("metadata_json", {"journal": "NeurIPS", "volume": "30", "pages": "1-15"})
    for k, v in overrides.items():
        setattr(p, k, v)
    return p


def _paper_multi(n=3):
    p = _paper()
    p.authors = [{"familyName": f"Author{i}", "givenName": f"Given{i}"} for i in range(n)]
    return p


class TestAMAStyle:
    def test_single_author(self):
        result = format_bibliography_entry(_paper(), style="ama")
        assert "Attention Is All You Need" in result

    def test_many_authors_truncates(self):
        result = format_bibliography_entry(_paper_multi(8), style="ama")
        assert ", et al." in result


class TestCSEStyle:
    def test_cse_format(self):
        result = format_bibliography_entry(_paper(), style="cse")
        assert "Attention Is All You Need" in result
        assert "doi:" in result

    def test_many_cse_truncates(self):
        result = format_bibliography_entry(_paper_multi(12), style="cse")
        assert ", et al." in result


class TestNatureStyle:
    def test_nature_format(self):
        result = format_bibliography_entry(_paper(), style="nature")
        assert "2017" in result
        assert "Attention Is All You Need" in result

    def test_nature_no_year(self):
        p = _paper()
        p.year = None
        result = format_bibliography_entry(p, style="nature")
        assert "Attention Is All You Need" in result


class TestCellStyle:
    def test_cell_format(self):
        result = format_bibliography_entry(_paper(), style="cell")
        assert "2017" in result
        assert "Attention Is All You Need" in result


class TestScienceStyle:
    def test_science_format(self):
        result = format_bibliography_entry(_paper(), style="science")
        assert "2017" in result
        assert "Attention Is All You Need" in result

    def test_science_no_year(self):
        p = _paper()
        p.year = None
        result = format_bibliography_entry(p, style="science")
        assert "Attention Is All You Need" in result


class TestACMStyle:
    def test_acm_format(self):
        result = format_bibliography_entry(_paper(), style="acm")
        assert "[1]" in result
        assert "2017" in result
        assert "Attention Is All You Need" in result


class TestACSStyle:
    def test_acs_format(self):
        result = format_bibliography_entry(_paper(), style="acs")
        assert "Attention Is All You Need" in result


class TestChicagoNotesStyle:
    def test_chicago_notes_format(self):
        result = format_bibliography_entry(_paper(), style="chicago-notes")
        assert "2017" in result
        assert "Attention Is All You Need" in result

    def test_chicago_notes_no_year(self):
        p = _paper()
        p.year = None
        result = format_bibliography_entry(p, style="chicago-notes")
        assert "Attention Is All You Need" in result


class TestTurabianStyle:
    def test_turabian_format(self):
        result = format_bibliography_entry(_paper(), style="turabian")
        assert "2017" in result
        assert "Attention Is All You Need" in result


class TestASAStyle:
    def test_asa_format(self):
        result = format_bibliography_entry(_paper(), style="asa")
        assert "2017" in result
        assert "Attention Is All You Need" in result


class TestMHRStyle:
    def test_mhra_format(self):
        result = format_bibliography_entry(_paper(), style="mhra")
        assert "2017" in result
        assert "Attention Is All You Need" in result

    def test_mhra_two_authors(self):
        p = _paper()
        p.authors = [
            {"familyName": "Vaswani", "givenName": "Ashish"},
            {"familyName": "Shazeer", "givenName": "Noam"},
        ]
        result = format_bibliography_entry(p, style="mhra")
        assert "Attention Is All You Need" in result

    def test_mhra_many_authors(self):
        result = format_bibliography_entry(_paper_multi(5), style="mhra")
        assert "et al." in result


class TestOxfordStyle:
    def test_oxford_format(self):
        result = format_bibliography_entry(_paper(), style="oxford")
        assert "2017" in result
        assert "Attention Is All You Need" in result

    def test_oxford_no_journal(self):
        p = _paper(metadata_json={})
        result = format_bibliography_entry(p, style="oxford")
        assert "Attention Is All You Need" in result


class TestOSCOLAStyle:
    def test_oscola_format(self):
        result = format_bibliography_entry(_paper(), style="oscola")
        assert "2017" in result
        assert "Attention Is All You Need" in result

    def test_oscola_no_volume(self):
        p = _paper(metadata_json={"journal": "NeurIPS"})
        result = format_bibliography_entry(p, style="oscola")
        assert "Attention Is All You Need" in result


class TestBluebookStyle:
    def test_bluebook_format(self):
        result = format_bibliography_entry(_paper(), style="bluebook")
        assert "2017" in result
        assert "Attention Is All You Need" in result

    def test_bluebook_no_volume(self):
        p = _paper(metadata_json={"journal": "NeurIPS"})
        result = format_bibliography_entry(p, style="bluebook")
        assert "Attention Is All You Need" in result


class TestABNTStyle:
    def test_abnt_format(self):
        result = format_bibliography_entry(_paper(), style="abnt")
        assert "Attention Is All You Need" in result
        assert "2017" in result


class TestISO690Style:
    def test_iso690_format(self):
        result = format_bibliography_entry(_paper(), style="iso690")
        assert "2017" in result
        assert "Attention Is All You Need" in result


class TestGBT7714Style:
    def test_gbt7714_format(self):
        result = format_bibliography_entry(_paper(), style="gbt7714")
        assert "[J]" in result
        assert "Attention Is All You Need" in result

    def test_gbt7714_many_authors(self):
        result = format_bibliography_entry(_paper_multi(5), style="gbt7714")
        assert ", et al." in result
        assert "[J]" in result


class TestFallbackStyle:
    def test_unknown_style_falls_through(self):
        result = format_bibliography_entry(_paper(), style="unknownstyle")
        assert "NeurIPS" in result


class TestMissingFields:
    def test_no_journal(self):
        p = _paper(metadata_json={})
        result = format_bibliography_entry(p, style="apa")
        assert "Attention Is All You Need" in result

    def test_no_doi(self):
        p = _paper()
        p.doi = None
        result = format_bibliography_entry(p, style="apa")
        assert "Attention Is All You Need" in result

    def test_no_year(self):
        p = _paper()
        p.year = None
        result = format_bibliography_entry(p, style="apa")
        assert "n.d." in result
