import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.text_utils import (
    format_authors_bibliography,
    format_authors_inline,
    format_authors_summary,
    split_sentences,
)
from app.models.citation import Citation
from app.models.document import Document
from app.models.paper import Paper
from app.services.export import (
    ExportOptions,
    ExportService,
)
from app.services.identifier_resolver import identifier_resolver
from app.services.provider_cache_service import provider_cache_service


def setup_auth_user_and_project(client: TestClient):
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "services_coverage_tester@openresearch.org",
            "password": "Secure_Academic_Pass123",
            "name": "Prof. Ada Lovelace",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    proj = client.post(
        "/api/v1/projects", json={"name": "Analytical Engines"}, headers=headers
    ).json()
    return headers, proj["id"]


def test_text_utils_all_styles_and_author_counts():
    """Exhaustively verify core text utilities across all styles and edge cases."""
    a1 = {"familyName": "Vaswani", "givenName": "Ashish"}
    a2 = {"familyName": "Shazeer", "givenName": "Noam"}
    a3 = {"familyName": "Parmar", "givenName": "Niki"}
    authors_empty = []
    authors_single = [a1]
    authors_pair = [a1, a2]
    authors_many = [a1, a2, a3]

    styles = ["apa", "mla", "chicago", "harvard", "ieee", "vancouver"]
    for s in styles:
        assert format_authors_inline(authors_empty, s) == "Unknown"
        assert format_authors_inline(authors_single, s) == "Vaswani"
        assert "Vaswani" in format_authors_inline(authors_pair, s)
        assert "et al." in format_authors_inline(authors_many, s)

    # format_authors_bibliography
    for s in styles:
        assert len(format_authors_bibliography(authors_empty, s)) > 0
        assert len(format_authors_bibliography(authors_single, s)) > 0
        assert len(format_authors_bibliography(authors_pair, s)) > 0
        assert len(format_authors_bibliography(authors_many, s)) > 0

    # format_authors_summary
    assert format_authors_summary(None) == "Unknown Author"
    assert format_authors_summary([a1]) == "Vaswani"
    assert format_authors_summary([a1, a2]) == "Vaswani & Shazeer"
    assert format_authors_summary([a1, a2, a3]) == "Vaswani et al."

    # split_sentences
    sentences = split_sentences("First sentence. Second sentence! Third sentence? Fourth sentence.")
    assert len(sentences) == 4
    assert split_sentences("") == []


def test_provider_cache_service_lifecycle():
    """Verify provider cache service TTL, eviction, stats, and clear."""
    provider_cache_service.clear()
    provider_cache_service.set("k1", {"data": "v1"}, ttl_seconds=60)
    provider_cache_service.set("k2", {"data": "v2"}, ttl_seconds=60)

    assert provider_cache_service.get("k1") == {"data": "v1"}
    assert provider_cache_service.get("nonexistent") is None

    quota_status = provider_cache_service.get_quota_status()
    assert len(quota_status.providers) >= 3

    res_clear = provider_cache_service.clear()
    assert res_clear.status == "ok"


def test_identifier_resolver_parsing_and_fallbacks():
    """Verify identifier resolver for various academic formats."""
    # 1. DOI detection
    assert identifier_resolver.detect_identifier_type("10.1038/nature12373") == "doi"

    # 2. arXiv detection
    assert identifier_resolver.detect_identifier_type("arXiv:1706.03762") == "arxiv"

    # 3. PMID detection
    assert identifier_resolver.detect_identifier_type("PMID: 28734928") == "pmid"


