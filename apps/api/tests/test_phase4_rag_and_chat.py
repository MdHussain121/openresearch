import io


def create_transformer_paper_pdf() -> bytes:
    return (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >> endobj\n"
        b"4 0 obj << /Length 300 >>\n"
        b"stream\n"
        b"BT\n"
        b"/F1 12 Tf\n"
        b"100 700 Td\n"
        b"(Attention Is All You Need) Tj\n"
        b"0 -20 Td\n"
        b"(Ashish Vaswani, Noam Shazeer, Niki Parmar) Tj\n"
        b"0 -20 Td\n"
        b"(Abstract: The Transformer model architecture eschews recurrence and relies entirely on an attention "
        b"mechanism to draw global dependencies between input and output.) Tj\n"
        b"0 -20 Td\n"
        b"(1. Introduction: Recurrent neural networks suffer from sequential computation bottlenecks that prevent "
        b"parallelization during training.) Tj\n"
        b"0 -20 Td\n"
        b"(2. Attention: Multi-head attention allows the model to jointly attend to information from different "
        b"representation subspaces at different positions.) Tj\n"
        b"0 -20 Td\n"
        b"(3. Results: On the WMT 2014 English-to-German translation task, the big transformer model achieves "
        b"state-of-the-art BLEU score of 28.4.) Tj\n"
        b"0 -20 Td\n"
        b"(Table 1: Training cost and BLEU benchmarks on translation datasets.) Tj\n"
        b"0 -20 Td\n"
        b"(Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V) Tj\n"
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
        b"550\n"
        b"%%EOF\n"
    )


def create_bert_paper_pdf() -> bytes:
    return (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >> endobj\n"
        b"4 0 obj << /Length 260 >>\n"
        b"stream\n"
        b"BT\n"
        b"/F1 12 Tf\n"
        b"100 700 Td\n"
        b"(BERT: Pre-training of Deep Bidirectional Transformers) Tj\n"
        b"0 -20 Td\n"
        b"(Jacob Devlin, Ming-Wei Chang, Kenton Lee) Tj\n"
        b"0 -20 Td\n"
        b"(Abstract: BERT is designed to pre-train deep bidirectional representations from unlabeled text by "
        b"jointly conditioning on both left and right context in all layers.) Tj\n"
        b"0 -20 Td\n"
        b"(1. Introduction: Language model pre-training improves many natural language processing tasks.) Tj\n"
        b"0 -20 Td\n"
        b"(2. Methodology: Masked language modeling allows bidirectional pre-training.) Tj\n"
        b"0 -20 Td\n"
        b"(3. Results: BERT advances state-of-the-art on eleven NLP benchmarks including GLUE score of 80.5.) Tj\n"
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
        b"500\n"
        b"%%EOF\n"
    )


def setup_user_and_project(client):
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "researcher@nlp.edu",
            "password": "SecureNLP_Password123",
            "name": "NLP Researcher",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "Transformer & LLM Foundations"}, headers=headers
    ).json()
    project_id = proj["id"]
    return headers, project_id


def test_rag_pipeline_chunking_and_indexing(client):
    headers, project_id = setup_user_and_project(client)

    # 1. Upload Paper 1 (Transformer)
    res_upload1 = client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={
            "file": (
                "vaswani2017_transformer.pdf",
                io.BytesIO(create_transformer_paper_pdf()),
                "application/pdf",
            )
        },
        headers=headers,
    )
    assert res_upload1.status_code == 201
    paper1 = res_upload1.json()
    paper1_id = paper1["id"]

    # 2. Verify chunks were generated automatically upon upload (§32, §41) via the
    # status endpoint (the raw chunk dump endpoint was removed)
    status_res = client.get(f"/api/v1/papers/{paper1_id}/status", headers=headers)
    assert status_res.status_code == 200
    assert status_res.json()["chunks_count"] >= 3

    # 3. Test Re-indexing endpoint
    reindex_res = client.post(f"/api/v1/papers/{paper1_id}/index", headers=headers)
    assert reindex_res.status_code == 200
    assert reindex_res.json()["paper_id"] == paper1_id
    assert reindex_res.json()["indexed_chunks"] >= 3


