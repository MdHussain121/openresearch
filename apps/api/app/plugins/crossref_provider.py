"""CrossRef & DOI Metadata Resolver - normalizes DOIs into canonical lowercase form."""

_DOI_PREFIXES = (
    "https://dx.doi.org/",
    "http://dx.doi.org/",
    "https://doi.org/",
    "http://doi.org/",
    "doi:",
    "DOI:",
)


def on_paper_extract(payload: dict, config: dict | None) -> dict:
    cfg = config or {}
    result = dict(payload)

    raw = str(result.get("doi") or "").strip()
    if not raw:
        return result

    for prefix in _DOI_PREFIXES:
        if raw.lower().startswith(prefix.lower()):
            raw = raw[len(prefix) :]
            break

    normalized = raw.strip().lower()
    result["doi"] = normalized
    result["doi_url"] = (
        f"{'https' if cfg.get('prefer_https', True) else 'http'}://doi.org/{normalized}"
    )
    result["metadata_source"] = "crossref"
    return result
