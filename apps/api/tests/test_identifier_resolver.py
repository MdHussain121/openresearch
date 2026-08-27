"""
Comprehensive unit tests for app.services.identifier_resolver.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from app.services.identifier_resolver import IdentifierResolver


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


resolver = IdentifierResolver()


class TestDetectIdentifierType:
    def test_doi_prefix(self):
        assert resolver.detect_identifier_type("doi:10.1000/xyz") == "doi"

    def test_doi_org_url(self):
        assert resolver.detect_identifier_type("https://doi.org/10.1234/test") == "doi"

    def test_dx_doi_url(self):
        assert resolver.detect_identifier_type("http://dx.doi.org/10.1234/test") == "doi"

    def test_doi_regex_fallback(self):
        assert resolver.detect_identifier_type("10.5281/zenodo.1234567") == "doi"

    def test_arxiv_keyword(self):
        assert resolver.detect_identifier_type("arxiv:2301.12345") == "arxiv"

    def test_arxiv_number_pattern(self):
        assert resolver.detect_identifier_type("2301.12345") == "arxiv"

    def test_arxiv_with_version(self):
        assert resolver.detect_identifier_type("2301.12345v3") == "arxiv"

    def test_arxiv_october_month_not_doi(self):
        assert resolver.detect_identifier_type("1810.04805") == "arxiv"

    def test_arxiv_2010_not_doi(self):
        assert resolver.detect_identifier_type("2010.11929") == "arxiv"

    def test_arxiv_doi_alias_stays_doi(self):
        assert resolver.detect_identifier_type("10.48550/arXiv.1706.03762") == "doi"

    def test_pmid_prefix(self):
        assert resolver.detect_identifier_type("pmid:12345678") == "pmid"

    def test_pmid_seven_digits(self):
        assert resolver.detect_identifier_type("1234567") == "pmid"

    def test_default_doi(self):
        assert resolver.detect_identifier_type("some-random-text") == "doi"


class TestCleanDoi:
    def test_https_doi_org(self):
        assert resolver.clean_doi("https://doi.org/10.1000/xyz") == "10.1000/xyz"

    def test_http_dx_doi_org(self):
        assert resolver.clean_doi("http://dx.doi.org/10.1000/xyz") == "10.1000/xyz"

    def test_doi_colon(self):
        assert resolver.clean_doi("doi:10.1000/xyz") == "10.1000/xyz"

    def test_doi_colon_space(self):
        assert resolver.clean_doi("doi: 10.1000/xyz") == "10.1000/xyz"

    def test_bare_doi(self):
        assert resolver.clean_doi("10.1000/xyz") == "10.1000/xyz"


class TestCleanArxiv:
    def test_arxiv_abs_url(self):
        assert resolver.clean_arxiv("https://arxiv.org/abs/2301.12345") == "2301.12345"

    def test_arxiv_pdf_url(self):
        assert resolver.clean_arxiv("https://arxiv.org/pdf/2301.12345") == "2301.12345"

    def test_arxiv_pdf_ext(self):
        assert resolver.clean_arxiv("2301.12345.pdf") == "2301.12345"

    def test_arxiv_colon(self):
        assert resolver.clean_arxiv("arxiv:2301.12345") == "2301.12345"

    def test_bare_id(self):
        assert resolver.clean_arxiv("2301.12345") == "2301.12345"


class TestCleanPmid:
    def test_pmid_colon(self):
        assert resolver.clean_pmid("pmid:12345678") == "12345678"

    def test_pmid_uppercase_colon_space(self):
        assert resolver.clean_pmid("PMID: 12345678") == "12345678"

    def test_pubmed_url(self):
        result = resolver.clean_pmid("https://pubmed.ncbi.nlm.nih.gov/12345678/")
        assert "/" not in result
        assert "12345678" in result

    def test_bare_pmid(self):
        assert resolver.clean_pmid("12345678") == "12345678"


class TestResolveDispatch:
    def test_auto_doi(self):
        with patch.object(resolver, "resolve_doi", new=AsyncMock(return_value={"id_type": "doi"})):
            result = run(resolver.resolve("10.1234/test", id_type="auto"))
        assert result["id_type"] == "doi"

    def test_auto_arxiv(self):
        with patch.object(
            resolver, "resolve_arxiv", new=AsyncMock(return_value={"id_type": "arxiv"})
        ):
            result = run(resolver.resolve("2301.12345"))
        assert result["id_type"] == "arxiv"

    def test_auto_routes_october_arxiv_to_arxiv_resolver(self):
        with patch.object(
            resolver, "resolve_arxiv", new=AsyncMock(return_value={"id_type": "arxiv"})
        ) as m:
            result = run(resolver.resolve("1810.04805"))
        m.assert_called_once_with("1810.04805")
        assert result["id_type"] == "arxiv"

    def test_auto_pmid(self):
        with patch.object(
            resolver, "resolve_pmid", new=AsyncMock(return_value={"id_type": "pmid"})
        ):
            result = run(resolver.resolve("12345678"))
        assert result["id_type"] == "pmid"

    def test_unknown_type_falls_back_to_doi(self):
        with patch.object(
            resolver, "resolve_doi", new=AsyncMock(return_value={"id_type": "doi"})
        ) as m:
            run(resolver.resolve("some-id", id_type="unknown"))
            m.assert_called_once()


class TestResolveDoi:
    def test_unresolved_on_network_error(self):
        mock_client = MagicMock()
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("network error"))
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_doi("10.1234/paper"))
        assert result["doi"] == "10.1234/paper"
        assert result["extraction_status"] == "unresolved"
        assert result["title"] is None
        assert result["authors"] == []

    def test_crossref_success(self):
        payload = {
            "message": {
                "title": ["Attention Is All You Need"],
                "author": [{"family": "Vaswani", "given": "Ashish"}],
                "issued": {"date-parts": [[2017]]},
                "container-title": ["NeurIPS"],
                "abstract": "<p>Transformer.</p>",
                "publisher": "Curran",
                "volume": "30",
                "issue": "1",
                "page": "5998-6008",
            }
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = payload
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_doi("10.1000/test"))
        assert result["title"] == "Attention Is All You Need"
        assert result["year"] == 2017
        assert result["authors"][0]["familyName"] == "Vaswani"
        assert "<p>" not in result["abstract"]

    def test_no_authors_injects_unknown(self):
        payload = {"message": {"title": ["No Authors"], "issued": {"date-parts": [[2020]]}}}
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = payload
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_doi("10.9999/no-authors"))
        assert result["authors"][0]["familyName"] == "Unknown Author"

    def test_non_200_unresolved(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_doi("10.9999/missing"))
        assert result["extraction_status"] == "unresolved"
        assert result["title"] is None


class TestResolveArxiv:
    def test_fallback_on_error(self):
        mock_client = MagicMock()
        mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_arxiv("2301.12345"))
        assert result["id_type"] == "arxiv"
        assert result["arxiv_id"] == "2301.12345"
        assert result["extraction_status"] == "unresolved"
        assert result["title"] is None

    def test_version_stripped(self):
        mock_client = MagicMock()
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("offline"))
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_arxiv("1706.03762v3"))
        assert result["arxiv_id"] == "1706.03762"

    def test_xml_parsing(self):
        xml_body = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<feed xmlns="http://www.w3.org/2005/Atom">'
            "<entry>"
            "<title>Attention Is All You Need</title>"
            "<published>2017-06-12T00:00:00Z</published>"
            "<summary>Transformer for NLP.</summary>"
            "<author><name>Ashish Vaswani</name></author>"
            "</entry>"
            "</feed>"
        )
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = xml_body
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_arxiv("1706.03762"))
        assert result["title"] == "Attention Is All You Need"
        assert result["year"] == 2017
        assert result["authors"][0]["familyName"] == "Vaswani"

    def test_no_entry_falls_back(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "<feed><title>Empty</title></feed>"
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_arxiv("9999.00000"))
        assert result["id_type"] == "arxiv"
        assert result["extraction_status"] == "unresolved"


class TestResolvePmid:
    def test_fallback_on_error(self):
        mock_client = MagicMock()
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("connection refused"))
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_pmid("12345678"))
        assert result["pmid"] == "12345678"
        assert result["extraction_status"] == "unresolved"
        assert result["title"] is None

    def test_esummary_success(self):
        payload = {
            "result": {
                "36000000": {
                    "title": "CRISPR advances",
                    "authors": [{"name": "Zhang Feng"}, {"name": "Doudna Jennifer"}],
                    "pubdate": "2023 Mar",
                    "fulljournalname": "Nature Biotechnology",
                    "volume": "41",
                    "issue": "3",
                    "pages": "320-330",
                    "articleids": [{"idtype": "doi", "value": "10.1038/nbt.xxx"}],
                }
            }
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = payload
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_pmid("36000000"))
        assert result["title"] == "CRISPR advances"
        assert result["year"] == 2023
        assert result["doi"] == "10.1038/nbt.xxx"

    def test_no_authors_fallback(self):
        payload = {
            "result": {
                "11111": {
                    "title": "No Authors",
                    "authors": [],
                    "pubdate": "2022",
                    "articleids": [],
                }
            }
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = payload
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        with patch(
            "app.services.identifier_resolver.get_async_http_client", return_value=mock_client
        ):
            result = run(resolver.resolve_pmid("11111"))
        assert result["authors"][0]["familyName"] == "PubMed Author"
