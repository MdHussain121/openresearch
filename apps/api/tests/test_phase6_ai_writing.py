import io


def create_sample_paper_pdf() -> bytes:
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
        b"(FlashAttention: Fast and Memory-Efficient Exact Attention) Tj\n"
        b"0 -20 Td\n"
        b"(Tri Dao, Daniel Y. Fu, Stefano Ermon) Tj\n"
        b"0 -20 Td\n"
        b"(Abstract: Scaling Transformers to longer sequence lengths requires optimizing memory access overhead "
        b"in self-attention mechanisms.) Tj\n"
        b"0 -20 Td\n"
        b"(1. Introduction: Standard self-attention incurs quadratic memory complexity with respect to sequence "
        b"length.) Tj\n"
        b"0 -20 Td\n"
        b"(2. Methodology: Tiling and recomputation reduce IO overhead between GPU HBM and SRAM.) Tj\n"
        b"0 -20 Td\n"
        b"(3. Results: FlashAttention yields 2-4x speedups across standard GPT-2 and BERT training runs.) Tj\n"
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
            "email": "author@research.org",
            "password": "Secure_Academic_Pass123",
            "name": "Dr. Alex Wright",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj = client.post(
        "/api/v1/projects",
        json={"name": "Efficient Attention & Memory Optimization"},
        headers=headers,
    ).json()
    project_id = proj["id"]
    return headers, project_id


def test_ai_autocomplete_two_tier_strategy(client):
    headers, project_id = setup_user_and_project(client)

    # Upload and index a research paper
    res_upload = client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={
            "file": (
                "flash_attention.pdf",
                io.BytesIO(create_sample_paper_pdf()),
                "application/pdf",
            )
        },
        headers=headers,
    )
    assert res_upload.status_code == 201
    paper_id = res_upload.json()["id"]

    # 1. Tier 1: Inline Ghost Text (<300ms budget, debounced on pause)
    # Without any configured provider the endpoint must fail honestly.
    ghost_res = client.post(
        f"/api/v1/projects/{project_id}/ai/autocomplete",
        json={
            "prefix_text": "Transformer self-attention mechanisms suffer from",
            "paragraph_context": "When scaling model architectures, transformer self-attention mechanisms suffer from",
            "section_heading": "Introduction",
            "mode": "ghost",
            "paper_ids": [paper_id],
        },
        headers=headers,
    )
    assert ghost_res.status_code == 503
    assert "AI provider" in ghost_res.json()["error"]["message"]

    # With a provider reachable, ghost completions are real LLM output
    from unittest.mock import patch as _patch

    with _patch(
        "app.api.v1.endpoints.ai_writing.ai_writing_service._llm_complete",
        return_value="quadratic memory bottlenecks during training.",
    ):
        ghost_ok = client.post(
            f"/api/v1/projects/{project_id}/ai/autocomplete",
            json={
                "prefix_text": "Transformer self-attention mechanisms suffer from",
                "section_heading": "Introduction",
                "mode": "ghost",
                "paper_ids": [paper_id],
            },
            headers=headers,
        )
    assert ghost_ok.status_code == 200
    ghost_data = ghost_ok.json()
    assert ghost_data["mode"] == "ghost"
    assert "quadratic memory bottlenecks" in ghost_data["text"]
    assert isinstance(ghost_data["latency_ms"], int)
    assert ghost_data["grounding_state"] in ["source-grounded", "general-knowledge"]

    # 2. Tier 2: Paragraph Continuation (Ctrl+/) — also provider-gated
    from unittest.mock import patch as _patch

    with _patch(
        "app.api.v1.endpoints.ai_writing.ai_writing_service._llm_complete",
        return_value=(
            "We address this by introducing an IO-aware tiling strategy that reduces "
            "memory traffic while preserving exact attention semantics across long sequences."
        ),
    ):
        cont_res = client.post(
            f"/api/v1/projects/{project_id}/ai/autocomplete",
            json={
                "prefix_text": "To mitigate GPU memory bottlenecks in quadratic attention,",
                "paragraph_context": "To mitigate GPU memory bottlenecks in quadratic attention,",
                "section_heading": "Methodology",
                "mode": "continuation",
                "paper_ids": [paper_id],
            },
            headers=headers,
        )
    assert cont_res.status_code == 200
    cont_data = cont_res.json()
    assert cont_data["mode"] == "continuation"
    assert len(cont_data["text"]) > 40


