from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.api.v1.endpoints import citations as citations_endpoints

_RESOLVED_VASWANI = {
    "identifier": "10.48550/arXiv.1706.03762",
    "id_type": "doi",
    "title": "Attention Is All You Need",
    "authors": [{"familyName": "Vaswani", "givenName": "Ashish"}],
    "year": 2017,
    "abstract": "The dominant sequence transduction models are based on attention mechanisms.",
    "doi": "10.48550/arXiv.1706.03762",
    "arxiv_id": None,
    "pmid": None,
    "journal": "NeurIPS",
    "publisher": None,
    "volume": None,
    "issue": None,
    "pages": None,
    "url": None,
    "extraction_status": "ok",
}


def test_citation_crud_and_lifecycle(client: TestClient):
    # 1. Register user and create project & document
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "researcher5@openresearch.org",
            "password": "SecurePassword123",
            "name": "Dr. Citations",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "Citation Systems Project"}, headers=headers
    ).json()
    proj_id = proj["id"]

    doc = client.post(
        "/api/v1/documents",
        json={"project_id": proj_id, "title": "Academic Traceability Draft"},
        headers=headers,
    ).json()
    doc_id = doc["id"]

    # 2. Unresolvable identifiers must not create junk library records
    with patch.object(
        citations_endpoints.identifier_resolver,
        "resolve",
        new=AsyncMock(
            return_value=citations_endpoints.identifier_resolver._unresolved(
                "10.5555/nope", "doi", None
            )
        ),
    ):
        unresolved_res = client.post(
            f"/api/v1/projects/{proj_id}/papers/add-by-identifier",
            json={"project_id": proj_id, "identifier": "10.5555/nope", "id_type": "doi"},
            headers=headers,
        )
    assert unresolved_res.status_code == 422

    # Add a paper by identifier (resolver mocked for hermeticity)
    with patch.object(
        citations_endpoints.identifier_resolver,
        "resolve",
        new=AsyncMock(return_value=_RESOLVED_VASWANI),
    ):
        paper_res = client.post(
            f"/api/v1/projects/{proj_id}/papers/add-by-identifier",
            json={
                "project_id": proj_id,
                "identifier": "10.48550/arXiv.1706.03762",
                "id_type": "doi",
            },
            headers=headers,
        )
    assert paper_res.status_code == 201
    paper = paper_res.json()
    paper_id = paper["id"]
    assert paper["title"] == "Attention Is All You Need"

    # 3. Create Citation
    create_cit = client.post(
        f"/api/v1/documents/{doc_id}/citations",
        json={
            "document_id": doc_id,
            "paper_id": paper_id,
            "position": 1,
            "citation_style": "apa",
            "attribution_scope": "clause",
            "page_number": 3,
            "relevant_passage": "Multi-head attention mechanism...",
        },
        headers=headers,
    )
    assert create_cit.status_code == 201
    cit_data = create_cit.json()
    assert cit_data["paper_id"] == paper_id
    assert cit_data["attribution_scope"] == "clause"
    cit_id = cit_data["id"]

    # 4. List Citations
    list_res = client.get(f"/api/v1/documents/{doc_id}/citations", headers=headers)
    assert list_res.status_code == 200
    cits = list_res.json()
    assert len(cits) == 1
    assert cits[0]["id"] == cit_id

    # 5. Delete Citation
    del_res = client.delete(f"/api/v1/documents/{doc_id}/citations/{cit_id}", headers=headers)
    assert del_res.status_code == 204

    # 6. Verify Deletion
    list_after = client.get(f"/api/v1/documents/{doc_id}/citations", headers=headers).json()
    assert len(list_after) == 0


def test_identifier_resolution_endpoints(client: TestClient):
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "resolver@openresearch.org",
            "password": "SecurePassword123",
            "name": "Resolver Test",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Resolve DOI
    doi_res = client.post(
        "/api/v1/citations/resolve-identifier",
        headers=headers,
        json={"identifier": "10.48550/arXiv.1706.03762", "id_type": "doi"},
    )
    assert doi_res.status_code == 200
    data = doi_res.json()
    assert "title" in data
    assert "authors" in data
    assert data["id_type"] == "doi"

    # Resolve arXiv ID
    arxiv_res = client.post(
        "/api/v1/citations/resolve-identifier",
        headers=headers,
        json={"identifier": "1706.03762", "id_type": "arxiv"},
    )
    assert arxiv_res.status_code == 200
    data_arxiv = arxiv_res.json()
    assert data_arxiv["arxiv_id"] == "1706.03762"


