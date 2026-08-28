"""Comprehensive tests for canonical author-name parsing and normalization."""

from app.core.authors import parse_bibtex_author_field, split_full_name


class TestSplitFullName:
    def test_empty_or_whitespace(self):
        assert split_full_name("") == {
            "familyName": "Unknown",
            "givenName": "",
            "literal": "Unknown",
        }
        assert split_full_name("   ") == {
            "familyName": "Unknown",
            "givenName": "",
            "literal": "Unknown",
        }
        assert split_full_name(None) == {
            "familyName": "Unknown",
            "givenName": "",
            "literal": "Unknown",
        }

    def test_comma_separated_names(self):
        # Normal "Last, First"
        res = split_full_name("Smith, John")
        assert res["familyName"] == "Smith"
        assert res["givenName"] == "John"
        assert res["literal"] == "Smith, John"

        # Missing family before comma
        res2 = split_full_name(", John")
        assert res2["familyName"] == "Unknown"
        assert res2["givenName"] == "John"

        # Comma with no given name
        res3 = split_full_name("Smith,")
        assert res3["familyName"] == "Smith"
        assert res3["givenName"] == ""

        # Just a comma
        res4 = split_full_name(",")
        assert res4["familyName"] == "Unknown"
        assert res4["givenName"] == ""

    def test_western_order_family_last(self):
        # Single name
        res1 = split_full_name("Plato")
        assert res1["familyName"] == "Plato"
        assert res1["givenName"] == ""

        # First Last
        res2 = split_full_name("John Smith")
        assert res2["familyName"] == "Smith"
        assert res2["givenName"] == "John"

        # Multi-token name: First Middle Last
        res3 = split_full_name("John Ronald Reuel Tolkien")
        assert res3["familyName"] == "Tolkien"
        assert res3["givenName"] == "John Ronald Reuel"

    def test_pubmed_order_family_first(self):
        # Single token
        res1 = split_full_name("Smith", family_first=True)
        assert res1["familyName"] == "Smith"
        assert res1["givenName"] == ""

        # Family first with initials
        res2 = split_full_name("Smith J", family_first=True)
        assert res2["familyName"] == "Smith"
        assert res2["givenName"] == "J"

        # Family first with multiple given tokens
        res3 = split_full_name("Smith John R", family_first=True)
        assert res3["familyName"] == "Smith"
        assert res3["givenName"] == "John R"


class TestParseBibtexAuthorField:
    def test_empty_inputs(self):
        assert parse_bibtex_author_field("") == []
        assert parse_bibtex_author_field("   ") == []
        assert parse_bibtex_author_field(None) == []

    def test_multiple_authors_with_and(self):
        raw = "Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob"
        authors = parse_bibtex_author_field(raw)
        assert len(authors) == 4
        assert authors[0]["familyName"] == "Vaswani"
        assert authors[0]["givenName"] == "Ashish"
        assert authors[1]["familyName"] == "Shazeer"
        assert authors[1]["givenName"] == "Noam"

    def test_braces_and_extra_whitespace(self):
        raw = " {Vaswani, Ashish} and {OpenAI Team} and    "
        authors = parse_bibtex_author_field(raw)
        assert len(authors) == 2
        assert authors[0]["familyName"] == "Vaswani"
        assert authors[0]["givenName"] == "Ashish"
        assert authors[1]["familyName"] == "Team"
        assert authors[1]["givenName"] == "OpenAI"
