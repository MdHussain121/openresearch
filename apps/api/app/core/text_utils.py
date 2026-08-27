"""
Text and citation author utility functions for OpenResearch.
"""

import re
from typing import Any, TypedDict

from app.core.authors import split_full_name


class AuthorRecord(TypedDict, total=False):
    """Canonical author shape persisted in ``Paper.authors``.

    All fields are plain ``str``; producers must normalize missing values to
    ``""`` rather than ``None`` so bibliography formatters never see ``None``.
    """

    familyName: str
    givenName: str
    literal: str
    name: str


def _coerce_str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def normalize_author_record(raw: Any) -> AuthorRecord:
    """Coerce an arbitrary author entry (str, dict from external APIs) into an AuthorRecord."""
    if isinstance(raw, str):
        name = raw.strip() or "Unknown"
        result = split_full_name(name)
        return AuthorRecord(
            familyName=result["familyName"],
            givenName=result["givenName"],
            literal=result["literal"],
        )
    if not isinstance(raw, dict):
        name = str(raw).strip() or "Unknown"
        return {"familyName": name, "literal": name}
    record: AuthorRecord = {
        "familyName": _coerce_str(raw.get("familyName")) or _coerce_str(raw.get("lastName")),
        "givenName": _coerce_str(raw.get("givenName")) or _coerce_str(raw.get("firstName")),
        "literal": _coerce_str(raw.get("literal")),
    }
    name = _coerce_str(raw.get("name"))
    if not record["familyName"]:
        record["familyName"] = name or "Unknown"
    if not record["literal"]:
        joined = f"{record['givenName']} {record['familyName']}".strip()
        record["literal"] = joined or name or "Unknown"
    return record


_UNPAIRED_SURROGATES = re.compile(r"[\ud800-\udfff]")


def sanitize_surrogates(text: str) -> str:
    """
    Replace unpaired UTF-16 surrogate code points with U+FFFD.

    JSON permits '\\ud800'-style escapes for lone surrogates; Python's json.loads
    keeps them as-is, and any later .encode('utf-8') raises UnicodeEncodeError.
    Valid surrogate pairs are already combined during JSON decoding, so anything
    matching this pattern is genuinely unpaired and safe to replace.
    """
    if not text:
        return text
    if _UNPAIRED_SURROGATES.search(text) is None:
        return text
    return _UNPAIRED_SURROGATES.sub("\ufffd", text)


def split_sentences(text: str) -> list[str]:
    """Split text into sentences using standard academic boundary punctuation."""
    if not text:
        return []
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def format_authors_summary(authors: list[Any] | None) -> str:
    """Format authors into a short concise summary string (e.g. 'Vaswani et al.')."""
    if not authors:
        return "Unknown Author"
    if isinstance(authors, list):
        names = []
        for a in authors:
            if isinstance(a, dict):
                names.append(a.get("familyName") or a.get("literal") or a.get("name") or "Author")
            elif isinstance(a, str):
                names.append(a)
        if not names:
            return "Unknown Author"
        if len(names) == 1:
            return names[0]
        if len(names) == 2:
            return f"{names[0]} & {names[1]}"
        return f"{names[0]} et al."
    return str(authors)


def format_authors_inline(authors: list[Any] | None, style: str = "apa") -> str:
    """Format authors for in-text citation markers."""
    if not authors:
        return "Unknown"

    fam_names = []
    for a in authors:
        if isinstance(a, dict):
            fam_names.append(a.get("familyName") or a.get("literal") or a.get("name") or "Unknown")
        else:
            fam_names.append(str(a))

    if not fam_names:
        return "Unknown"
    if len(fam_names) == 1:
        return fam_names[0]
    if len(fam_names) == 2:
        style_l = (style or "").lower()
        if style_l in ["mla", "chicago", "apsa", "asa", "aaa", "cse", "iso690"]:
            return f"{fam_names[0]} and {fam_names[1]}"
        return f"{fam_names[0]} & {fam_names[1]}"
    return f"{fam_names[0]} et al."