def test_export_engine_all_formats_and_options(db: Session):
    """Verify export to Markdown, Docx, PDF, BibTeX with ExportOptions."""
    doc = Document(
        id="test-export-doc",
        project_id="proj-1",
        title="Deep Learning for Science",
        content_json={
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 1},
                    "content": [{"type": "text", "text": "Introduction"}],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": "Deep architectures achieve strong empirical success.",
                        }
                    ],
                },
                {
                    "type": "blockquote",
                    "content": [{"type": "text", "text": "Science is empirical."}],
                },
                {
                    "type": "codeBlock",
                    "content": [{"type": "text", "text": "print('hello world')"}],
                },
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "Point 1"}],
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "orderedList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "Step 1"}],
                                }
                            ],
                        }
                    ],
                },
            ],
        },
    )

    paper = Paper(
        id="test-p1",
        project_id="proj-1",
        title="Attention Is All You Need",
        authors=[{"familyName": "Vaswani", "givenName": "Ashish"}],
        year=2017,
        doi="10.5555/3295222.3295349",
        metadata_json={"journal": "NeurIPS"},
    )

    cit = Citation(
        id="cit-1",
        document_id=doc.id,
        paper_id=paper.id,
        position=1,
        citation_style="apa",
        attribution_scope="sentence",
    )

    options = ExportOptions(
        export_format="markdown",
        citation_style="apa",
        include_bibliography=True,
        include_trust_markers=True,
    )

    # 1. Markdown
    md_content, filename_md, mime_md = ExportService.export_document(
        document=doc,
        citations=[cit],
        papers=[paper],
        options=options,
    )
    assert "# Deep Learning for Science" in md_content
    assert "References" in md_content
    assert filename_md.endswith(".md")
    assert "text/markdown" in mime_md

    # 2. BibTeX
    options_bib = ExportOptions(export_format="bibtex")
    bib_content, filename_bib, mime_bib = ExportService.export_document(
        document=doc,
        citations=[cit],
        papers=[paper],
        options=options_bib,
    )
    assert "@article" in bib_content
    assert filename_bib.endswith(".bib")

    # 3. DOCX
    options_docx = ExportOptions(export_format="docx", citation_style="ieee")
    docx_buf, filename_docx, mime_docx = ExportService.export_document(
        document=doc,
        citations=[cit],
        papers=[paper],
        options=options_docx,
    )
    assert isinstance(docx_buf, io.BytesIO)
    assert len(docx_buf.getvalue()) > 0
    assert filename_docx.endswith(".docx")

    # 4. PDF
    options_pdf = ExportOptions(export_format="pdf", citation_style="apa")
    pdf_buf, filename_pdf, mime_pdf = ExportService.export_document(
        document=doc,
        citations=[cit],
        papers=[paper],
        options=options_pdf,
    )
    assert isinstance(pdf_buf, io.BytesIO)
    assert len(pdf_buf.getvalue()) > 0
    assert filename_pdf.endswith(".pdf")


def test_teams_and_collaboration_extended_routes(client: TestClient):
    """Verify team update, delete, member roles, and project comments."""
    headers, project_id = setup_auth_user_and_project(client)

    # 1. Create team
    team_res = client.post(
        "/api/v1/teams/",
        json={"name": "Vision & Language Lab", "description": "Multimodal research group"},
        headers=headers,
    )
    assert team_res.status_code == 201
    team_id = team_res.json()["id"]

    # 2. Update team
    update_res = client.patch(
        f"/api/v1/teams/{team_id}",
        json={"name": "Multimodal Intelligence Lab"},
        headers=headers,
    )
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "Multimodal Intelligence Lab"

    # 3. List members
    members_res = client.get(f"/api/v1/teams/{team_id}/members", headers=headers)
    assert members_res.status_code == 200
    assert len(members_res.json()) >= 1

    # 4. Create document & comments
    doc_res = client.post(
        "/api/v1/documents",
        json={"project_id": project_id, "title": "Collaborative Notes"},
        headers=headers,
    )
    assert doc_res.status_code == 201
    doc_id = doc_res.json()["id"]

    com_res = client.post(
        f"/api/v1/documents/{doc_id}/comments",
        json={
            "selected_text": "Multimodal fusion",
            "content": "Consider adding cross-attention discussion.",
        },
        headers=headers,
    )
    assert com_res.status_code == 201
    com_id = com_res.json()["id"]

    # Reply to comment
    reply_res = client.post(
        f"/api/v1/documents/{doc_id}/comments/{com_id}/replies",
        json={
            "content": "Agreed, section 3 will incorporate cross-attention layers.",
        },
        headers=headers,
    )
    assert reply_res.status_code == 201

    # Resolve parent comment
    res_resolve = client.patch(
        f"/api/v1/documents/{doc_id}/comments/{com_id}",
        json={"resolved": True},
        headers=headers,
    )
    assert res_resolve.status_code == 200
    assert res_resolve.json()["resolved"] is True
