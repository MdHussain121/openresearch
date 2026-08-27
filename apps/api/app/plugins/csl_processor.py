"""Citation Style Language (CSL) Engine - formats citation payloads into styled strings."""

_STYLES = {"apa", "ieee", "harvard", "vancouver", "mla", "chicago"}


def on_citation_format(payload: dict, config: dict | None) -> dict:
    cfg = config or {}
    style = str(payload.get("style") or cfg.get("style", "apa")).lower()
    if style not in _STYLES:
        style = "apa"

    result = dict(payload)
    authors = payload.get("authors") or []
    if isinstance(authors, str):
        authors = [authors]

    formatter = {
        "apa": _apa,
        "ieee": _ieee,
        "harvard": _harvard,
        "vancouver": _vancouver,
        "mla": _mla,
        "chicago": _chicago,
    }[style]

    formatted = formatter(authors, payload)
    result["formatted"] = formatted
    result["style_applied"] = style
    result["locale"] = cfg.get("locale", "en-US")
    return result


def _initial(author: str) -> str:
    parts = author.strip().split()
    return f"{parts[-1]}, {' '.join(p[0].upper() + '.' for p in parts[:-1])}".strip(", ")


def _join_authors(authors: list[str]) -> str:
    if not authors:
        return ""
    if len(authors) == 1:
        return authors[0]
    return f"{', '.join(authors[:-1])} & {authors[-1]}"


def _base_fields(payload: dict[str, str]) -> tuple[str, str, str, str, str, str]:
    return (
        str(payload.get("title") or "Untitled"),
        str(payload.get("year") or "n.d."),
        str(payload.get("venue") or ""),
        str(payload.get("volume") or ""),
        str(payload.get("pages") or ""),
        str(payload.get("doi") or ""),
    )


def _apa(authors: list[str], p: dict[str, str]) -> str:
    title, year, venue, volume, pages, doi = _base_fields(p)
    apa_authors = [_initial(a) for a in authors]
    ref = f"{_join_authors(apa_authors)} ({year}). {title}."
    if venue:
        ref += f" {venue}"
        if volume:
            ref += f", {volume}"
        if pages:
            ref += f", {pages}"
        ref += "."
    if doi:
        ref += f" https://doi.org/{doi}"
    return ref


def _ieee(authors: list[str], p: dict[str, str]) -> str:
    title, year, venue, volume, pages, doi = _base_fields(p)
    initials = [
        f"{' '.join(w[0].upper() + '.' for w in a.split()[:-1])} {a.split()[-1]}" for a in authors
    ]
    ref = f'{", ".join(initials)}, "{title},"'
    if venue:
        ref += f" {venue}"
        if volume:
            ref += f", vol. {volume}"
        if pages:
            ref += f", pp. {pages}"
        ref += f", {year}."
    if doi:
        ref += f" doi: {doi}."
    return ref


def _harvard(authors: list[str], p: dict[str, str]) -> str:
    title, year, venue, volume, pages, _ = _base_fields(p)
    harvard_authors = [_initial(a) for a in authors]
    ref = f"{_join_authors(harvard_authors)} ({year}) '{title}', {venue}"
    if volume:
        ref += f", {volume}"
    if pages:
        ref += f", pp. {pages}"
    return ref + "."


def _vancouver(authors: list[str], p: dict[str, str]) -> str:
    title, year, venue, volume, pages, _ = _base_fields(p)
    surnames = [f"{a.split()[-1]} {''.join(w[0].upper() for w in a.split()[:-1])}" for a in authors]
    ref = f"{', '.join(surnames)}. {title}. {venue}"
    if volume:
        ref += f"; {volume}"
    if pages:
        ref += f":{pages}"
    return f"{ref}. {year}."


def _mla(authors: list[str], p: dict[str, str]) -> str:
    title, _, venue, _, pages, _ = _base_fields(p)
    first = authors[0] if authors else ""
    mla_first = f"{first.split()[-1]}, {' '.join(first.split()[:-1])}" if first else ""
    extra = ", et al." if len(authors) > 1 else ""
    ref = f'{mla_first}{extra}. "{title}." {venue}'
    if pages:
        ref += f", pp. {pages}"
    return ref + "."


def _chicago(authors: list[str], p: dict[str, str]) -> str:
    title, year, venue, volume, pages, _ = _base_fields(p)
    chicago_authors = [_initial(a) for a in authors]
    ref = f'{_join_authors(chicago_authors)} "{title}." {venue}'
    if volume:
        ref += f" {volume}"
    if pages:
        ref += f" ({year}): {pages}"
    elif year:
        ref += f" ({year})"
    return ref + "."
