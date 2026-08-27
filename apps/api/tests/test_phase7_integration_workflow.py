import io

import docx
from fastapi.testclient import TestClient
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.models.citation import Citation
from app.models.paper import Paper
from app.services.auth import create_access_token


def test_full_academic_researcher_lifecycle(client: TestClient, db: Session):
    """
    Complete End-to-End MVP Integration Workflow (Roadmap Phase 7.3):
    1. Authentication: Register user & establish workspace.
    2. Project Management: Create dedicated research project.
    3. Paper Ingestion: Ingest research paper with metadata & chunks.
    4. Grounded AI Chat: Query indexed literature with provenance & trust legend.
    5. Document Authoring: Create paper draft, insert outline & text.
    6. Citation Insertion: Link citations across APA/IEEE styles.
    7. Multi-Format Export: Export to Markdown, DOCX, PDF, and BibTeX.
    """

    # --- Step 1: User & Workspace Setup ---
    from app.services.auth import create_user_with_personal_owner

    user = create_user_with_personal_owner(
        db=db,
        email="researcher@stanford.edu",
        password="secure_password_hash_123",
        name="Dr. Alex Rivera",
    )

    token = create_access_token({"sub": user.id})
    headers = {"Authorization": f"Bearer {token}"}

    # --- Step 2: Project Creation ---
    res_proj = client.post(
        "/api/v1/projects/",
        json={
            "name": "Attention Mechanisms in Deep Learning",
            "description": "Comprehensive comparative study of memory-efficient attention.",
        },
        headers=headers,
    )
    assert res_proj.status_code == 201
    project_id = res_proj.json()["id"]

    # --- Step 3: Paper Ingestion & Indexing ---
    paper = Paper(
        id="paper_transformer_2017",
        project_id=project_id,
        title="Attention Is All You Need",
        abstract=(
            "The dominant sequence transduction models are based on complex recurrent or convolutional neural "
            "networks. We propose the Transformer, based solely on attention mechanisms."
        ),
        year=2017,
        doi="10.48550/arXiv.1706.03762",
        arxiv_id="1706.03762",
        authors=[
            {"familyName": "Vaswani", "givenName": "Ashish"},
            {"familyName": "Shazeer", "givenName": "Noam"},
            {"familyName": "Parmar", "givenName": "Niki"},
        ],
        metadata_json={
            "journal": "Advances in Neural Information Processing Systems",
            "volume": "30",
            "pages": "5998-6008",
        },
        extraction_status="verified",
    )
    db.add(paper)
    db.commit()

    # --- Step 4: Grounded AI Querying ---
    res_chat = client.post(
        f"/api/v1/projects/{project_id}/chat",
        json={
            "message": "What architecture does the Transformer replace?",
            "mode": "project",
        },
        headers=headers,
    )
    assert res_chat.status_code == 200
    chat_data = res_chat.json()
    assert "answer" in chat_data
    assert "grounding_state" in chat_data

    # --- Step 5: Document Authoring & AI Assistance ---
    res_doc = client.post(
        "/api/v1/documents/",
        json={
            "project_id": project_id,
            "title": "A Survey of Efficient Transformer Attention",
            "plain_text": "# Introduction\n\nTransformers have revolutionized NLP and vision models.",
            "content_json": {
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
                                "text": "The Transformer architecture was introduced by ",
                            },
                            {
                                "type": "citation",
                                "attrs": {"paperId": paper.id, "label": "(Vaswani et al., 2017)"},
                            },
                            {"type": "text", "text": " and eliminates recurrence completely."},
                            {"type": "trustMarker", "attrs": {"markerNumber": 1}},
                        ],
                    },
                    {
                        "type": "heading",
                        "attrs": {"level": 2},
                        "content": [{"type": "text", "text": "Computational Complexity"}],
                    },
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": "Standard self-attention computes dot-product scores between queries and keys.",
                            }
                        ],
                    },
                    {
                        "type": "mathEquation",
                        "attrs": {
                            "latex": "\\text{Attention}(Q, K, V) = \\text{softmax}(QK^T / \\sqrt{d_k})V"
                        },
                    },
                ],
            },
        },
        headers=headers,
    )
    assert res_doc.status_code == 201
    document_id = res_doc.json()["id"]

    # Insert Citation record
    citation = Citation(
        id="cite_trans_1",
        document_id=document_id,
        paper_id=paper.id,
        position=1,
        page_number=2,
        attribution_scope="sentence",
    )
    db.add(citation)
    db.commit()

    # --- Step 6: Multi-Format Export Verification ---

    # 1. Export Markdown (.md)
    res_exp_md = client.post(
        f"/api/v1/documents/{document_id}/export",
        json={
            "export_format": "markdown",
            "citation_style": "apa",
            "include_bibliography": True,
            "include_trust_markers": True,
        },
        headers=headers,
    )
    assert res_exp_md.status_code == 200
    md_body = res_exp_md.text
    assert "# A Survey of Efficient Transformer Attention" in md_body
    assert "## References" in md_body
    assert "Vaswani, A." in md_body
    assert "[^1]: Source-grounded:" in md_body
    assert "\\text{Attention}" in md_body

    # 2. Export Word Document (.docx)
    res_exp_docx = client.post(
        f"/api/v1/documents/{document_id}/export",
        json={"export_format": "docx", "citation_style": "apa", "include_bibliography": True},
        headers=headers,
    )
    assert res_exp_docx.status_code == 200
    docx_reader = docx.Document(io.BytesIO(res_exp_docx.content))
    all_docx_text = " ".join([p.text for p in docx_reader.paragraphs])
    assert "A Survey of Efficient Transformer Attention" in all_docx_text
    assert "References" in all_docx_text
    assert "Vaswani" in all_docx_text

    # 3. Export PDF Document (.pdf)
    res_exp_pdf = client.post(
        f"/api/v1/documents/{document_id}/export",
        json={"export_format": "pdf", "citation_style": "ieee", "include_bibliography": True},
        headers=headers,
    )
    assert res_exp_pdf.status_code == 200
    assert res_exp_pdf.content.startswith(b"%PDF")
    pdf_reader = PdfReader(io.BytesIO(res_exp_pdf.content))
    extracted_pdf_text = pdf_reader.pages[0].extract_text()
    assert "A Survey of Efficient Transformer Attention" in extracted_pdf_text

    # 4. Export BibTeX (.bib)
    res_exp_bib = client.post(
        f"/api/v1/documents/{document_id}/export",
        json={"export_format": "bibtex"},
        headers=headers,
    )
    assert res_exp_bib.status_code == 200
    assert "@article{" in res_exp_bib.text
    assert "title = {Attention Is All You Need}" in res_exp_bib.text
    assert "eprint = {1706.03762}" in res_exp_bib.text