def format_authors_bibliography(authors: list[Any] | None, style: str = "apa") -> str:
    """Format full author list for Bibliography entry."""
    if not authors:
        return "Unknown Author"

    style = (style or "apa").lower()

    def format_single(a: Any, inverted: bool = True) -> str:
        if isinstance(a, str):
            return a
        if not isinstance(a, dict):
            return str(a)
        literal = a.get("literal")
        if literal:
            return str(literal)
        fam = (a.get("familyName") or "").strip()
        given = (a.get("givenName") or "").strip()
        if not given:
            return fam or "Unknown"
        initial = given[0].upper() + "."

        if style in ("vancouver", "nlm", "ama", "cse"):
            return f"{fam} {initial.replace('.', '')}"
        if style == "gbt7714":
            return f"{fam.upper()} {initial.replace('.', '')}"
        if style == "ieee":
            return f"{initial} {fam}"
        if style in ("mhra", "oxford", "oscola", "bluebook"):
            return f"{given} {fam}".strip()
        if style == "abnt":
            return f"{fam.upper()}, {initial}"
        if inverted:
            return f"{fam}, {initial}"
        return f"{given} {fam}"

    formatted_authors = [format_single(a, True) for a in authors]

    if len(formatted_authors) == 1:
        return formatted_authors[0]

    if style in ("vancouver", "nlm"):
        if len(formatted_authors) <= 6:
            return ", ".join(formatted_authors)
        return ", ".join(formatted_authors[:6]) + ", et al."

    if style == "ama":
        if len(formatted_authors) <= 6:
            return ", ".join(formatted_authors)
        return f"{formatted_authors[0]}, et al."

    if style == "cse":
        if len(formatted_authors) <= 10:
            return ", ".join(formatted_authors)
        return f"{formatted_authors[0]}, et al."

    if style == "gbt7714":
        if len(formatted_authors) <= 3:
            return ", ".join(formatted_authors)
        return ", ".join(formatted_authors[:3]) + ", et al."

    if style == "abnt":
        if len(authors) <= 3:
            abnt_all = [format_single(a, True) for a in authors]
            return "; ".join(abnt_all)
        first_abnt = format_single(authors[0], True)
        return f"{first_abnt} et al."

    if style in ("mhra", "oxford", "oscola", "bluebook"):
        natural = [format_single(a, False) for a in authors]
        if len(natural) == 2:
            return " and ".join(natural)
        return f"{natural[0]} et al."

    if style == "asa":
        if len(authors) == 2 and isinstance(authors[1], dict):
            second_str = (
                f"{authors[1].get('givenName') or ''} {authors[1].get('familyName') or ''}".strip()
            )
            return f"{formatted_authors[0]}, and {second_str}"
        return f"{formatted_authors[0]}, et al."

    if style == "ieee":
        ieee_authors = [format_single(a, False) for a in authors]
        if len(ieee_authors) <= 6:
            return ", ".join(ieee_authors)
        return f"{ieee_authors[0]} et al."

    if style in ("apa", "cell"):
        if len(formatted_authors) == 2:
            return f"{formatted_authors[0]}, & {formatted_authors[1]}"
        if len(formatted_authors) <= 20:
            return ", ".join(formatted_authors[:-1]) + f", & {formatted_authors[-1]}"
        return ", ".join(formatted_authors[:19]) + f", ... {formatted_authors[-1]}"

    if style == "mla":
        if len(authors) == 2:
            given2 = authors[1].get("givenName") or "" if isinstance(authors[1], dict) else ""
            fam2 = (
                authors[1].get("familyName") or ""
                if isinstance(authors[1], dict)
                else str(authors[1])
            )
            second_str = f"{given2} {fam2}".strip()
            return f"{formatted_authors[0]}, and {second_str}"
        return f"{formatted_authors[0]}, et al."

    if style in ("chicago", "apsa", "aaa"):
        if len(authors) == 2:
            given2 = authors[1].get("givenName") or "" if isinstance(authors[1], dict) else ""
            fam2 = (
                authors[1].get("familyName") or ""
                if isinstance(authors[1], dict)
                else str(authors[1])
            )
            second_str = f"{given2} {fam2}".strip()
            return f"{formatted_authors[0]}, and {second_str}"
        return f"{formatted_authors[0]}, et al."

    # Harvard default
    if len(formatted_authors) == 2:
        return f"{formatted_authors[0]} and {formatted_authors[1]}"
    return f"{formatted_authors[0]} et al."


def format_inline_marker(
    authors: list[Any] | None = None,
    year: str | int | None = None,
    style: str = "apa",
    index: int = 1,
    page_num: int | None = None,
) -> str:
    """Format inline citation text e.g., (Vaswani et al., 2017) or [1]."""
    style = (style or "apa").lower()
    author_str = format_authors_inline(authors, style)
    year_str = str(year) if year else "n.d."
    page_str = f": {page_num}" if page_num else ""

    if style == "apa":
        return f"({author_str}, {year_str}{page_str})"
    if style == "mla":
        mla_page = f" {page_num}" if page_num else ""
        return f"({author_str}{mla_page})"
    if style in ("chicago", "turabian"):
        return f"({author_str} {year_str}{page_str})"
    if style in ("harvard", "apsa", "iso690"):
        return f"({author_str}, {year_str}{page_str})"
    if style in ("asa", "aaa"):
        return f"({author_str} {year_str}{page_str})"
    if style == "ieee" or style in ("acm", "cse", "gbt7714"):
        return f"[{index}]"
    if style in ("vancouver", "nlm", "science", "acs", "cell"):
        return f"({index})"
    if style in ("nature", "chicago-notes", "ama", "mhra", "oxford", "oscola", "bluebook"):
        return f"{index}"
    if style == "abnt":
        fams = []
        for a in authors or []:
            if isinstance(a, dict):
                fams.append((a.get("familyName") or a.get("literal") or "Unknown").upper())
            else:
                fams.append(str(a).upper())
        abnt_authors = f"{fams[0]} et al." if len(fams) > 2 else "; ".join(fams)
        return f"({abnt_authors}, {year_str}{page_str})"
    return f"({author_str}, {year_str})"
