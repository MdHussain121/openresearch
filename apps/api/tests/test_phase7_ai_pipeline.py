import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.paper import Paper


def setup_user_and_project(client: TestClient):
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "ai_pipeline_tester@openresearch.org",
            "password": "Secure_Academic_Pass123",
            "name": "Dr. Alan Turing",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "Computational Intelligence"}, headers=headers
    ).json()
    project_id = proj["id"]
    return headers, project_id


def test_ai_pipeline_autocomplete_and_streaming(client: TestClient):
    """Verify AI autocomplete (ghost text and continuation) and SSE stream responses."""
    headers, project_id = setup_user_and_project(client)

    # 1. Ghost text autocomplete — provider-gated: honest 503 without one,
    # real completion with a mocked provider.
    res = client.post(
        f"/api/v1/projects/{project_id}/ai/autocomplete",
        json={
            "prefix_text": "Neural networks have revolutionized",
            "paragraph_context": "Deep learning architectures have achieved significant milestones.",
            "section_heading": "Introduction",
            "tier": "ghost",
        },
        headers=headers,
    )
    assert res.status_code == 503
    assert "AI provider" in res.json()["error"]["message"]

    from unittest.mock import patch as _patch

    with _patch(
        "app.api.v1.endpoints.ai_writing.ai_writing_service._llm_complete",
        return_value="modern machine learning research across domains.",
    ):
        res_ok = client.post(
            f"/api/v1/projects/{project_id}/ai/autocomplete",
            json={
                "prefix_text": "Neural networks have revolutionized",
                "section_heading": "Introduction",
                "tier": "ghost",
            },
            headers=headers,
        )
    assert res_ok.status_code == 200
    data = res_ok.json()
    assert "text" in data
    assert "grounding_state" in data

    # 2. Paragraph continuation (mocked provider)
    with _patch(
        "app.api.v1.endpoints.ai_writing.ai_writing_service._llm_complete",
        return_value="we benchmark against established baselines using standardized evaluation protocols.",
    ):
        res_cont = client.post(
            f"/api/v1/projects/{project_id}/ai/autocomplete",
            json={
                "prefix_text": "In our experimental setup, we",
                "paragraph_context": "We evaluate on benchmark datasets.",
                "tier": "continuation",
            },
            headers=headers,
        )
    assert res_cont.status_code == 200
    assert len(res_cont.json()["text"]) > 0

    # 3. Streaming autocomplete (mocked provider)
    with _patch(
        "app.api.v1.endpoints.ai_writing.ai_writing_service._llm_complete",
        return_value="scaled self-attention with linear memory footprints.",
    ):
        res_stream = client.post(
            f"/api/v1/projects/{project_id}/ai/stream-autocomplete",
            json={
                "prefix_text": "Transformer architectures utilize",
                "tier": "continuation",
            },
            headers=headers,
        )
    assert res_stream.status_code == 200
    assert "text/event-stream" in res_stream.headers["content-type"]
    assert "data:" in res_stream.text


def test_ai_pipeline_edit_and_outline(client: TestClient):
    """Verify AI inline edits (make academic, simplify, tone) and outline generation."""
    headers, project_id = setup_user_and_project(client)

    # 1. AI Edit: Make academic
    res_edit = client.post(
        f"/api/v1/projects/{project_id}/ai/edit",
        json={
            "text": "This paper shows a lot of good stuff and works really fast.",
            "action": "academic",
        },
        headers=headers,
    )
    assert res_edit.status_code == 200
    edit_data = res_edit.json()
    assert edit_data["action"] == "academic"
    assert "suggested_text" in edit_data
    assert len(edit_data["suggested_text"]) > 0

    # 2. AI Edit: Expand — LLM-only action fails honestly without a provider
    res_expand = client.post(
        f"/api/v1/projects/{project_id}/ai/edit",
        json={
            "text": "We propose a novel framework.",
            "action": "expand",
        },
        headers=headers,
    )
    assert res_expand.status_code == 503
    assert "AI provider" in res_expand.json()["error"]["message"]

    # 3. AI Outline generation
    res_outline = client.post(
        f"/api/v1/projects/{project_id}/ai/outline",
        json={
            "topic": "Reinforcement Learning in Robotics",
            "target_sections_count": 5,
        },
        headers=headers,
    )
    assert res_outline.status_code == 200
    outline_data = res_outline.json()
    assert outline_data["topic"] == "Reinforcement Learning in Robotics"
    assert len(outline_data["sections"]) >= 3


def test_ai_intelligence_workflow(client: TestClient, db: Session):
    """Verify full intelligence review and matrix generation pipeline."""
    headers, project_id = setup_user_and_project(client)

    # Add a paper to the project
    paper = Paper(
        id=str(uuid.uuid4()),
        project_id=project_id,
        title="Attention Is All You Need",
        abstract=(
            "The dominant sequence transduction models are based on complex recurrent or convolutional neural "
            "networks. We propose the Transformer, based solely on attention mechanisms."
        ),
        year=2017,
        doi="10.5555/3295222.3295349",
        authors=[{"familyName": "Vaswani", "givenName": "Ashish"}],
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)
    paper_id = paper.id

    # 1. Verify claims
    claim_res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/verify-claims",
        json={
            "text": "Self-attention replaces recurrence entirely and cuts training time by 40%.",
        },
        headers=headers,
    )
    assert claim_res.status_code == 200

    # 2. Research Gaps
    gap_res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/research-gaps",
        json={},
        headers=headers,
    )
    assert gap_res.status_code == 200
    assert "potential_gaps" in gap_res.json()

    # 3. Literature Matrix
    matrix_res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/literature-matrix",
        json={"paper_ids": [paper_id]},
        headers=headers,
    )
    assert matrix_res.status_code == 200
    assert "markdown_table" in matrix_res.json()

    # 4. Paper Review
    review_res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/paper-review",
        json={
            "text": "In this paper we present our methodology. We obviously achieve flawless results.",
        },
        headers=headers,
    )
    assert review_res.status_code == 200
    review_data = review_res.json()
    assert "categories" in review_data
    assert "writing" in review_data["categories"]
    assert "argumentation" in review_data["categories"]