def test_rag_hybrid_search(client):
    headers, project_id = setup_user_and_project(client)

    # Upload papers
    res1 = client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={
            "file": (
                "transformer.pdf",
                io.BytesIO(create_transformer_paper_pdf()),
                "application/pdf",
            )
        },
        headers=headers,
    ).json()

    res2 = client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={"file": ("bert.pdf", io.BytesIO(create_bert_paper_pdf()), "application/pdf")},
        headers=headers,
    ).json()

    # Search for multi-head attention (should rank Transformer higher)
    search_res = client.post(
        f"/api/v1/projects/{project_id}/rag/search",
        json={"query": "multi-head attention mechanism", "limit": 3},
        headers=headers,
    )
    assert search_res.status_code == 200
    data = search_res.json()
    assert data["total_results"] >= 1
    top_passage = data["passages"][0]
    assert top_passage["paper_id"] == res1["id"]
    assert "attention" in top_passage["passage_text"].lower()

    # Search with paper_id filter (Document mode)
    doc_search = client.post(
        f"/api/v1/projects/{project_id}/rag/search",
        json={"query": "bidirectional representations", "paper_id": res2["id"]},
        headers=headers,
    )
    assert doc_search.status_code == 200
    doc_data = doc_search.json()
    assert doc_data["total_results"] >= 1
    assert doc_data["passages"][0]["paper_id"] == res2["id"]


def test_ai_research_chat_modes_and_hallucination_rules(client):
    headers, project_id = setup_user_and_project(client)

    # Upload papers
    paper1 = client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={
            "file": (
                "transformer.pdf",
                io.BytesIO(create_transformer_paper_pdf()),
                "application/pdf",
            )
        },
        headers=headers,
    ).json()

    paper2 = client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={"file": ("bert.pdf", io.BytesIO(create_bert_paper_pdf()), "application/pdf")},
        headers=headers,
    ).json()

    # --- Mode 1: Document Mode ---
    chat_doc = client.post(
        f"/api/v1/projects/{project_id}/chat",
        json={
            "mode": "document",
            "paper_id": paper1["id"],
            "message": "What is the primary motivation for the Transformer architecture?",
        },
        headers=headers,
    )
    assert chat_doc.status_code == 200
    doc_resp = chat_doc.json()
    assert doc_resp["mode"] == "document"
    assert doc_resp["grounding_state"] == "source-grounded"
    assert len(doc_resp["sources"]) >= 1
    assert doc_resp["sources"][0]["paper_id"] == paper1["id"]
    assert doc_resp["insufficient_evidence"] is False
    assert "[1]" in doc_resp["answer"]
    assert doc_resp["trust_legend"]["source_grounded_count"] >= 1

    # --- Mode 2: Library Mode (Selected Papers) ---
    chat_lib = client.post(
        f"/api/v1/projects/{project_id}/chat",
        json={
            "mode": "library",
            "paper_ids": [paper1["id"], paper2["id"]],
            "message": "Compare the evaluation results of these architectures on benchmarks.",
        },
        headers=headers,
    )
    assert chat_lib.status_code == 200
    lib_resp = chat_lib.json()
    assert lib_resp["mode"] == "library"
    assert len(lib_resp["sources"]) >= 1

    # --- Mode 3: Project Mode ---
    chat_proj = client.post(
        f"/api/v1/projects/{project_id}/chat",
        json={"mode": "project", "message": "How does attention mechanism overcome recurrence?"},
        headers=headers,
    )
    assert chat_proj.status_code == 200
    proj_resp = chat_proj.json()
    assert proj_resp["mode"] == "project"
    assert len(proj_resp["sources"]) >= 1
    assert proj_resp["insufficient_evidence"] is False

    # --- Mode 4: General Mode (Ungrounded) ---
    chat_gen = client.post(
        f"/api/v1/projects/{project_id}/chat",
        json={
            "mode": "general",
            "message": "Explain what gradient descent is in machine learning.",
        },
        headers=headers,
    )
    assert chat_gen.status_code == 200
    gen_resp = chat_gen.json()
    assert gen_resp["mode"] == "general"
    assert gen_resp["grounding_state"] == "general-knowledge"
    assert len(gen_resp["sources"]) == 0
    assert gen_resp["trust_legend"]["general_knowledge_count"] >= 1
    assert "not grounded in your research library" in gen_resp["answer"].lower()

    # --- Rule 3 (§33): Insufficient evidence fallback on ungrounded/irrelevant query ---
    chat_no_evidence = client.post(
        f"/api/v1/projects/{project_id}/chat",
        json={
            "mode": "project",
            "message": "What is the CRISPR-Cas9 genetic editing efficiency in maize plants?",
        },
        headers=headers,
    )
    assert chat_no_evidence.status_code == 200
    no_ev_resp = chat_no_evidence.json()
    assert no_ev_resp["insufficient_evidence"] is True
    assert "Insufficient evidence found in your sources." in no_ev_resp["answer"]
    assert len(no_ev_resp["sources"]) == 0

    # --- Rule 5 (§33): Allow users to inspect evidence ---
    # Sources list contains full details: page, section, passage_text, confidence
    for src in doc_resp["sources"]:
        assert "paper_title" in src
        assert "authors" in src
        assert "page_number" in src
        assert "section" in src
        assert "passage_text" in src
        assert "confidence" in src
        assert src["confidence"] > 0
