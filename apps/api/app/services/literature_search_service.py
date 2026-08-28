import asyncio
import logging
import random
import re
import time
from typing import Any

from app.core.authors import split_full_name
from app.core.http_client import get_async_http_client
from app.services.provider_cache_service import provider_cache_service

logger = logging.getLogger("openresearch.literature_search")

SEARCH_TIMEOUT_SECONDS = 12.0
SEARCH_CACHE_TTL_SECONDS = 3600

_S2_lock = asyncio.Lock()
_S2_last_ts: float = 0.0
_S2_min_interval = 1.1  # S2 allows 1 req/sec with key, 1.1 gives buffer

PROVIDER_NAMES = {
    "openalex": "OpenAlex",
    "crossref": "Crossref",
    "arxiv": "arXiv",
    "semantic_scholar": "Semantic Scholar",
}


def _clean_doi(raw: str | None) -> str | None:
    if not raw:
        return None
    doi = raw.strip()
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi, flags=re.IGNORECASE)
    return doi or None


def _strip_tags(raw: str | None) -> str | None:
    if not raw:
        return None
    text = re.sub(r"<[^>]+>", " ", raw)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


async def _throttle_s2() -> None:
    global _S2_last_ts
    async with _S2_lock:
        now = time.monotonic()
        wait = _S2_min_interval - (now - _S2_last_ts)
        if wait > 0:
            await asyncio.sleep(wait + random.uniform(0, 0.05))
        _S2_last_ts = time.monotonic()


