import logging
import os

import anyio

from app.core.config import settings
from app.core.http_client import get_async_http_client

logger = logging.getLogger("openresearch.pdf.grobid_client")


class GrobidClient:
    def __init__(self, grobid_url: str | None = None):
        self.grobid_url = grobid_url or settings.GROBID_URL

    async def extract(self, file_path: str) -> str | None:
        """Call GROBID REST API and return raw TEI XML text."""
        if not self.grobid_url:
            return None

        client = get_async_http_client()
        file_bytes = await anyio.to_thread.run_sync(lambda: open(file_path, "rb").read())
        files = {"input": (os.path.basename(file_path), file_bytes, "application/pdf")}
        data = {
            "generateIDs": "1",
            "consolidateHeader": "1",
            "consolidateCitations": "1",
            "includeRawCitations": "1",
        }
        try:
            resp = await client.post(
                f"{self.grobid_url.rstrip('/')}/api/processFulltextDocument",
                files=files,
                data=data,
                timeout=settings.GROBID_TIMEOUT_SECONDS,
            )
        except Exception as e:
            logger.info("GROBID request failed: %s", e)
            return None

        if resp.status_code != 200:
            logger.warning("GROBID returned status %s: %s", resp.status_code, resp.text[:200])
            return None

        return resp.text

    async def health_check(self) -> bool:
        """Check if GROBID service is reachable."""
        if not self.grobid_url:
            return False
        client = get_async_http_client()
        try:
            resp = await client.get(
                f"{self.grobid_url.rstrip('/')}/api/isalive",
                timeout=5.0,
            )
            return resp.status_code == 200
        except Exception:
            return False
