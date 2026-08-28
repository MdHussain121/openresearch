import json
import logging
import re
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.http_client import get_sync_http_client
from app.models.paper import Paper
from app.schemas.models import (
    PaperResponse,
    ZoteroImportRequest,
    ZoteroImportResponse,
    ZoteroSyncRequest,
    ZoteroSyncResponse,
)

logger = logging.getLogger("openresearch.zotero")


class ZoteroAPIError(Exception):
    """Raised when the Zotero Web API cannot be reached or returns an error."""


class ZoteroService:
    """
    Zotero Integration & Library Sync Service (Phase 8.5).
    Supports:
    - Direct Zotero API sync (api.zotero.org) via User ID + API key
    - Zotero CSL-JSON and BetterBibTeX JSON file import
    """

    def import_csl_or_api_data(
        self,
        db: Session,
        project_id: str,
        request: ZoteroImportRequest,
        version_out: dict[str, Any] | None = None,
    ) -> ZoteroImportResponse:
        items: list[dict[str, Any]] = []

        # 1. If raw CSL-JSON provided
        if request.csl_json_content:
            try:
                parsed = json.loads(request.csl_json_content)
                items = parsed if isinstance(parsed, list) else [parsed]
            except Exception as e:
                logger.error("Failed to parse Zotero JSON content: %s", e)
                return ZoteroImportResponse(
                    total_imported=0,
                    papers=[],
                    skipped_count=0,
                    message=f"Invalid JSON format: {e!s}",
                )

        # 2. If API Key + User ID provided, fetch from Zotero Web API
        elif request.user_id and request.api_key:
            try:
                items, fetched_version = self._fetch_from_zotero_api(
                    user_id=request.user_id,
                    api_key=request.api_key,
                    collection_id=request.collection_id,
                )
                if version_out is not None:
                    version_out["last_modified_version"] = fetched_version
            except ZoteroAPIError as exc:
                logger.warning("Zotero import aborted for project %s: %s", project_id, exc)
                return ZoteroImportResponse(
                    total_imported=0,
                    papers=[],
                    skipped_count=0,
                    message=f"Zotero API unavailable, nothing was imported: {exc}",
                )

        if not items:
            return ZoteroImportResponse(
                total_imported=0,
                papers=[],
                skipped_count=0,
                message="No references found in Zotero payload.",
            )

        imported_papers: list[Paper] = []
        skipped_count = 0

        for item in items:
            try:
                data = item.get("data", item)  # Support Zotero API wrapper or raw CSL-JSON
                title = data.get("title") or data.get("name") or "Untitled Document"

                # Extract authors — guard against non-dict creator entries
                authors: list[dict[str, Any]] = []
                creators = data.get("creators") or data.get("author") or []
                for c in creators:
                    if not isinstance(c, dict):
                        continue
                    if "lastName" in c or "familyName" in c:
                        authors.append(
                            {
                                "familyName": c.get("lastName") or c.get("familyName", "Unknown"),
                                "givenName": c.get("firstName") or c.get("givenName", ""),
                            }
                        )
                    elif "name" in c or "literal" in c:
                        authors.append(
                            {
                                "familyName": c.get("name") or c.get("literal", "Unknown"),
                                "literal": c.get("name") or c.get("literal", "Unknown"),
                            }
                        )

                if not authors:
                    authors.append({"familyName": "Unknown"})

                # Extract publication year — defensive against malformed 'issued'
                year = None
                date_str = data.get("date") or ""
                if not date_str:
                    issued = data.get("issued")
                    if isinstance(issued, dict):
                        parts = issued.get("date-parts")
                        if (
                            isinstance(parts, list)
                            and parts
                            and isinstance(parts[0], list)
                            and parts[0]
                        ):
                            date_str = parts[0][0] or ""
                date_str = str(date_str)
                match = re.search(r"\b(19|20)\d{2}\b", date_str)
                if match:
                    year = int(match.group(0))

                doi = data.get("DOI") or data.get("doi")
                arxiv_id = data.get("arxivId") or data.get("archive_id")
                abstract = data.get("abstractNote") or data.get("abstract")

                # Check if paper with this DOI or title already exists in project
                existing = None
                if doi:
                    existing = (
                        db.query(Paper)
                        .filter(Paper.project_id == project_id, Paper.doi == doi)
                        .first()
                    )
                if not existing and title != "Untitled Document":
                    existing = (
                        db.query(Paper)
                        .filter(Paper.project_id == project_id, Paper.title == title)
                        .first()
                    )

                if existing:
                    skipped_count += 1
                    imported_papers.append(existing)
                    continue

                new_paper = Paper(
                    id=str(uuid.uuid4()),
                    project_id=project_id,
                    title=title,
                    authors=authors,
                    year=year,
                    doi=doi,
                    arxiv_id=arxiv_id,
                    abstract=abstract,
                    metadata_json={
                        "journal": data.get("publicationTitle") or data.get("container-title"),
                        "volume": data.get("volume"),
                        "issue": data.get("issue"),
                        "pages": data.get("pages") or data.get("page"),
                        "publisher": data.get("publisher"),
                        "url": data.get("url") or data.get("URL"),
                        "zotero_key": data.get("key"),
                        "source": "zotero_sync",
                    },
                    extraction_status="ok",
                )
                db.add(new_paper)
                imported_papers.append(new_paper)
            except Exception as exc:
                logger.warning("Skipping Zotero item due to parse error: %s", exc)
                skipped_count += 1

        db.commit()

        return ZoteroImportResponse(
            total_imported=len(imported_papers) - skipped_count,
            papers=[PaperResponse.model_validate(p) for p in imported_papers],
            skipped_count=skipped_count,
            message=f"Successfully imported {len(imported_papers) - skipped_count} reference(s) from Zotero.",
        )

    ZOTERO_PAGE_SIZE = 100
    ZOTERO_MAX_ITEMS = 500

    def _fetch_from_zotero_api(
        self, user_id: str, api_key: str, collection_id: str | None = None
    ) -> tuple[list[dict[str, Any]], int | None]:
        """
        Fetch items from api.zotero.org with pagination (up to ZOTERO_MAX_ITEMS).
        Returns (items, last_modified_library_version) where the version comes from
        the Last-Modified-Version response header when present.
        """
        base = f"https://api.zotero.org/users/{user_id}"
        if collection_id:
            base += f"/collections/{collection_id}"
        base += "/items/top"

        headers = {"Zotero-API-Key": api_key, "User-Agent": "OpenResearch/1.0"}

        try:
            client = get_sync_http_client()
            all_items: list[dict[str, Any]] = []
            last_version: int | None = None
            start = 0
            while start < self.ZOTERO_MAX_ITEMS:
                res = client.get(
                    base,
                    headers=headers,
                    params={"format": "json", "limit": self.ZOTERO_PAGE_SIZE, "start": start},
                    timeout=settings.ZOTERO_TIMEOUT_SECONDS,
                )
                if res.status_code != 200:
                    logger.warning(
                        "Zotero API responded with status %s: %s", res.status_code, res.text[:200]
                    )
                    raise ZoteroAPIError(f"HTTP {res.status_code}")

                header_version = res.headers.get("Last-Modified-Version")
                if header_version and header_version.isdigit():
                    last_version = int(header_version)

                page = res.json() or []
                all_items.extend(page)
                if len(page) < self.ZOTERO_PAGE_SIZE:
                    break
                start += self.ZOTERO_PAGE_SIZE

            return all_items, last_version
        except ZoteroAPIError:
            raise
        except Exception as exc:
            logger.warning("Zotero API network error: %s", exc)
            raise ZoteroAPIError(str(exc)) from exc

    def sync_library(
        self, db: Session, project_id: str, request: ZoteroSyncRequest
    ) -> ZoteroSyncResponse:
        version_box: dict[str, Any] = {}
        import_res = self.import_csl_or_api_data(
            db=db,
            project_id=project_id,
            request=ZoteroImportRequest(
                api_key=request.api_key,
                user_id=request.user_id,
                collection_id=request.collection_id,
            ),
            version_out=version_box,
        )
        return ZoteroSyncResponse(
            synced_items_count=import_res.total_imported,
            new_papers=import_res.papers,
            last_synced_version=version_box.get("last_modified_version"),
        )


zotero_service = ZoteroService()
