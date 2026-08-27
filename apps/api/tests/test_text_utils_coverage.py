"""Unit coverage for app.core.text_utils author/citation formatting helpers."""

from app.core.text_utils import (
    format_authors_bibliography,
    format_authors_inline,
    format_authors_summary,
    format_inline_marker,
    sanitize_surrogates,
)

AUTHOR = {"familyName": "Vaswani", "givenName": "Ashish"}
AUTHOR2 = {"familyName": "Shazeer", "givenName": "Noam"}


class TestSanitizeSurrogates:
    def test_empty_and_none_like(self):
        assert sanitize_surrogates("") == ""

    def test_lone_surrogate_replaced(self):
        dirty = "bad \ud800 tail"
        assert sanitize_surrogates(dirty) == "bad \ufffd tail"

    def test_clean_text_untouched(self):
        assert sanitize_surrogates("clean text") == "clean text"


class TestFormatAuthorsSummary:
    def test_non_list_author_falls_back_to_str(self):
        assert format_authors_summary("Solo String Author") == "Solo String Author"

    def test_dict_literal_and_name_keys(self):
        assert format_authors_summary([{"literal": "A. Literal"}]) == "A. Literal"
        assert format_authors_summary([{"name": "Named Only"}]) == "Named Only"

    def test_string_items(self):
        assert format_authors_summary(["One", "Two", "Three"]) == "One et al."


class TestFormatAuthorsInline:
    def test_mla_style_uses_and(self):
        assert format_authors_inline([AUTHOR, AUTHOR2], style="mla") == "Vaswani and Shazeer"


class TestFormatAuthorsBibliography:
    def test_str_author_passthrough(self):
        assert format_authors_bibliography(["Plain Name"], "apa") == "Plain Name"

    def test_non_dict_non_str_author(self):
        assert format_authors_bibliography([42], "apa") == "42"

    def test_gbt7714_single_and_et_al(self):
        single = format_authors_bibliography([AUTHOR], "gbt7714")
        assert single == "VASWANI A"
        many = [AUTHOR] * 4
        out = format_authors_bibliography(many, "gbt7714")
        assert out.endswith(", et al.")
        assert out.count("VASWANI A") == 3

    def test_oscola_single_natural_order(self):
        assert format_authors_bibliography([AUTHOR], "oscola") == "Ashish Vaswani"

    def test_abnt_styles(self):
        single = format_authors_bibliography([AUTHOR], "abnt")
        assert single == "VASWANI, A."
        trio = [{"familyName": f"Fam{i}", "givenName": "G"} for i in range(3)]
        assert "; ".join(["FAM0, G.", "FAM1, G.", "FAM2, G."]) == format_authors_bibliography(
            trio, "abnt"
        )
        quad = [{"familyName": f"Fam{i}", "givenName": "G"} for i in range(4)]
        assert format_authors_bibliography(quad, "abnt").startswith("FAM0, G. et al.")

    def test_ama_many_authors(self):
        many = [dict(AUTHOR) for _ in range(8)]
        out = format_authors_bibliography(many, "ama")
        assert out.startswith("Vaswani A")
        assert out.endswith(", et al.")

    def test_cse_many_authors(self):
        many = [dict(AUTHOR) for _ in range(12)]
        out = format_authors_bibliography(many, "cse")
        assert out.startswith("Vaswani A")
        assert out.endswith(", et al.")

    def test_asa_two_author_format(self):
        out = format_authors_bibliography([AUTHOR, AUTHOR2], "asa")
        assert out == "Vaswani, A., and Noam Shazeer"

    def test_mla_two_author_format(self):
        out = format_authors_bibliography([AUTHOR, AUTHOR2], "mla")
        assert out == "Vaswani, A., and Noam Shazeer"

    def test_chicago_two_author_format(self):
        out = format_authors_bibliography([AUTHOR, AUTHOR2], "chicago")
        assert out == "Vaswani, A., and Noam Shazeer"

    def test_bluebook_multi_natural_order(self):
        third = {"familyName": "Uszkoreit", "givenName": "Jakob"}
        out = format_authors_bibliography([AUTHOR, AUTHOR2, third], "bluebook")
        assert out == "Ashish Vaswani et al."


class TestFormatInlineMarker:
    def test_asa_inline(self):
        assert (
            format_inline_marker(authors=[AUTHOR], year=2017, style="asa", page_num=5)
            == "(Vaswani 2017: 5)"
        )

    def test_abnt_inline_multiple_families(self):
        marker = format_inline_marker(
            authors=[{"familyName": "Lima"}, "SOUSA", AUTHOR],
            year=2020,
            style="abnt",
        )
        assert marker == "(LIMA et al., 2020)"

    def test_abnt_inline_et_al(self):
        four = [
            {"familyName": "A1"},
            {"familyName": "A2"},
            {"familyName": "A3"},
        ]
        assert format_inline_marker(authors=four, year=2020, style="abnt").startswith(
            "(A1 et al., 2020)"
        )