def test_bibtex_import_export_endpoints(client: TestClient):
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "bibtex@openresearch.org",
            "password": "SecurePassword123",
            "name": "BibTeX Expert",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "BibTeX Sync Project"}, headers=headers
    ).json()
    proj_id = proj["id"]

    sample_bibtex = """
@article{devlin2018bert,
  title = {BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  author = {Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina},
  journal = {arXiv preprint arXiv:1810.04805},
  year = {2018},
  doi = {10.48550/arXiv.1810.04805}
}
@inproceedings{radford2019language,
  title = {Language Models are Unsupervised Multitask Learners},
  author = {Radford, Alec and Wu, Jeffrey and Child, Rewon},
  year = {2019}
}
"""

    # 1. Import BibTeX
    imp_res = client.post(
        f"/api/v1/projects/{proj_id}/papers/import-bibtex",
        headers=headers,
        json={"project_id": proj_id, "bibtex_content": sample_bibtex},
    )
    assert imp_res.status_code == 201
    imp_data = imp_res.json()
    assert imp_data["total_imported"] == 2
    paper_ids = [p["id"] for p in imp_data["papers"]]

    # 2. Export Project BibTeX
    exp_res = client.get(f"/api/v1/projects/{proj_id}/export/bibtex", headers=headers)
    assert exp_res.status_code == 200
    exp_data = exp_res.json()
    assert exp_data["total_entries"] == 2
    assert "@article" in exp_data["bibtex_content"]

    # 3. Create a document, cite one paper, and test document export
    doc = client.post(
        "/api/v1/documents", json={"project_id": proj_id, "title": "Survey Paper"}, headers=headers
    ).json()

    client.post(
        f"/api/v1/documents/{doc['id']}/citations",
        json={
            "document_id": doc["id"],
            "paper_id": paper_ids[0],
            "position": 1,
            "citation_style": "ieee",
        },
        headers=headers,
    )

    doc_exp = client.get(f"/api/v1/documents/{doc['id']}/export/bibtex", headers=headers)
    assert doc_exp.status_code == 200
    assert doc_exp.json()["total_entries"] == 1


def test_context_ranking_endpoint(client: TestClient):
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "ranking@openresearch.org",
            "password": "SecurePassword123",
            "name": "Rank Tester",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj = client.post("/api/v1/projects", json={"name": "Ranking Project"}, headers=headers).json()

    doc = client.post(
        "/api/v1/documents",
        json={"project_id": proj["id"], "title": "Ranking Doc"},
        headers=headers,
    ).json()

    with patch.object(
        citations_endpoints.identifier_resolver,
        "resolve",
        new=AsyncMock(return_value=_RESOLVED_VASWANI),
    ):
        client.post(
            f"/api/v1/projects/{proj['id']}/papers/add-by-identifier",
            json={
                "project_id": proj["id"],
                "identifier": "10.48550/arXiv.1706.03762",
                "id_type": "doi",
            },
            headers=headers,
        )

    rank_res = client.post(
        f"/api/v1/documents/{doc['id']}/citations/rank-context",
        headers=headers,
        json={
            "document_id": doc["id"],
            "paragraph_text": "Neural network transformer architectures with attention mechanisms.",
            "query": "Paper",
        },
    )
    assert rank_res.status_code == 200
    data = rank_res.json()
    assert len(data["results"]) >= 1
    assert data["results"][0]["score"] > 0

    # Also test context-only ranking (no query)
    rank_no_q = client.post(
        f"/api/v1/documents/{doc['id']}/citations/rank-context",
        headers=headers,
        json={
            "document_id": doc["id"],
            "paragraph_text": "Retrieved via OpenResearch metadata resolver for academic studies.",
        },
    )
    assert rank_no_q.status_code == 200
    assert len(rank_no_q.json()["results"]) >= 1