class LiteratureSearchService:
    """
    Searches open academic literature APIs (all keyless) and normalizes results:
      - OpenAlex (https://api.openalex.org)
      - Crossref (https://api.crossref.org)
       - arXiv export API (https://export.arxiv.org/api/query)
      - Semantic Scholar Graph API (https://api.semanticscholar.org/graph/v1)

    Every provider call is cached via provider_cache_service and failures are
    isolated per source so one unreachable API never breaks the whole search.
    """

    async def search(
        self,
        query: str,
        sources: list[str] | None = None,
        limit: int = 10,
        offset: int = 0,
        year_start: int | None = None,
        year_end: int | None = None,
        open_access_only: bool = False,
    ) -> dict[str, Any]:
        selected = [s for s in (sources or list(PROVIDER_NAMES.keys())) if s in PROVIDER_NAMES]

        async def _guarded(provider_key: str) -> dict[str, Any]:
            try:
                return await self._dispatch(
                    provider_key,
                    query=query,
                    limit=limit,
                    offset=offset,
                    year_start=year_start,
                    year_end=year_end,
                    open_access_only=open_access_only,
                )
            except Exception as exc:
                logger.warning("%s literature search failed for %r: %s", provider_key, query, exc)
                return {
                    "source": PROVIDER_NAMES[provider_key],
                    "status": "error",
                    "error": str(exc),
                    "total": None,
                    "results": [],
                }

        source_payloads = await asyncio.gather(*(_guarded(key) for key in selected))
        return {"query": query, "sources": list(source_payloads)}

    async def _dispatch(self, provider_key: str, **kwargs: Any) -> dict[str, Any]:
        if provider_key == "openalex":
            return await self.search_openalex(**kwargs)
        if provider_key == "crossref":
            return await self.search_crossref(**kwargs)
        if provider_key == "arxiv":
            return await self.search_arxiv(**kwargs)
        if provider_key == "semantic_scholar":
            return await self.search_semantic_scholar(**kwargs)
        raise ValueError(f"Unknown literature provider: {provider_key}")

    # --- Shared helpers -------------------------------------------------

    @staticmethod
    async def _cache_get(cache_key: str, provider_name: str) -> Any:
        return await provider_cache_service.aget(cache_key, provider_name=provider_name)

    @staticmethod
    async def _cache_set(cache_key: str, data: Any, provider_name: str) -> None:
        await provider_cache_service.aset(
            cache_key,
            data,
            ttl_seconds=SEARCH_CACHE_TTL_SECONDS,
            provider_name=provider_name,
        )

    @staticmethod
    def _result(
        source: str, results: list[dict[str, Any]], total: int | None = None
    ) -> dict[str, Any]:
        return {
            "source": source,
            "status": "ok",
            "error": None,
            "total": total if total is not None else len(results),
            "results": results,
        }

    # --- OpenAlex --------------------------------------------------------

    @staticmethod
    def _reconstruct_abstract(
        inverted_index: dict[str, list[int]] | None,
    ) -> str | None:
        if not inverted_index:
            return None
        positions: list[Any] = []
        for word, idxs in inverted_index.items():
            for idx in idxs:
                positions.append((idx, word))
        positions.sort(key=lambda pair: pair[0])
        abstract = " ".join(word for _, word in positions).strip()
        return abstract or None

    async def search_openalex(
        self,
        query: str,
        limit: int = 10,
        offset: int = 0,
        year_start: int | None = None,
        year_end: int | None = None,
        open_access_only: bool = False,
    ) -> dict[str, Any]:
        page = (offset // max(limit, 1)) + 1
        cache_key = (
            f"litsearch:openalex:{query}:{limit}:{page}:"
            f"{year_start or ''}:{year_end or ''}:{int(bool(open_access_only))}"
        )

        filters = []
        if year_start:
            filters.append(f"from_publication_date:{year_start}-01-01")
        if year_end:
            filters.append(f"to_publication_date:{year_end}-12-31")
        if open_access_only:
            filters.append("is_oa:true")

        params: dict[str, Any] = {
            "search": query,
            "per-page": limit,
            "page": page,
            "mailto": "dev@openresearch.org",
        }
        if filters:
            params["filter"] = ",".join(filters)

        cached = await self._cache_get(cache_key, "OpenAlex")
        if cached is not None:
            return cached

        client = get_async_http_client()
        resp = await client.get(
            "https://api.openalex.org/works",
            params=params,
            timeout=SEARCH_TIMEOUT_SECONDS,
        )
        if resp.status_code != 200:
            raise ValueError(f"OpenAlex returned HTTP {resp.status_code}")
        payload = resp.json()

        results: list[dict[str, Any]] = []
        for work in payload.get("results", []):
            authors = [
                split_full_name(a.get("author", {}).get("display_name") or "Unknown Author")
                for a in work.get("authorships", [])
            ]
            doi = _clean_doi(work.get("doi"))
            oa_info = work.get("open_access") or {}
            best_oa = work.get("best_oa_location") or {}
            landing = (work.get("ids") or {}).get("landing_page_url")
            venue = ((work.get("primary_location") or {}).get("source") or {}).get("display_name")
            results.append(
                {
                    "title": (work.get("display_name") or work.get("title") or "Untitled").strip(),
                    "authors": authors,
                    "year": work.get("publication_year"),
                    "abstract": self._reconstruct_abstract(work.get("abstract_inverted_index")),
                    "doi": doi,
                    "arxiv_id": None,
                    "pmid": None,
                    "venue": venue,
                    "url": f"https://doi.org/{doi}" if doi else landing or "https://openalex.org",
                    "pdf_url": best_oa.get("pdf_url") or oa_info.get("oa_url"),
                    "open_access": bool(oa_info.get("is_oa")),
                    "citation_count": work.get("cited_by_count"),
                    "source": "OpenAlex",
                }
            )

        result = self._result("OpenAlex", results, total=payload.get("meta", {}).get("count"))
        await self._cache_set(cache_key, result, "OpenAlex")
        return result

    # --- Crossref ---------------------------------------------------------

    async def search_crossref(
        self,
        query: str,
        limit: int = 10,
        offset: int = 0,
        year_start: int | None = None,
        year_end: int | None = None,
        open_access_only: bool = False,
    ) -> dict[str, Any]:
        cache_key = (
            f"litsearch:crossref:{query}:{limit}:{offset}:"
            f"{year_start or ''}:{year_end or ''}:{int(bool(open_access_only))}"
        )

        filter_parts = []
        if year_start:
            filter_parts.append(f"from-pub-date:{year_start}-01-01")
        if year_end:
            filter_parts.append(f"until-pub-date:{year_end}-12-31")
        if open_access_only:
            filter_parts.append("license:*creativecommons*")

        params: dict[str, Any] = {
            "query": query,
            "rows": limit,
            "offset": offset,
            "mailto": "dev@openresearch.org",
        }
        if filter_parts:
            params["filter"] = ",".join(filter_parts)

        cached = await self._cache_get(cache_key, "Crossref")
        if cached is not None:
            return cached

        client = get_async_http_client()
        resp = await client.get(
            "https://api.crossref.org/works",
            params=params,
            timeout=SEARCH_TIMEOUT_SECONDS,
        )
        if resp.status_code != 200:
            raise ValueError(f"Crossref returned HTTP {resp.status_code}")
        payload = resp.json()

        message = payload.get("message", {})
        results: list[dict[str, Any]] = []
        for item in message.get("items", []):
            authors = []
            for a in item.get("author", []):
                given = a.get("given") or ""
                family = a.get("family") or ""
                literal = (
                    f"{given} {family}".strip()
                    if given
                    else (family or a.get("name") or "Unknown Author")
                )
                authors.append(
                    {
                        "familyName": family or literal.split()[-1],
                        "givenName": given,
                        "literal": literal,
                    }
                )

            year = None
            issued = item.get("issued", {}).get("date-parts", [])
            if issued and issued[0]:
                year = issued[0][0]

            venue = None
            if item.get("container-title"):
                venue = item["container-title"][0]

            pdf_url = None
            for link in item.get("link", []):
                if link.get("content-type") == "application/pdf" and link.get("URL"):
                    pdf_url = link["URL"]
                    break

            license_urls = [lic.get("URL", "") for lic in item.get("license", [])]
            is_oa = any("creativecommons.org" in url for url in license_urls)

            doi = _clean_doi(item.get("DOI"))
            results.append(
                {
                    "title": (item.get("title")[0] if item.get("title") else "Untitled").strip(),
                    "authors": authors,
                    "year": year,
                    "abstract": _strip_tags(item.get("abstract")),
                    "doi": doi,
                    "arxiv_id": None,
                    "pmid": None,
                    "venue": venue,
                    "url": f"https://doi.org/{doi}" if doi else None,
                    "pdf_url": pdf_url,
                    "open_access": is_oa,
                    "citation_count": item.get("is-referenced-by-count"),
                    "source": "Crossref",
                }
            )

        result = self._result("Crossref", results, total=message.get("total-results"))
        await self._cache_set(cache_key, result, "Crossref")
        return result

    # --- arXiv --------------------------------------------------------------

    async def search_arxiv(
        self,
        query: str,
        limit: int = 10,
        offset: int = 0,
        year_start: int | None = None,
        year_end: int | None = None,
        open_access_only: bool = False,
    ) -> dict[str, Any]:
        cache_key = (
            f"litsearch:arxiv:{query}:{limit}:{offset}:"
            f"{year_start or ''}:{year_end or ''}:{int(bool(open_access_only))}"
        )

        search_query = f"all:{query.strip()}"
        if year_start and year_end:
            search_query += f" AND submittedDate:[{year_start}01010000 TO {year_end}12312359]"
        elif year_start:
            search_query += f" AND submittedDate:[{year_start}01010000 TO 209912312359]"
        elif year_end:
            search_query += f" AND submittedDate:[199001010000 TO {year_end}12312359]"

        params: dict[str, Any] = {
            "search_query": search_query,
            "start": offset,
            "max_results": limit,
            "sortBy": "relevance",
        }

        cached = await self._cache_get(cache_key, "arXiv")
        if cached is not None:
            return cached

        client = get_async_http_client()
        resp = await client.get(
            "https://export.arxiv.org/api/query",
            params=params,
            timeout=SEARCH_TIMEOUT_SECONDS,
        )
        if resp.status_code != 200:
            raise ValueError(f"arXiv returned HTTP {resp.status_code}")
        content = resp.text

        results: list[dict[str, Any]] = []
        entries = content.split("<entry>")[1:]
        for entry in entries:
            title_m = re.search(r"<title>([\s\S]*?)</title>", entry)
            title = title_m.group(1).strip().replace("\n", " ") if title_m else "Untitled"

            id_m = re.search(r"<id>https?://arxiv\.org/abs/([^<]+)</id>", entry)
            arxiv_id = id_m.group(1).strip() if id_m else None
            clean_id = re.sub(r"v\d+$", "", arxiv_id) if arxiv_id else None

            authors = []
            for author_block in re.findall(r"<author>([\s\S]*?)</author>", entry):
                name_m = re.search(r"<name>(.*?)</name>", author_block)
                if name_m and name_m.group(1).strip():
                    authors.append(split_full_name(name_m.group(1)))

            published_m = re.search(r"<published>(\d{4})", entry)
            year = int(published_m.group(1)) if published_m else None

            summary_m = re.search(r"<summary>([\s\S]*?)</summary>", entry)
            abstract = summary_m.group(1).strip().replace("\n", " ") if summary_m else None

            doi_m = re.search(r"<arxiv:doi[^>]*>(.*?)</arxiv:doi>", entry)
            doi = doi_m.group(1).strip() if doi_m else None

            pdf_url = f"https://arxiv.org/pdf/{clean_id}" if clean_id else None

            results.append(
                {
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "abstract": abstract,
                    "doi": doi,
                    "arxiv_id": clean_id,
                    "pmid": None,
                    "venue": "arXiv preprint",
                    "url": f"https://arxiv.org/abs/{clean_id}" if clean_id else None,
                    "pdf_url": pdf_url,
                    "open_access": True,
                    "citation_count": None,
                    "source": "arXiv",
                }
            )

        # arXiv cannot express "OA only" (everything on arXiv is OA); nothing to filter.
        result = self._result("arXiv", results)
        await self._cache_set(cache_key, result, "arXiv")
        return result

    # --- Semantic Scholar -----------------------------------------------------

    async def search_semantic_scholar(
        self,
        query: str,
        limit: int = 10,
        offset: int = 0,
        year_start: int | None = None,
        year_end: int | None = None,
        open_access_only: bool = False,
    ) -> dict[str, Any]:
        cache_key = (
            f"litsearch:s2:{query}:{limit}:{offset}:"
            f"{year_start or ''}:{year_end or ''}:{int(bool(open_access_only))}"
        )

        fields = "title,abstract,authors.name,year,externalIds,url,isOpenAccess,openAccessPdf,venue,citationCount"
        params: dict[str, Any] = {
            "query": query,
            "limit": min(max(limit, 1), 100),
            "offset": offset,
            "fields": fields,
        }
        if year_start and year_end:
            params["year"] = f"{year_start}-{year_end}"
        elif year_start:
            params["year"] = f"{year_start}-"
        elif year_end:
            params["year"] = f"-{year_end}"

        cached = await self._cache_get(cache_key, "Semantic Scholar")
        if cached is not None:
            return cached

        await _throttle_s2()

        from app.core.config import settings as _settings

        headers: dict[str, str] = {}
        if getattr(_settings, "SEMANTIC_SCHOLAR_API_KEY", None):
            headers["x-api-key"] = _settings.SEMANTIC_SCHOLAR_API_KEY

        client = get_async_http_client()
        # retry once on 429 respecting Retry-After
        for attempt in range(2):
            resp = await client.get(
                "https://api.semanticscholar.org/graph/v1/paper/search",
                params=params,
                headers=headers or None,
                timeout=SEARCH_TIMEOUT_SECONDS,
            )
            if resp.status_code != 429:
                break
            retry_after = None
            try:
                hdrs = getattr(resp, "headers", None)
                if hdrs is not None:
                    try:
                        val = hdrs.get("Retry-After")
                    except Exception:
                        val = None
                    if isinstance(val, (str, int)):
                        retry_after = val
            except Exception:
                retry_after = None
            try:
                retry_secs = int(retry_after) if retry_after else 2
            except (ValueError, TypeError):
                retry_secs = 2
            if attempt == 0:
                await asyncio.sleep(retry_secs)
                continue
            raise ValueError(f"Semantic Scholar rate limit reached — retry after {retry_secs}s")
        if resp.status_code == 429:
            raise ValueError("Semantic Scholar rate limit reached — try again shortly")
        if resp.status_code != 200:
            raise ValueError(f"Semantic Scholar returned HTTP {resp.status_code}")
        payload = resp.json()

        results: list[dict[str, Any]] = []
        for paper in payload.get("data", []):
            external_ids = paper.get("externalIds") or {}
            oa_pdf = paper.get("openAccessPdf") or {}
            results.append(
                {
                    "title": (paper.get("title") or "Untitled").strip(),
                    "authors": [
                        split_full_name(a.get("name") or "Unknown Author")
                        for a in paper.get("authors", [])
                    ],
                    "year": paper.get("year"),
                    "abstract": paper.get("abstract"),
                    "doi": external_ids.get("DOI"),
                    "arxiv_id": external_ids.get("ArXiv"),
                    "pmid": external_ids.get("PubMed"),
                    "venue": paper.get("venue") or None,
                    "url": paper.get("url"),
                    "pdf_url": oa_pdf.get("url"),
                    "open_access": bool(paper.get("isOpenAccess")),
                    "citation_count": paper.get("citationCount"),
                    "source": "Semantic Scholar",
                }
            )

        if open_access_only:
            results = [r for r in results if r["open_access"]]

        result = self._result("Semantic Scholar", results, total=payload.get("total"))
        await self._cache_set(cache_key, result, "Semantic Scholar")
        return result


literature_search_service = LiteratureSearchService()
