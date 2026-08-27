from app.models.paper import Paper


def test_research_graphs_and_paper_discovery(client, db):
    # 1. Setup User and Project
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": "shannon@bell.labs",
            "password": "InformationTheory123",
            "name": "Claude Shannon",
        },
    )
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj_resp = client.post(
        "/api/v1/projects", json={"name": "Information Theory & Entropy"}, headers=headers
    )
    project_id = proj_resp.json()["id"]

    # 2. Add Papers with Authors and Abstracts to Database
    p1 = Paper(
        project_id=project_id,
        title="A Mathematical Theory of Communication",
        authors=[{"name": "Claude E. Shannon"}, {"name": "Warren Weaver"}],
        abstract="A foundational framework analyzing channel capacity, signal noise, and entropy.",
        doi="10.1002/j.1538-7305.1948.tb01338.x",
        year=1948,
        extraction_status="ok",
        metadata_json={
            "references": [
                {
                    "title": "The Mathematical Theory of Communication",
                    "doi": "10.1002/j.1538-7305.1948.tb01338.x",
                }
            ]
        },
    )
    p2 = Paper(
        project_id=project_id,
        title="Elements of Information Theory and Signal Encoding",
        authors=[{"name": "Thomas M. Cover"}, {"name": "Joy A. Thomas"}],
        abstract=(
            "Modern comprehensive synthesis of entropy, mutual information, rate distortion, and channel coding "
            "theorem."
        ),
        doi="10.1002/047174882X",
        year=2006,
        extraction_status="ok",
        metadata_json={"references": []},
    )
    p3 = Paper(
        project_id=project_id,
        title="Quantum Information Theory and Entropy Bounds",
        authors=[{"name": "Michael A. Nielsen"}, {"name": "Isaac L. Chuang"}],
        abstract="Quantum computational frameworks, von Neumann entropy, and quantum communication capacity.",
        doi="10.1017/CBO9780511976667",
        year=2010,
        extraction_status="ok",
        metadata_json={"references": []},
    )
    db.add_all([p1, p2, p3])
    db.commit()

    # 3. Test Research Graph Endpoint (Roadmap 9.3)
    graph_resp = client.get(f"/api/v1/projects/{project_id}/research-graph", headers=headers)
    assert graph_resp.status_code == 200
    graph = graph_resp.json()

    assert graph["total_papers"] == 3
    assert graph["total_authors"] >= 4
    assert graph["total_topics"] > 0
    assert len(graph["nodes"]) > 0
    assert len(graph["edges"]) > 0
    assert len(graph["clusters"]) > 0
    assert len(graph["bridge_papers"]) > 0

    # Verify node types exist
    node_types = {n["type"] for n in graph["nodes"]}
    assert "paper" in node_types
    assert "author" in node_types
    assert "topic" in node_types

    # 4. Test Paper Discovery Recommendations (Roadmap 9.3) — live Crossref lookup,
    # mocked here for hermeticity; results must map real API fields and dedupe the library.
    from unittest.mock import AsyncMock, patch

    class _FakeResp:
        status_code = 200

        @staticmethod
        def json():
            return {
                "message": {
                    "items": [
                        {
                            "DOI": "10.1109/5.726791",
                            "title": ["A Universal Theory of Information and Coding"],
                            "author": [{"family": "Cover", "given": "Thomas M."}],
                            "issued": {"date-parts": [[1999]]},
                            "abstract": "<p>Coding theorems for general information measures.</p>",
                            "is-referenced-by-count": 900,
                        },
                        # Duplicate of an existing library paper — must be filtered out
                        {
                            "DOI": "10.1002/j.1538-7305.1948.tb01338.x",
                            "title": ["A Mathematical Theory of Communication"],
                            "author": [{"family": "Shannon", "given": "Claude E."}],
                            "issued": {"date-parts": [[1948]]},
                            "is-referenced-by-count": 120000,
                        },
                    ]
                }
            }

    class _FakeClient:
        def __init__(self):
            self.get = AsyncMock(return_value=_FakeResp())

    fake_client = _FakeClient()
    with patch("app.services.graph_service.get_async_http_client", return_value=fake_client):
        disc_resp = client.get(f"/api/v1/projects/{project_id}/discover-related", headers=headers)
    assert disc_resp.status_code == 200
    recommendations = disc_resp.json()

    assert len(recommendations) == 1
    first_rec = recommendations[0]
    assert first_rec["title"] == "A Universal Theory of Information and Coding"
    assert first_rec["doi"] == "10.1109/5.726791"
    assert first_rec["year"] == 1999
    assert first_rec["authors"] == ["Cover, Thomas M."]
    assert first_rec["relevance_score"] is None  # no fabricated relevance scores
    assert "Crossref" in first_rec["reason"]
    assert len(first_rec["source_topics"]) > 0

    # The Crossref query must have been built from the project's dominant topics
    called_url = fake_client.get.call_args.args[0]
    assert "api.crossref.org/works" in called_url
