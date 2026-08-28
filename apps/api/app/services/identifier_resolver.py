import logging
import re
from typing import Any

import httpx

from app.core.authors import split_full_name
from app.core.config import settings
from app.core.http_client import get_async_http_client
from app.services.provider_cache_service import provider_cache_service

logger = logging.getLogger("openresearch.identifier_resolver")


class IdentifierResolver:
    """
    Resolves academic identifiers (DOI, arXiv ID, PMID) to normalized bibliographic metadata.
    """

    @staticmethod
    def detect_identifier_type(raw: str) -> str:
        s = raw.strip().lower()
        # Explicit prefixes / provider URLs are authoritative.
        if s.startswith("doi:") or "doi.org/" in s:
            return "doi"
        if s.startswith("pmid:") or "pubmed.ncbi.nlm.nih.gov/" in s:
            return "pmid"
        # Bare arXiv IDs (YYMM.NNNNN[vN]) must be matched before any loose
        # "10." heuristic, otherwise October IDs like 1810.04805 look like DOIs.
        if re.match(r"^\d{4}\.\d{4,5}(v\d+)?$", s):
            return "arxiv"
        if "arxiv" in s and not re.match(r"^10\.\d{4,9}/", s):
            return "arxiv"
        if re.match(r"^\d{7,9}$", s):
            return "pmid"
        return "doi"

    @staticmethod
    def clean_doi(raw: str) -> str:
        s = raw.strip()
        s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^doi:\s*", "", s, flags=re.IGNORECASE)
        return s.strip()

    @staticmethod
    def clean_arxiv(raw: str) -> str:
        s = raw.strip()
        s = re.sub(r"^https?://arxiv\.org/(abs|pdf)/", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^arxiv:\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\.pdf$", "", s, flags=re.IGNORECASE)
        return s.strip()

    @staticmethod
    def clean_pmid(raw: str) -> str:
        s = raw.strip()
        s = re.sub(r"^pmid:\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^https?://pubmed\.ncbi\.nlm\.nih\.gov/", "", s, flags=re.IGNORECASE)
        return s.strip().replace("/", "")

    async def resolve(self, identifier: str, id_type: str = "auto") -> dict[str, Any]:
        raw = identifier.strip()
        if id_type == "auto" or not id_type:
            detected_type = self.detect_identifier_type(raw)
        else:
            detected_type = id_type.lower()

        if detected_type == "doi":
            return await self.resolve_doi(self.clean_doi(raw))
        if detected_type == "arxiv":
            return await self.resolve_arxiv(self.clean_arxiv(raw))
        if detected_type == "pmid":
            return await self.resolve_pmid(self.clean_pmid(raw))
        return await self.resolve_doi(self.clean_doi(raw))

    async def resolve_doi(self, doi: str) -> dict[str, Any]:
        """Resolve metadata via Crossref API."""
        cache_key = f"doi:{doi}"
        cached = await provider_cache_service.aget(cache_key, provider_name="Crossref")
        if cached is not None:
            return cached

        headers = {"User-Agent": "OpenResearch/1.0 (mailto:dev@openresearch.org)"}
        try:
            client = get_async_http_client()
            url = f"https://api.crossref.org/works/{doi}"
            resp = await client.get(url, headers=headers, timeout=settings.IDENTIFIER_RESOLVER_TIMEOUT_SECONDS)
            if resp.status_code == 200:
                data = resp.json().get("message", {})
                title = "Untitled"
                if data.get("title") and len(data["title"]) > 0:
                    title = data["title"][0]

                authors: list[dict[str, Any]] = []
                for a in data.get("author", []):
                    authors.append(
                        {
                            "familyName": a.get("family") or "Unknown",
                            "givenName": a.get("given") or "",
                            "literal": f"{a.get('given') or ''} {a.get('family') or ''}".strip()
                            or a.get("name")
                            or "Unknown",
                        }
                    )

                if not authors:
                    authors = [{"familyName": "Unknown Author", "literal": "Unknown Author"}]

                year = None
                issued = data.get("issued", {}).get("date-parts", [])
                if issued and len(issued[0]) > 0:
                    year = issued[0][0]

                venue = None
                if data.get("container-title") and len(data["container-title"]) > 0:
                    venue = data["container-title"][0]

                abstract = data.get("abstract", "")
                if abstract:
                    abstract = re.sub(r"<[^>]+>", "", abstract).strip()

                result = {
                    "identifier": doi,
                    "id_type": "doi",
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "abstract": abstract or None,
                    "doi": doi,
                    "arxiv_id": None,
                    "pmid": None,
                    "journal": venue,
                    "publisher": data.get("publisher"),
                    "volume": data.get("volume"),
                    "issue": data.get("issue"),
                    "pages": data.get("page"),
                    "url": f"https://doi.org/{doi}",
                    "bibtex": None,
                    "extraction_status": "ok",
                }
                await provider_cache_service.aset(cache_key, result, provider_name="Crossref")
                return result
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Crossref resolution failed for DOI %s: %s", doi, exc)

        # DataCite arXiv DOI fallback: 10.48550/arXiv.YYMM.NNNNN[vN] -> extract and query arXiv
        m = re.search(r"10\.48550/arXiv\.(\d{4}\.\d{4,5})(v\d+)?", doi, flags=re.IGNORECASE)
        if m:
            arxiv_id = m.group(1)  # e.g., "2501.09136"
            logger.info("Crossref miss for DataCite DOI %s, falling back to arXiv %s", doi, arxiv_id)
            arxiv_meta = await self.resolve_arxiv(arxiv_id)
            if arxiv_meta.get("extraction_status") == "ok":
                arxiv_meta["doi"] = doi  # preserve original DOI
                arxiv_meta["id_type"] = "doi"  # preserve requested type
                return arxiv_meta

        return self._unresolved(
            identifier=doi,
            id_type="doi",
            url=f"https://doi.org/{doi}",
            doi=doi,
        )

    @staticmethod
    def _unresolved(identifier: str, id_type: str, url: str | None, **ids: Any) -> dict[str, Any]:
        """Build an explicit unresolved result when the upstream provider cannot be reached."""
        return {
            "identifier": identifier,
            "id_type": id_type,
            "title": None,
            "authors": [],
            "year": None,
            "abstract": None,
            "journal": None,
            "publisher": None,
            "volume": None,
            "issue": None,
            "pages": None,
            "url": url,
            "bibtex": None,
            "extraction_status": "unresolved",
            **ids,
        }

    async def resolve_arxiv(self, arxiv_id: str) -> dict[str, Any]:
        """Resolve metadata via arXiv API / export."""
        clean_id = re.sub(r"v\d+$", "", arxiv_id)
        cache_key = f"arxiv:{clean_id}"
        cached = await provider_cache_service.aget(cache_key, provider_name="arXiv")
        if cached is not None:
            return cached
        try:
            client = get_async_http_client()
            url = f"https://export.arxiv.org/api/query?id_list={clean_id}"
            resp = await client.get(url, timeout=settings.IDENTIFIER_RESOLVER_TIMEOUT_SECONDS)
            if resp.status_code == 200 and "<entry>" in resp.text:
                content = resp.text
                title_m = re.search(r"<title>([\s\S]*?)</title>", content)
                # skip main feed title if matched
                entries = content.split("<entry>")
                if len(entries) > 1:
                    entry = entries[1]
                    title_m = re.search(r"<title>([\s\S]*?)</title>", entry)
                    title = (
                        title_m.group(1).strip().replace("\n", " ")
                        if title_m
                        else f"arXiv:{arxiv_id}"
                    )

                    authors: list[dict[str, Any]] = []
                    for author_block in re.findall(r"<author>([\s\S]*?)</author>", entry):
                        name_m = re.search(r"<name>(.*?)</name>", author_block)
                        if name_m:
                            authors.append(split_full_name(name_m.group(1).strip()))

                    if not authors:
                        authors = [{"familyName": "arXiv Author", "literal": "arXiv Author"}]

                    published_m = re.search(r"<published>(\d{4})", entry)
                    year = int(published_m.group(1)) if published_m else None

                    summary_m = re.search(r"<summary>([\s\S]*?)</summary>", entry)
                    abstract = summary_m.group(1).strip().replace("\n", " ") if summary_m else None

                    doi_m = re.search(r"<arxiv:doi[^>]*>(.*?)</arxiv:doi>", entry)
                    doi = doi_m.group(1).strip() if doi_m else None

                    result = {
                        "identifier": arxiv_id,
                        "id_type": "arxiv",
                        "title": title,
                        "authors": authors,
                        "year": year,
                        "abstract": abstract,
                        "doi": doi,
                        "arxiv_id": clean_id,
                        "pmid": None,
                        "journal": "arXiv preprint",
                        "publisher": "arXiv",
                        "volume": None,
                        "issue": None,
                        "pages": None,
                        "url": f"https://arxiv.org/abs/{clean_id}",
                        "bibtex": None,
                        "extraction_status": "ok",
                    }
                    await provider_cache_service.aset(cache_key, result, provider_name="arXiv")
                    return result
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("arXiv resolution failed for %s: %s", arxiv_id, exc)

        return self._unresolved(
            identifier=arxiv_id,
            id_type="arxiv",
            url=f"https://arxiv.org/abs/{clean_id}",
            arxiv_id=clean_id,
        )

    async def resolve_pmid(self, pmid: str) -> dict[str, Any]:
        """Resolve metadata via NCBI E-utilities."""
        cache_key = f"pmid:{pmid}"
        cached = await provider_cache_service.aget(cache_key, provider_name="PubMed")
        if cached is not None:
            return cached
        try:
            client = get_async_http_client()
            url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={pmid}&retmode=json"
            resp = await client.get(url, timeout=settings.IDENTIFIER_RESOLVER_TIMEOUT_SECONDS)
            if resp.status_code == 200:
                data = resp.json().get("result", {}).get(pmid, {})
                title = data.get("title", f"PubMed Article ({pmid})").rstrip(".")
                authors: list[dict[str, Any]] = []
                for a in data.get("authors", []):
                    name = a.get("name", "Unknown")
                    authors.append(split_full_name(name, family_first=True))

                if not authors:
                    authors = [{"familyName": "PubMed Author", "literal": "PubMed Author"}]

                pubdate = data.get("pubdate", "")
                year_m = re.search(r"\b(19\d\d|20\d\d)\b", pubdate)
                year = int(year_m.group(1)) if year_m else None

                venue = data.get("fulljournalname") or data.get("source")
                doi = None
                for article_id in data.get("articleids", []):
                    if article_id.get("idtype") == "doi":
                        doi = article_id.get("value")

                result = {
                    "identifier": pmid,
                    "id_type": "pmid",
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "abstract": None,
                    "doi": doi,
                    "arxiv_id": None,
                    "pmid": pmid,
                    "journal": venue,
                    "publisher": "National Library of Medicine",
                    "volume": data.get("volume"),
                    "issue": data.get("issue"),
                    "pages": data.get("pages"),
                    "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                    "bibtex": None,
                    "extraction_status": "ok",
                }
                await provider_cache_service.aset(cache_key, result, provider_name="PubMed")
                return result
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("PubMed resolution failed for PMID %s: %s", pmid, exc)

        return self._unresolved(
            identifier=pmid,
            id_type="pmid",
            url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            pmid=pmid,
        )


identifier_resolver = IdentifierResolver()
