"""
Citation Formatting Helpers for OpenResearch Export Engine.
Supports 26 major styles: APA, MLA, Chicago (Author-Date + Notes), IEEE, Harvard,
Vancouver, Nature, Science, ACM, ACS, Turabian, AMA, NLM, CSE, APSA, ASA, AAA,
MHRA, Oxford, OSCOLA, Bluebook, ABNT, ISO 690, GB/T 7714, and Cell Press.
"""

from app.core.text_utils import (
    format_authors_bibliography,
)
from app.core.text_utils import (
    format_authors_inline as format_authors_inline,
)
from app.core.text_utils import (
    format_inline_marker as core_format_inline_marker,
)
from app.models.paper import Paper


def format_inline_marker(
    paper: Paper, style: str = "apa", index: int = 1, page_num: int | None = None
) -> str:
    """Format inline citation text e.g., (Vaswani et al., 2017) or [1]."""
    return core_format_inline_marker(
        authors=paper.authors or [],
        year=paper.year,
        style=style,
        index=index,
        page_num=page_num,
    )


def format_bibliography_entry(paper: Paper, style: str = "apa", index: int = 1) -> str:
    """Format full reference according to CSL style rules."""
    style = (style or "apa").lower()
    authors = format_authors_bibliography(paper.authors or [], style)
    year = str(paper.year) if paper.year else "n.d."
    title = (paper.title or "Untitled").strip().rstrip(".")
    meta = paper.metadata_json or {}
    journal = meta.get("journal") or meta.get("booktitle") or meta.get("publisher") or ""
    volume = f"vol. {meta.get('volume')}" if meta.get("volume") else ""
    issue = f"no. {meta.get('issue')}" if meta.get("issue") else ""
    pages = f"pp. {meta.get('pages')}" if meta.get("pages") else ""
    doi = f"https://doi.org/{paper.doi.replace('https://doi.org/', '')}" if paper.doi else ""

    if style == "apa":
        vol_issue = "".join(
            filter(
                None,
                [meta.get("volume", ""), f"({meta.get('issue')})" if meta.get("issue") else ""],
            )
        )
        loc = ", ".join(filter(None, [journal, vol_issue, meta.get("pages", "")]))
        doi_part = f" {doi}" if doi else ""
        return f"{authors} ({year}). {title}.{f' {loc}.' if loc else ''}{doi_part}".strip()

    if style == "mla":
        parts = [journal, volume, issue, str(paper.year) if paper.year else "", pages]
        container = ", ".join([part for part in parts if part])
        doi_part = f" {doi}." if doi else ""
        return f'{authors}. "{title}." {container + "." if container else ""}{doi_part}'.strip()

    if style in ("chicago", "apsa", "aaa"):
        vol_issue = "".join(
            filter(
                None,
                [meta.get("volume", ""), f"({meta.get('issue')})" if meta.get("issue") else ""],
            )
        )
        loc = ": ".join(
            filter(None, [journal + (" " + vol_issue if vol_issue else ""), meta.get("pages", "")])
        )
        doi_part = f" {doi}." if doi else ""
        return f'{authors}. {year}. "{title}."{f" {loc}." if loc else ""}{doi_part}'.strip()

    if style == "ieee":
        parts = [journal, volume, issue, pages, str(paper.year) if paper.year else ""]
        body = ", ".join([part for part in parts if part])
        return f'[{index}] {authors}, "{title},"{f" {body}." if body else ""}'.strip()

    if style == "harvard":
        vol_issue = "".join(
            filter(
                None,
                [meta.get("volume", ""), f"({meta.get('issue')})" if meta.get("issue") else ""],
            )
        )
        parts_harvard = ", ".join(filter(None, [journal, vol_issue, pages]))
        return f"{authors} ({year}) '{title}', {parts_harvard}.".strip()

    if style in ("vancouver", "nlm"):
        vol_issue = "".join(
            filter(
                None,
                [meta.get("volume", ""), f"({meta.get('issue')})" if meta.get("issue") else ""],
            )
        )
        date_vol = ";".join(filter(None, [str(paper.year) if paper.year else "", vol_issue]))
        loc = ":".join(filter(None, [date_vol, meta.get("pages", "")]))
        venue_part = ". ".join(filter(None, [journal, loc]))
        return f"({index}) {authors}. {title}.{f' {venue_part}.' if venue_part else ''}".strip()

    if style in ("ama", "cse"):
        vol_issue = "".join(
            filter(
                None,
                [meta.get("volume", ""), f"({meta.get('issue')})" if meta.get("issue") else ""],
            )
        )
        date_vol = ";".join(filter(None, [str(paper.year) if paper.year else "", vol_issue]))
        loc = ":".join(filter(None, [date_vol, meta.get("pages", "")]))
        venue_part = ". ".join(filter(None, [journal, loc]))
        doi_part = f" doi: {doi}." if doi else ""
        return f"[{index}] {authors}. {title}.{f' {venue_part}.' if venue_part else ''}{doi_part}".strip()

    if style in ("nature", "cell"):
        vol_pages = ", ".join(filter(None, [meta.get("volume"), meta.get("pages")]))
        venue_vol = " ".join(filter(None, [journal, vol_pages]))
        date_part = f" ({paper.year})" if paper.year else ""
        doi_part = f" {doi}" if doi else ""
        return f"{index}. {authors}. {title}. {venue_vol}{date_part}.{doi_part}".strip()

    if style == "science":
        vol_pages = ", ".join(filter(None, [meta.get("volume"), meta.get("pages")]))
        loc = " ".join(filter(None, [journal, vol_pages]))
        date_part = f" ({paper.year})" if paper.year else ""
        return f"({index}) {authors}, {title}. {loc}{date_part}.".strip()

    if style == "acm":
        vol_issue = ", ".join(
            filter(
                None,
                [
                    f"vol. {meta['volume']}" if meta.get("volume") else "",
                    f"no. {meta['issue']}" if meta.get("issue") else "",
                ],
            )
        )
        parts_acm = ", ".join(filter(None, [journal, vol_issue, pages]))
        doi_part = f" {doi}." if doi else ""
        return f"[{index}] {authors}. {year}. {title}.{f' {parts_acm}.' if parts_acm else ''}{doi_part}".strip()

    if style == "acs":
        year_vol_pages = ", ".join(
            filter(
                None, [str(paper.year) if paper.year else "", meta.get("volume"), meta.get("pages")]
            )
        )
        loc_acs = " ".join(filter(None, [journal, year_vol_pages]))
        doi_part = f" {doi}." if doi else ""
        return f"({index}) {authors}. {title}. {loc_acs}.{doi_part}".strip()

    if style == "chicago-notes":
        vol_issue = ", ".join(
            filter(
                None, [meta.get("volume", ""), f"no. {meta['issue']}" if meta.get("issue") else ""]
            )
        )
        loc_notes = " ".join(filter(None, [journal, vol_issue]))
        date_pages = ": ".join(
            filter(None, [f"({paper.year})" if paper.year else "", meta.get("pages", "")])
        )
        return (
            f'{index}. {authors}, "{title},"{f" {loc_notes}" if loc_notes else ""}'
            f"{f' {date_pages}.' if date_pages else '.'}"
        ).strip()

    if style == "turabian":
        vol_issue = "".join(
            filter(
                None,
                [meta.get("volume", ""), f"({meta.get('issue')})" if meta.get("issue") else ""],
            )
        )
        loc_turabian = ": ".join(
            filter(None, [journal + (f" {vol_issue}" if vol_issue else ""), meta.get("pages", "")])
        )
        return f'{authors}. {year}. "{title}."{f" {loc_turabian}." if loc_turabian else ""}'.strip()

    if style == "asa":
        asa_loc = " ".join(
            filter(None, [journal, ":".join(filter(None, [meta.get("volume"), meta.get("pages")]))])
        )
        return f'{authors} {year}. "{title}."{f" {asa_loc}." if asa_loc else ""}'.strip()

    if style == "mhra":
        mhra_parts = ", ".join(
            filter(
                None,
                [
                    journal,
                    f"vol {meta['volume']}" if meta.get("volume") else "",
                    f"no. {meta['issue']}" if meta.get("issue") else "",
                ],
            )
        )
        date_pages_mhra = ", ".join(
            filter(None, [f"({paper.year})" if paper.year else "", meta.get("pages", "")])
        )
        return (
            f"{authors}, '{title}',{f' {mhra_parts},' if mhra_parts else ''}"
            f"{f' {date_pages_mhra}.' if date_pages_mhra else '.'}"
        ).strip()

    if style == "oxford":
        oxford_loc = journal or ""
        return f"{index}. {authors}, {title}{f', {oxford_loc}' if oxford_loc else ''} ({year}).".strip()

    if style == "oscola":
        oscola_loc = " ".join(filter(None, [meta.get("volume"), journal, meta.get("pages")]))
        oscola_year = f" ({paper.year})" if paper.year else ""
        return f"{authors}, '{title}'{oscola_year}{f' {oscola_loc}' if oscola_loc else ''}.".strip()

    if style == "bluebook":
        bluebook_loc = " ".join(filter(None, [meta.get("volume"), journal, meta.get("pages")]))
        return f"{authors}, {title},{f' {bluebook_loc},' if bluebook_loc else ''} ({year}).".strip()

    if style == "abnt":
        abnt_parts = ", ".join(
            filter(
                None,
                [
                    journal,
                    f"v. {meta['volume']}" if meta.get("volume") else "",
                    f"n. {meta['issue']}" if meta.get("issue") else "",
                    f"p. {meta['pages']}" if meta.get("pages") else "",
                    str(paper.year) if paper.year else "",
                ],
            )
        )
        doi_part_abnt = f" {doi}." if doi else ""
        return f"{authors} {title}. {abnt_parts}.{doi_part_abnt}".strip()

    if style == "iso690":
        iso_parts = ", ".join(
            filter(
                None,
                [
                    str(paper.year) if paper.year else "",
                    f"vol. {meta['volume']}" if meta.get("volume") else "",
                    f"no. {meta['issue']}" if meta.get("issue") else "",
                    f"pp. {meta['pages']}" if meta.get("pages") else "",
                ],
            )
        )
        doi_part_iso = f" {doi}." if doi else ""
        return (
            f"{authors}. {title}.{f' {journal}.' if journal else ''}"
            f"{f' {iso_parts}.' if iso_parts else ''}{doi_part_iso}"
        ).strip()

    if style == "gbt7714":
        gbt_vol_issue = "".join(
            filter(
                None,
                [meta.get("volume", ""), f"({meta.get('issue')})" if meta.get("issue") else ""],
            )
        )
        gbt_tail = ", ".join(filter(None, [str(paper.year) if paper.year else "", gbt_vol_issue]))
        gbt_venue = ", ".join(filter(None, [journal, gbt_tail]))
        gbt_pages = f": {meta['pages']}" if meta.get("pages") else ""
        return f"[{index}] {authors}. {title}[J].{f' {gbt_venue}{gbt_pages}.' if gbt_venue else '.'}".strip()

    return f"{authors} ({year}). {title}. {journal}".strip()
