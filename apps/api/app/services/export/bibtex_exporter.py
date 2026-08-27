"""
BibTeX Exporter (.bib) for OpenResearch Export Engine.
"""

import re
from typing import Any

from app.models.citation import Citation
from app.models.document import Document
from app.models.paper import Paper


def bibtex_escape(value: Any) -> str:
    """Escape BibTeX-special characters in user-controlled field values."""
    text = str(value)
    text = text.replace("\\", "\\\\")
    for ch, repl in (
        ("{", "\\{"),
        ("}", "\\}"),
        ("&", "\\&"),
        ("%", "\\%"),
        ("#", "\\#"),
        ("_", "\\_"),
    ):
        text = text.replace(ch, repl)
    return text


def make_citation_key(paper: Paper) -> str:
    """Derive a BibTeX citation key: firstauthorClean + year + firstTitleWord."""
    authors_list = paper.authors or [{"familyName": "Unknown"}]
    first_fam = (
        (authors_list[0].get("familyName") or "paper")
        if isinstance(authors_list[0], dict)
        else "paper"
    ).lower()
    first_clean = re.sub(r"[^a-z0-9]", "", first_fam) or "ref"
    year = paper.year or 2023
    title_words = (paper.title or "paper").lower().split()
    title_word = re.sub(r"[^a-z0-9]", "", title_words[0]) if title_words else "ref"
    return f"{first_clean}{year}{title_word}"


def serialize_paper_bibtex(paper: Paper) -> str:
    """Serialize a single Paper object into valid BibTeX format with proper escaping."""
    entry_type = "article"
    authors_list = paper.authors or [{"familyName": "Unknown"}]
    author_strs = []
    for author in authors_list:
        if isinstance(author, dict):
            fam = author.get("familyName") or "Unknown"
            given = author.get("givenName") or ""
            if given:
                author_strs.append(f"{fam}, {given}")
            else:
                author_strs.append(fam if fam else str(author))
        else:
            author_strs.append(str(author))
    authors_formatted = bibtex_escape(" and ".join(author_strs))

    cite_key = make_citation_key(paper)

    fields = [
        f"  title = {{{bibtex_escape(paper.title)}}}",
        f"  author = {{{authors_formatted}}}",
        f"  year = {{{paper.year or 2023}}}",
    ]
    meta = paper.metadata_json or {}
    if meta.get("journal"):
        fields.append(f"  journal = {{{bibtex_escape(meta.get('journal'))}}}")
    if meta.get("volume"):
        fields.append(f"  volume = {{{bibtex_escape(meta.get('volume'))}}}")
    if meta.get("issue"):
        fields.append(f"  number = {{{bibtex_escape(meta.get('issue'))}}}")
    if meta.get("pages"):
        fields.append(f"  pages = {{{bibtex_escape(meta.get('pages'))}}}")
    if meta.get("publisher"):
        fields.append(f"  publisher = {{{bibtex_escape(meta.get('publisher'))}}}")
    if paper.doi:
        fields.append(f"  doi = {{{bibtex_escape(paper.doi)}}}")
    if paper.arxiv_id:
        fields.append(f"  eprint = {{{bibtex_escape(paper.arxiv_id)}}}")
        fields.append("  archivePrefix = {arXiv}")
    if paper.pmid:
        fields.append(f"  pmid = {{{bibtex_escape(paper.pmid)}}}")
    if paper.abstract:
        clean_abs = paper.abstract.replace("\n", " ")
        fields.append(f"  abstract = {{{bibtex_escape(clean_abs)}}}")

    return f"@{entry_type}{{{cite_key},\n" + ",\n".join(fields) + "\n}"


def export_to_bibtex(document: Document, citations: list[Citation], papers: list[Paper]) -> str:
    """Generate BibTeX file for all cited papers in a document (or all library papers)."""
    paper_dict = {paper.id: paper for paper in papers}
    target_papers = []

    if citations:
        seen = set()
        for citation in citations:
            if citation.paper_id in paper_dict and citation.paper_id not in seen:
                seen.add(citation.paper_id)
                target_papers.append(paper_dict[citation.paper_id])
    else:
        target_papers = papers

    entries = [serialize_paper_bibtex(paper) for paper in target_papers]
    return "\n\n".join(entries) + "\n"