def test_ai_editing_nine_actions_reversible_flow(client):
    headers, project_id = setup_user_and_project(client)

    sample_sentence = (
        "we think this model looks like a big step for speed in order to utilize less memory."
    )

    actions = [
        "clarity",
        "academic",
        "simplify",
        "shorten",
        "expand",
        "grammar",
        "flow",
        "translate",
        "explain",
    ]
    llm_only_actions = {"expand", "translate", "explain"}

    for action in actions:
        payload = {
            "text": sample_sentence,
            "action": action,
            "target_language": "French" if action == "translate" else "English",
        }
        res = client.post(f"/api/v1/projects/{project_id}/ai/edit", json=payload, headers=headers)

        if action in llm_only_actions:
            # LLM-only actions must fail honestly when no provider is configured
            assert res.status_code == 503, f"{action} should require a provider"
            assert "AI provider" in res.json()["error"]["message"]
            continue

        assert res.status_code == 200
        data = res.json()

        # Reversible flow verification:
        # Original text is preserved, suggested text provided with honest provenance
        assert data["original_text"] == sample_sentence
        assert len(data["suggested_text"]) > 0
        assert data["suggested_text"] != ""
        assert data["action"] == action
        assert data["explanation"].startswith("[Rule-based]")
        assert data["changes_summary"] is not None
        assert "latency_ms" in data


def test_ai_outline_generator_structure_and_grounding(client):
    headers, project_id = setup_user_and_project(client)

    # Upload paper to ground outline
    client.post(
        f"/api/v1/projects/{project_id}/papers/upload",
        files={
            "file": (
                "flash_attention.pdf",
                io.BytesIO(create_sample_paper_pdf()),
                "application/pdf",
            )
        },
        headers=headers,
    )

    outline_res = client.post(
        f"/api/v1/projects/{project_id}/ai/outline",
        json={
            "topic": "Fast Exact Attention Algorithms in Large Language Models",
            "research_question": "How can hardware-aware tiling minimize memory bandwidth bottlenecks in LLM training?",
            "target_sections_count": 7,
        },
        headers=headers,
    )
    assert outline_res.status_code == 200
    outline_data = outline_res.json()

    assert outline_data["topic"] == "Fast Exact Attention Algorithms in Large Language Models"
    assert "hardware-aware" in outline_data["research_question"]
    assert len(outline_data["sections"]) >= 5
    assert outline_data["estimated_word_count"] > 2000

    # Verify structured section fields
    for section in outline_data["sections"]:
        assert "id" in section
        assert "title" in section
        assert "level" in section
        assert "description" in section
        assert "key_points" in section
        assert len(section["key_points"]) >= 2

    # Check that literature grounding sources were attached
    assert len(outline_data["sources"]) >= 1


def test_ai_writing_permissions_and_auth(client):
    headers, project_id = setup_user_and_project(client)

    # 1. Request without token runs as local user -> not a member -> 403
    anon_res = client.post(
        f"/api/v1/projects/{project_id}/ai/autocomplete", json={"prefix_text": "testing unauth"}
    )
    assert anon_res.status_code == 403

    # 2. Forbidden request from another user
    other_user = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other_author@domain.com",
            "password": "Other_Password_Secure123",
            "name": "Dr. Other",
        },
    ).json()
    other_headers = {"Authorization": f"Bearer {other_user['access_token']}"}

    forbidden_res = client.post(
        f"/api/v1/projects/{project_id}/ai/autocomplete",
        json={"prefix_text": "testing forbidden"},
        headers=other_headers,
    )
    assert forbidden_res.status_code == 403


