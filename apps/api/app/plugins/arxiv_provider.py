"""arXiv Academic Literature Connector - enriches paper payloads with arXiv identifiers."""

import re

_ARXIV_NEW_STYLE = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")
_ARXIV_ABS_URL = re.compile(r"arxiv\.org/(?:abs|pdf)/([^\s?#]+)", re.IGNORECASE)
_ARXIV_CATEGORY = re.compile(
    r"\b(?:cs|eess|math|phys|stat|q-bio|q-fin|econ)(?:\.[a-z]{2})?\b", re.IGNORECASE
)


def on_paper_extract(payload: dict, config: dict | None) -> dict:
    cfg = config or {}
    result = dict(payload)

    url_value = result.get("url") or result.get("pdf_url")
    candidate = (
        result.get("arxiv_id")
        or result.get("external_id")
        or (_from_url(url_value) if isinstance(url_value, str) else "")
        or ""
    )
    match = _ARXIV_NEW_STYLE.search(str(candidate))
    if not match:
        raw_doi = str(result.get("doi") or "")
        if raw_doi.startswith("10.48550/arXiv."):
            match = _ARXIV_NEW_STYLE.search(raw_doi)

    result.setdefault("source", "arxiv")
    if match:
        result["arxiv_id"] = match.group(0)
        result["source_id"] = f"arXiv:{match.group(0)}"

    if cfg.get("auto_extract_categories", True):
        haystack = " ".join(
            str(result.get(k) or "")
            for k in ("title", "abstract", "categories", "primary_category")
        ).lower()
        found = sorted({c.lower() for c in _ARXIV_CATEGORY.findall(haystack)})
        if found:
            result["arxiv_categories"] = found[: int(cfg.get("max_results", 20))]

    return result


def _from_url(url: str) -> str:
    if not url:
        return ""
    m = _ARXIV_ABS_URL.search(url)
    return m.group(1) if m else ""
