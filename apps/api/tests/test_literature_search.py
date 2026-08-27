"""
Unit + endpoint tests for app.services.literature_search_service and
GET /api/v1/research/search (keyless online literature discovery).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.authors import split_full_name
from app.services.literature_search_service import (
    LiteratureSearchService,
    _clean_doi,
    _strip_tags,
    literature_search_service,
)


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


service = LiteratureSearchService()


def _mock_response(status_code=200, json_data=None, text=""):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = text
    return resp


class TestHelpers:
    def test_split_author_name_full(self):
        author = split_full_name("Ashish Vaswani")
        assert author["familyName"] == "Vaswani"
        assert author["givenName"] == "Ashish"
        assert author["literal"] == "Ashish Vaswani"

    def test_split_author_name_single(self):
        author = split_full_name("Cher")
        assert author["familyName"] == "Cher"
        assert author["givenName"] == ""

    def test_clean_doi_url(self):
        assert _clean_doi("https://doi.org/10.1000/xyz") == "10.1000/xyz"

    def test_clean_doi_none_and_empty(self):
        assert _clean_doi(None) is None
        assert _clean_doi("") is None

    def test_strip_tags_jats(self):
        assert _strip_tags("<jats:p>Hello <b>world</b></jats:p>") == "Hello world"

    def test_strip_tags_none(self):
        assert _strip_tags(None) is None


class TestOpenAlex:
    def test_parses_works_and_reconstructs_abstract(self):
        inverted = {"Transformers": [0], "are": [1], "great": [2]}
        payload = {
            "meta": {"count": 42},
            "results": [
                {
                    "display_name": "Attention Is All You Need",
                    "publication_year": 2017,
                    "abstract_inverted_index": inverted,
                    "doi": "https://doi.org/10.5555/att",
                    "ids": {},
                    "authorships": [{"author": {"display_name": "Ashish Vaswani"}}],
                    "open_access": {
                        "is_oa": True,
                        "oa_url": "https://oa.example/att.pdf",
                    },
                    "best_oa_location": {"pdf_url": None},
                    "primary_location": {"source": {"display_name": "NeurIPS"}},
                    "cited_by_count": 90000,
                }
            ],
        }
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(json_data=payload))
            mock_client_factory.return_value = client

            result = run(service.search_openalex("attention"))

        assert result["status"] == "ok"
        assert result["total"] == 42
        paper = result["results"][0]
        assert paper["title"] == "Attention Is All You Need"
        assert paper["year"] == 2017
        assert paper["abstract"] == "Transformers are great"
        assert paper["doi"] == "10.5555/att"
        assert paper["url"] == "https://doi.org/10.5555/att"
        assert paper["pdf_url"] == "https://oa.example/att.pdf"
        assert paper["open_access"] is True
        assert paper["venue"] == "NeurIPS"
        assert paper["citation_count"] == 90000
        assert paper["authors"][0]["familyName"] == "Vaswani"

    def test_non_200_raises(self):
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(status_code=500))
            mock_client_factory.return_value = client

            try:
                run(service.search_openalex("boom"))
                raised = False
            except ValueError as exc:
                raised = True
                assert "HTTP 500" in str(exc)
            assert raised


class TestCrossref:
    def test_parses_items_with_license_oa(self):
        payload = {
            "message": {
                "total-results": 7,
                "items": [
                    {
                        "title": ["A Crossref Work"],
                        "author": [{"given": "Ada", "family": "Lovelace"}],
                        "issued": {"date-parts": [[1843]]},
                        "container-title": ["Analytical Engines"],
                        "DOI": "10.5555/cr",
                        "abstract": "<jats:title>Abstract</jats:title><jats:p>Notes.</jats:p>",
                        "is-referenced-by-count": 12,
                        "license": [{"URL": "https://creativecommons.org/licenses/by/4.0/"}],
                        "link": [
                            {
                                "content-type": "application/pdf",
                                "URL": "https://example.org/a.pdf",
                            }
                        ],
                    }
                ],
            }
        }
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(json_data=payload))
            mock_client_factory.return_value = client

            result = run(service.search_crossref("engines"))

        paper = result["results"][0]
        assert result["total"] == 7
        assert paper["title"] == "A Crossref Work"
        assert paper["authors"][0] == {
            "familyName": "Lovelace",
            "givenName": "Ada",
            "literal": "Ada Lovelace",
        }
        assert paper["year"] == 1843
        assert paper["venue"] == "Analytical Engines"
        assert paper["abstract"] == "Abstract Notes."
        assert paper["pdf_url"] == "https://example.org/a.pdf"
        assert paper["open_access"] is True
        assert paper["citation_count"] == 12

    def test_year_filters_passed_to_api(self):
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(json_data={"message": {}}))
            mock_client_factory.return_value = client

            result = run(service.search_crossref("x", year_start=2020, year_end=2024))

        _, kwargs = client.get.call_args
        assert "from-pub-date:2020-01-01" in kwargs["params"]["filter"]
        assert "until-pub-date:2024-12-31" in kwargs["params"]["filter"]
        assert result["status"] == "ok"


class TestArxiv:
    ARXIV_ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Feed</title>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <summary>We propose the Transformer.
New line kept as space.</summary>
    <published>2017-06-12T17:57:34Z</published>
    <author><name>Ashish Vaswani</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.5555/att</arxiv:doi>
    <link title="pdf" type="application/pdf" href="http://arxiv.org/pdf/1706.03762v7"/>
  </entry>
</feed>"""

    def test_parses_atom_entries(self):
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(text=self.ARXIV_ATOM))
            mock_client_factory.return_value = client

            result = run(service.search_arxiv("attention transformer"))

        paper = result["results"][0]
        assert result["source"] == "arXiv"
        assert paper["title"] == "Attention Is All You Need"
        assert paper["arxiv_id"] == "1706.03762"
        assert paper["url"] == "https://arxiv.org/abs/1706.03762"
        assert paper["pdf_url"] == "https://arxiv.org/pdf/1706.03762"
        assert paper["year"] == 2017
        assert paper["open_access"] is True
        assert paper["venue"] == "arXiv preprint"
        assert paper["abstract"].startswith("We propose the Transformer.")
        assert paper["authors"][0]["literal"] == "Ashish Vaswani"

    def test_submitted_date_range_in_query(self):
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(text="<feed></feed>"))
            mock_client_factory.return_value = client

            result = run(service.search_arxiv("q", year_start=2019, year_end=2021))

        _, kwargs = client.get.call_args
        assert "submittedDate:[201901010000 TO 202112312359]" in kwargs["params"]["search_query"]
        assert result["results"] == []