def test_ai_autocomplete_llm_available_returns_response_model(client):
    """Regression: when the local LLM is reachable, all AI routes must still return
    AutocompleteResponse envelopes (not raw tuples) and valid SSE frames."""
    from unittest.mock import patch

    headers, project_id = setup_user_and_project(client)

    with patch(
        "app.services.ai_writing_service.llm_service.generate",
        return_value="quantized attention kernels reduce memory pressure",
    ):
        ghost_res = client.post(
            f"/api/v1/projects/{project_id}/ai/autocomplete",
            json={"prefix_text": "Transformer self-attention mechanisms suffer from"},
            headers=headers,
        )
    assert ghost_res.status_code == 200, ghost_res.text
    body = ghost_res.json()
    assert body["text"] == " quantized attention kernels reduce memory pressure"
    assert body["mode"] == "ghost"
    assert body["grounding_state"] in {"general-knowledge", "source-grounded"}
    assert isinstance(body["latency_ms"], int)

    with patch(
        "app.services.ai_writing_service.llm_service.generate",
        return_value="Continuation sentence one. Sentence two adds analytical depth. Sentence three concludes.",
    ):
        cont_res = client.post(
            f"/api/v1/projects/{project_id}/ai/autocomplete",
            json={
                "prefix_text": "We evaluate the proposed method",
                "paragraph_context": "We evaluate the proposed method against strong baselines.",
                "mode": "continuation",
            },
            headers=headers,
        )
    assert cont_res.status_code == 200, cont_res.text
    assert cont_res.json()["text"].startswith("Continuation sentence one.")

    with patch(
        "app.services.ai_writing_service.llm_service.generate",
        return_value="streamed completion text",
    ):
        sse_res = client.post(
            f"/api/v1/projects/{project_id}/ai/stream-autocomplete",
            json={"prefix_text": "The results indicate that"},
            headers=headers,
        )
    assert sse_res.status_code == 200, sse_res.text
    assert "streamed completion text" in sse_res.text
    assert '"done": true' in sse_res.text


def test_ai_writing_endpoint_guards(client):
    """Cover 404 (missing project) and 403 (outsider) guards on the AI
    writing endpoints plus the ValueError mapping branch."""
    from fastapi import HTTPException

    from app.api.v1.endpoints.ai_writing import _map_ai_errors

    headers, _ = setup_user_and_project(client)
    out_reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "outsider_writing@research.org",
            "password": "Secure_Academic_Pass123",
            "name": "Out Sider",
        },
    ).json()
    out_headers = {"Authorization": f"Bearer {out_reg['access_token']}"}
    owner_res = client.get("/api/v1/projects", headers=headers).json()
    real_project_id = (
        owner_res[0]["id"] if isinstance(owner_res, list) else owner_res["projects"][0]["id"]
    )

    # Missing project -> 404 for every AI endpoint
    assert (
        client.post(
            "/api/v1/projects/no_such_project/ai/autocomplete",
            json={"prefix_text": "abc"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/projects/no_such_project/ai/stream-autocomplete",
            json={"prefix_text": "abc"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/projects/no_such_project/ai/edit",
            json={"text": "abc", "action": "clarify"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/projects/no_such_project/ai/outline",
            json={"topic": "abc"},
            headers=headers,
        ).status_code
        == 404
    )

    # Outsider -> 403
    assert (
        client.post(
            f"/api/v1/projects/{real_project_id}/ai/stream-autocomplete",
            json={"prefix_text": "abc"},
            headers=out_headers,
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/projects/{real_project_id}/ai/edit",
            json={"text": "abc", "action": "clarify"},
            headers=out_headers,
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/projects/{real_project_id}/ai/outline",
            json={"topic": "abc"},
            headers=out_headers,
        ).status_code
        == 403
    )

    # Plain ValueError maps to 400, provider unavailability to 503
    err_value = _map_ai_errors(ValueError("bad input"))
    assert isinstance(err_value, HTTPException) and err_value.status_code == 400
