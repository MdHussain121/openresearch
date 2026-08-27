import io
from types import SimpleNamespace

import app.services.rag_service as rag_module
from app.models.chunk import PaperChunk
from app.models.paper import Paper
from app.schemas.models import GroundedPassage


def create_sample_pdf_bytes() -> bytes:
    """Create a valid simple PDF stream for test uploads."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >> endobj\n"
        b"4 0 obj << /Length 200 >>\n"
        b"stream\n"
        b"BT\n"
        b"/F1 12 Tf\n"
        b"100 700 Td\n"
        b"(Attention Is All You Need) Tj\n"
        b"0 -20 Td\n"
        b"(Ashish Vaswani, Noam Shazeer, Niki Parmar) Tj\n"
        b"0 -20 Td\n"
        b"(Abstract: The dominant sequence transduction models are based on complex recurrent or convolutional "
        b"neural networks.) Tj\n"
        b"0 -20 Td\n"
        b"(1. Introduction: Recurrent models typically factor computation along the symbol positions.) Tj\n"
        b"0 -20 Td\n"
        b"(Table 1: BLEU scores on WMT 2014 English-to-German translation.) Tj\n"
        b"0 -20 Td\n"
        b"(Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V) Tj\n"
        b"0 -20 Td\n"
        b"(References: Vaswani et al., 2017. Attention is all you need. arXiv:1706.03762.) Tj\n"
        b"ET\n"
        b"endstream\n"
        b"endobj\n"
        b"xref\n"
        b"0 5\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"0000000214 00000 n \n"
        b"trailer << /Size 5 /Root 1 0 R >>\n"
        b"startxref\n"
        b"465\n"
        b"%%EOF\n"
    )


def test_paper_upload_and_pipeline_lifecycle(client, db, monkeypatch):
    # 1. Register user and create project
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "vaswani@google.com",
            "password": "TransformerPassword123",
            "name": "Ashish Vaswani",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "Transformer Architecture"}, headers=headers
    ).json()
    project_id = proj["id"]

    # 2. Test Invalid File Upload (not a PDF)
    invalid_file = io.BytesIO(b"This is plain text, not a PDF")
    res_bad = client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={"file": ("fake.txt", invalid_file, "text/plain")},
        headers=headers,
    )
    assert res_bad.status_code == 400
    assert "missing %PDF header" in res_bad.json()["error"]["message"]

    # 3. Test Valid PDF Upload
    pdf_data = create_sample_pdf_bytes()
    res_upload = client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={"file": ("attention_is_all_you_need.pdf", io.BytesIO(pdf_data), "application/pdf")},
        headers=headers,
    )
    assert res_upload.status_code == 201
    paper = res_upload.json()
    paper_id = paper["id"]
    assert paper["project_id"] == project_id
    assert "title" in paper
    assert paper["extraction_status"] in ["ok", "unverified"]
    assert paper["metadata_json"] is not None

    # 4. Check Status Endpoint (Stepped pipeline indicator UI/UX §6.1)
    status_res = client.get(f"/api/v1/papers/{paper_id}/status", headers=headers)
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["step"] == "ready"
    assert status_data["step_index"] == 4
    assert status_data["extraction_status"] in ["ok", "unverified"]

    # 5. List Papers in Project & Test Keyword Search (§11, §3.3)
    list_res = client.get(f"/api/v1/projects/{project_id}/papers", headers=headers)
    assert list_res.status_code == 200
    papers = list_res.json()
    assert len(papers) == 1
    assert papers[0]["id"] == paper_id

    # Test keyword search matching
    search_match = client.get(f"/api/v1/projects/{project_id}/papers?q=attention", headers=headers)
    assert search_match.status_code == 200
    assert len(search_match.json()) >= 1

    search_nomatch = client.get(
        f"/api/v1/projects/{project_id}/papers?q=nonexistentqueryxyz", headers=headers
    )
    assert search_nomatch.status_code == 200
    assert len(search_nomatch.json()) == 0

    # 6. Retrieve Full Paper Details
    get_paper_res = client.get(f"/api/v1/papers/{paper_id}", headers=headers)
    assert get_paper_res.status_code == 200
    paper_detail = get_paper_res.json()
    assert paper_detail["id"] == paper_id
    assert "sections" in paper_detail["metadata_json"]
    assert "tables" in paper_detail["metadata_json"]
    assert "equations" in paper_detail["metadata_json"]

    # 7. Test PDF Streaming endpoint
    pdf_stream_res = client.get(f"/api/v1/papers/{paper_id}/pdf", headers=headers)
    assert pdf_stream_res.status_code == 200
    assert pdf_stream_res.headers["content-type"] == "application/pdf"
    assert len(pdf_stream_res.content) > 0

    # 8. Test Annotations & Highlights
    # Create Highlight & Note
    annot_res = client.post(
        f"/api/v1/papers/{paper_id}/annotations",
        json={
            "paper_id": paper_id,
            "page_number": 1,
            "selected_text": (
                "The dominant sequence transduction models are based on complex recurrent or convolutional neural "
                "networks."
            ),
            "highlight_color": "yellow",
            "note_text": "Key contrast point for transformer motivation.",
        },
        headers=headers,
    )
    assert annot_res.status_code == 201
    annot = annot_res.json()
    annot_id = annot["id"]
    assert annot["page_number"] == 1
    assert annot["highlight_color"] == "yellow"
    assert annot["note_text"] == "Key contrast point for transformer motivation."

    # List Annotations
    list_annots = client.get(f"/api/v1/papers/{paper_id}/annotations", headers=headers)
    assert list_annots.status_code == 200
    assert len(list_annots.json()) == 1

    # Update Annotation
    patch_annot = client.patch(
        f"/api/v1/papers/{paper_id}/annotations/{annot_id}",
        json={"highlight_color": "green", "note_text": "Updated note content."},
        headers=headers,
    )
    assert patch_annot.status_code == 200
    assert patch_annot.json()["highlight_color"] == "green"
    assert patch_annot.json()["note_text"] == "Updated note content."

    # 9. Test Selection-Anchored AI Assistance (Ask AI on selection)
    # Force the deterministic honest-refusal path: retrieval succeeds but no
    # LLM provider is reachable, so the endpoint must answer 503.
    db.add(
        PaperChunk(
            id=f"{paper_id}-chunk-1",
            paper_id=paper_id,
            project_id=project_id,
            content="Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V",
        )
    )
    db.commit()
    passage = GroundedPassage(
        paper_id=paper_id,
        paper_title=paper["title"],
        authors="Vaswani et al.",
        page_number=1,
        section="Abstract",
        passage_text="Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V",
        score=0.9,
    )
    monkeypatch.setattr(rag_module.rag_service, "hybrid_search", lambda **kwargs: [passage])
    monkeypatch.setattr(rag_module, "llm_service", SimpleNamespace(generate=lambda *a, **k: None))

    ask_res = client.post(
        f"/api/v1/papers/{paper_id}/ask",
        json={
            "selected_text": "Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V",
            "page_number": 1,
            "prompt_type": "explain",
        },
        headers=headers,
    )
    assert ask_res.status_code == 503
    ask_data = ask_res.json()
    assert "AI provider" in ask_data["error"]["message"]

    # 10. Delete Annotation
    del_annot = client.delete(f"/api/v1/papers/{paper_id}/annotations/{annot_id}", headers=headers)
    assert del_annot.status_code == 204

    # 11. Delete Paper
    del_paper = client.delete(f"/api/v1/papers/{paper_id}", headers=headers)
    assert del_paper.status_code == 204

    # Verify deleted
    get_del = client.get(f"/api/v1/papers/{paper_id}", headers=headers)
    assert get_del.status_code == 404


def test_ask_paper_returns_grounded_answer_with_mocked_provider(client, db, monkeypatch):
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "ask_grounded@openresearch.org",
            "password": "TransformerPassword123",
            "name": "Grounded Asker",
        },
    ).json()
    headers = {"Authorization": f"Bearer {reg['access_token']}"}
    proj = client.post("/api/v1/projects", json={"name": "Ask AI Grounded"}, headers=headers).json()

    paper = Paper(
        id="ask-grounded-p", project_id=proj["id"], title="Grounded Ask", extraction_status="ok"
    )
    db.add(paper)
    db.add(
        PaperChunk(
            id="ask-grounded-c1",
            paper_id=paper.id,
            project_id=proj["id"],
            content="Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V",
        )
    )
    db.commit()

    passage = GroundedPassage(
        paper_id=paper.id,
        paper_title=paper.title,
        authors="Vaswani et al.",
        page_number=1,
        section="Abstract",
        passage_text="Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V",
        score=0.95,
    )
    monkeypatch.setattr(rag_module.rag_service, "hybrid_search", lambda **kwargs: [passage])
    monkeypatch.setattr(
        rag_module,
        "llm_service",
        SimpleNamespace(
            generate=lambda *a, **k: "The formula computes a weighted sum of value vectors."
        ),
    )

    res = client.post(
        f"/api/v1/papers/{paper.id}/ask",
        json={
            "selected_text": "Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V",
            "page_number": 1,
            "prompt_type": "explain",
        },
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["grounded"] is True
    assert data["insufficient_evidence"] is False
    assert data["prompt_type"] == "explain"
    assert len(data["sources"]) >= 1
    assert "weighted sum" in data["answer"]