class TestSemanticScholar:
    def test_parses_papers(self):
        payload = {
            "total": 3,
            "data": [
                {
                    "title": "S2 Paper",
                    "abstract": "An abstract.",
                    "authors": [{"name": "Grace Hopper"}],
                    "year": 1952,
                    "externalIds": {
                        "DOI": "10.5555/s2",
                        "ArXiv": "2201.00001",
                        "PubMed": "12345",
                    },
                    "url": "https://www.semanticscholar.org/paper/x",
                    "isOpenAccess": True,
                    "openAccessPdf": {"url": "https://s2.example/p.pdf"},
                    "venue": "UNIVAC",
                    "citationCount": 55,
                }
            ],
        }
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(json_data=payload))
            mock_client_factory.return_value = client

            result = run(service.search_semantic_scholar("compilers", open_access_only=True))

        paper = result["results"][0]
        assert result["total"] == 3
        assert paper["doi"] == "10.5555/s2"
        assert paper["arxiv_id"] == "2201.00001"
        assert paper["pmid"] == "12345"
        assert paper["pdf_url"] == "https://s2.example/p.pdf"
        assert paper["open_access"] is True

    def test_rate_limit_maps_to_error(self):
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(status_code=429))
            mock_client_factory.return_value = client

            outcome = run(service.search(query="hot topic", sources=["semantic_scholar"]))

        source = outcome["sources"][0]
        assert source["status"] == "error"
        assert "rate limit" in source["error"].lower()
        assert source["results"] == []


