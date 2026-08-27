"""
Canonical author-name parsing and formatting.

All author splitting / normalization lives here. Callers should not re-implement
name decomposition; import these helpers instead.
"""



def split_full_name(name: str, family_first: bool = False) -> dict[str, str]:
    """Split a single full name string into {familyName, givenName, literal}.

    Parameters
    ----------
    name:
        Raw name string, e.g. ``"John Smith"`` or ``"Smith, John"``.
    family_first:
        When *True*, treat the **first** token as the family name (PubMed
        convention ``"Smith J"``).  When *False* (default), treat the **last**
        token as the family name (Western / arXiv convention ``"John Smith"``).
    """
    raw = (name or "").strip()
    if not raw:
        return {"familyName": "Unknown", "givenName": "", "literal": "Unknown"}

    if "," in raw:
        parts = [p.strip() for p in raw.split(",", 1)]
        return {
            "familyName": parts[0] or "Unknown",
            "givenName": parts[1] if len(parts) > 1 else "",
            "literal": raw,
        }

    tokens = raw.split()
    if family_first:
        family = tokens[0]
        given = " ".join(tokens[1:])
    else:
        family = tokens[-1]
        given = " ".join(tokens[:-1]) if len(tokens) > 1 else ""

    return {"familyName": family, "givenName": given, "literal": raw}


def parse_bibtex_author_field(raw: str) -> list[dict[str, str]]:
    """Parse a BibTeX ``author`` field (``" and "``-delimited) into author dicts.

    Each entry is ``"Last, First"`` or ``"First Last"``.  Braces are stripped.
    """
    if not raw or not raw.strip():
        return []

    authors: list[dict[str, str]] = []
    for part in raw.split(" and "):
        cleaned = part.strip().strip("{}").strip()
        if not cleaned:
            continue
        authors.append(split_full_name(cleaned, family_first=False))
    return authors