class TestAggregationAndCache:
    def test_unknown_source_isolated_per_provider(self):
        async def scenario():
            with patch.object(
                service,
                "search_openalex",
                new=AsyncMock(side_effect=ValueError("down")),
            ):
                return await service.search("anything", sources=["openalex"])

        outcome = run(scenario())
        source = outcome["sources"][0]
        assert source["source"] == "OpenAlex"
        assert source["status"] == "error"
        assert source["results"] == []

    def test_second_call_hits_cache_without_network(self):
        key_probe = "cache-probe-query-unique-123"

        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(text="<feed></feed>"))
            mock_client_factory.return_value = client
            first = run(service.search_arxiv(key_probe))

        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory_2,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache_2,
        ):
            mock_cache_2.aget = AsyncMock(return_value=first)
            mock_cache_2.aset = AsyncMock()
            client2 = MagicMock()
            client2.get = AsyncMock()
            mock_client_factory_2.return_value = client2
            second = run(service.search_arxiv(key_probe))

        client2.get.assert_not_called()
        assert second == first

    def test_dispatch_unknown_provider_raises(self):
        try:
            run(service._dispatch("not_a_provider"))
            raised = False
        except ValueError:
            raised = True
        assert raised

    def test_singleton_exists(self):
        assert literature_search_service is not None


class TestFilterVariantsAndCacheHits:
    """Covers year/OA filter branches, cache-hit returns and error paths."""

    def test_openalex_year_and_oa_filters_then_cache_hit(self):
        payload = {"meta": {"count": 0}, "results": []}
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(
                side_effect=[
                    None,
                    {"source": "OpenAlex", "status": "ok", "results": []},
                ]
            )
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(json_data=payload))
            mock_client_factory.return_value = client

            first = run(
                service.search_openalex(
                    "filters", year_start=2018, year_end=2023, open_access_only=True
                )
            )
            _, kwargs = client.get.call_args
            second = run(service.search_openalex("filters"))

        assert "from_publication_date:2018-01-01" in kwargs["params"]["filter"]
        assert "to_publication_date:2023-12-31" in kwargs["params"]["filter"]
        assert "is_oa:true" in kwargs["params"]["filter"]
        assert first["status"] == "ok"
        assert second == {"source": "OpenAlex", "status": "ok", "results": []}

    def test_openalex_skips_abstract_when_inverted_index_missing(self):
        payload = {
            "meta": {"count": 1},
            "results": [
                {
                    "display_name": "No Abstract Work",
                    "abstract_inverted_index": None,
                    "authorships": [],
                }
            ],
        }
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(json_data=payload))
            mock_client_factory.return_value = client

            result = run(service.search_openalex("no abstract"))

        assert result["results"][0]["abstract"] is None
        assert result["results"][0]["title"] == "No Abstract Work"

    def test_crossref_oa_filter_then_cache_hit(self):
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            cached = {"source": "Crossref", "status": "ok", "results": []}
            mock_cache.aget = AsyncMock(side_effect=[None, cached])
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(json_data={"message": {}}))
            mock_client_factory.return_value = client

            first = run(service.search_crossref("q", open_access_only=True))
            _, kwargs = client.get.call_args
            second = run(service.search_crossref("q", open_access_only=True))

        assert "license:*creativecommons*" in kwargs["params"]["filter"]
        assert first["status"] == "ok"
        assert second == cached
        client.get.assert_awaited_once()

    def test_crossref_non_200_raises_value_error(self):
        async def scenario():
            with (
                patch(
                    "app.services.literature_search_service.get_async_http_client"
                ) as mock_client_factory,
                patch(
                    "app.services.literature_search_service.provider_cache_service"
                ) as mock_cache,
            ):
                mock_cache.aget = AsyncMock(return_value=None)
                mock_cache.aset = AsyncMock()
                client = MagicMock()
                client.get = AsyncMock(return_value=_mock_response(status_code=503))
                mock_client_factory.return_value = client
                return await service.search_crossref("boom")

        try:
            run(scenario())
            raised = False
        except ValueError as exc:
            raised = True
            assert "HTTP 503" in str(exc)
        assert raised

    @pytest.mark.parametrize(
        "kwargs,expected_fragment",
        [
            ({"year_start": 2019}, "submittedDate:[201901010000 TO 209912312359]"),
            ({"year_end": 2021}, "submittedDate:[199001010000 TO 202112312359]"),
        ],
    )
    def test_arxiv_single_sided_year_filters(self, kwargs, expected_fragment):
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            mock_cache.aget = AsyncMock(return_value=None)
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(return_value=_mock_response(text="<feed></feed>"))
            mock_client_factory.return_value = client

            result = run(service.search_arxiv("q", **kwargs))

        _, call_kwargs = client.get.call_args
        assert expected_fragment in call_kwargs["params"]["search_query"]
        assert result["results"] == []

    @pytest.mark.parametrize(
        "kwargs,expected_year",
        [
            ({"year_start": 2001, "year_end": 2005}, "2001-2005"),
            ({"year_start": 2001}, "2001-"),
            ({"year_end": 2005}, "-2005"),
        ],
    )
    def test_semantic_scholar_year_variants_cache_hit_and_error(self, kwargs, expected_year):
        payload = {"total": 0, "data": []}
        with (
            patch(
                "app.services.literature_search_service.get_async_http_client"
            ) as mock_client_factory,
            patch("app.services.literature_search_service.provider_cache_service") as mock_cache,
        ):
            cached = {"source": "Semantic Scholar", "status": "ok", "results": []}
            mock_cache.aget = AsyncMock(side_effect=[None, cached, None])
            mock_cache.aset = AsyncMock()
            client = MagicMock()
            client.get = AsyncMock(
                side_effect=[
                    _mock_response(json_data=payload),  # 1st (miss): ok
                    _mock_response(status_code=500),  # 3rd ("z" miss): error
                ]
            )
            mock_client_factory.return_value = client

            first = run(service.search_semantic_scholar("y", **kwargs))
            _, call_kwargs = client.get.call_args
            second = run(service.search_semantic_scholar("y", **kwargs))
            outcome = run(service.search(query="z", sources=["semantic_scholar"], **kwargs))

        assert call_kwargs["params"]["year"] == expected_year
        assert first["status"] == "ok"
        assert second == cached
        assert client.get.await_count == 2  # 2nd came from cache
        assert outcome["sources"][0]["status"] == "error"


# --- Endpoint tests ------------------------------------------------------


def _register(client: TestClient, email: str) -> dict:
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "Secure_Password_123",
            "name": f"User {email}",
        },
    )
    assert res.status_code in (200, 201), res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


class TestResearchSearchEndpoint:
    def test_anonymous_request_resolves_local_user(self, client: TestClient):
        """App runs in single-user local mode: unauthenticated requests are allowed."""
        resp = client.get("/api/v1/research/search", params={"q": "transformers"})
        assert resp.status_code == 200

    def test_rejects_unknown_source(self, client: TestClient):
        headers = _register(client, "research_src@openresearch.org")
        resp = client.get(
            "/api/v1/research/search",
            params={"q": "x", "sources": "not_real"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "Unknown source" in resp.json()["error"]["message"]

    def test_rejects_empty_source_list(self, client: TestClient):
        headers = _register(client, "research_empty@openresearch.org")
        resp = client.get(
            "/api/v1/research/search",
            params={"q": "x", "sources": ","},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_rejects_inverted_year_range(self, client: TestClient):
        headers = _register(client, "research_years@openresearch.org")
        resp = client.get(
            "/api/v1/research/search",
            params={"q": "x", "year_start": 2030, "year_end": 2010},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_aggregates_mocked_sources(self, client: TestClient):
        headers = _register(client, "research_ok@openresearch.org")

        fake_outcome = {
            "query": "transformers",
            "sources": [
                {
                    "source": "OpenAlex",
                    "status": "ok",
                    "error": None,
                    "total": 1,
                    "results": [
                        {
                            "title": "Mocked Work",
                            "authors": [],
                            "year": 2024,
                            "abstract": None,
                            "doi": "10.5555/m",
                            "arxiv_id": None,
                            "pmid": None,
                            "venue": None,
                            "url": "https://doi.org/10.5555/m",
                            "pdf_url": None,
                            "open_access": False,
                            "citation_count": 3,
                            "source": "OpenAlex",
                        }
                    ],
                },
                {
                    "source": "arXiv",
                    "status": "error",
                    "error": "down",
                    "total": None,
                    "results": [],
                },
            ],
        }

        with patch.object(
            literature_search_service,
            "search",
            new=AsyncMock(return_value=fake_outcome),
        ):
            resp = client.get(
                "/api/v1/research/search", params={"q": "transformers"}, headers=headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["query"] == "transformers"
        assert len(body["sources"]) == 2
        assert body["sources"][0]["results"][0]["title"] == "Mocked Work"
        assert body["sources"][1]["status"] == "error"
