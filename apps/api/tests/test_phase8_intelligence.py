import json

from fastapi.testclient import TestClient

from app.models.chunk import PaperChunk
from app.models.document import Document
from app.models.paper import Paper


def setup_user_and_project(client: TestClient):
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "intel_researcher@openresearch.org",
            "password": "Secure_Academic_Pass123",
            "name": "Dr. Sarah Chen",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "Neural Architecture Efficiency"}, headers=headers
    ).json()
    project_id = proj["id"]
    return headers, project_id


def test_claim_verification_mechanical_detection(client: TestClient):
    """
    Test 8.1: Claim Verification (Roadmap 8.1)
    Verifies mechanical zero-citation detection and per-sentence dismiss flow.
    Confidence score must be explicitly marked as deferred.
    """
    headers, project_id = setup_user_and_project(client)

    text_with_claims = (
        "Transformer models achieve superior results and reduce training time by 40%. "
        "In contrast, traditional RNNs require sequential step-by-step processing. "
        "We also note that attention mechanisms improve representation capacity."
    )

    res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/verify-claims",
        json={"text": text_with_claims},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["total_claims_analyzed"] >= 2
    assert data["unsupported_claims_count"] >= 2
    assert data["confidence_scoring_status"] == "deferred"
    assert len(data["claims"]) > 0

    first_claim = data["claims"][0]
    assert first_claim["flag_type"] == "no_supporting_citation"
    assert first_claim["message"] == "No supporting citation detected"
    assert len(first_claim["suggested_query"]) > 0
    assert first_claim["is_dismissed"] is False

    # Test dismissing a claim
    dismiss_id = first_claim["claim_id"]
    res_dismissed = client.post(
        f"/api/v1/projects/{project_id}/intelligence/verify-claims",
        json={"text": text_with_claims, "dismissed_claim_ids": [dismiss_id]},
        headers=headers,
    )
    assert res_dismissed.status_code == 200
    dismissed_data = res_dismissed.json()
    assert dismissed_data["dismissed_claims_count"] == 1
    matching = [c for c in dismissed_data["claims"] if c["claim_id"] == dismiss_id]
    assert len(matching) == 1
    assert matching[0]["is_dismissed"] is True


def test_claim_verification_tolerates_unpaired_surrogates(client: TestClient):
    """
    Regression: JSON '\\ud800'-style lone surrogate escapes must not crash UTF-8
    encoding (claim ID hashing / response serialization) with a 500 (Spec §25).
    """
    headers, project_id = setup_user_and_project(client)

    # Raw body: JSON unpaired surrogate escape inside an otherwise normal sentence.
    raw_body = b'{"text":"Transformers improve accuracy \\ud800 on benchmarks."}'
    res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/verify-claims",
        content=raw_body,
        headers={**headers, "Content-Type": "application/json"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["total_claims_analyzed"] == 1
    assert len(data["claims"][0]["claim_id"]) > 0


def test_research_gap_assistant_limitations_and_future_work(client: TestClient, db):
    """
    Test 8.2: Research Gap Assistant (Roadmap 8.2)
    Verifies author-stated limitation extraction, future work synthesis, raw evidence count,
    and deferred confidence scoring.
    """
    headers, project_id = setup_user_and_project(client)

    # Add papers with explicit limitation discussion
    paper1 = Paper(
        id="test-paper-gap-1",
        project_id=project_id,
        title="Attention Is All You Need",
        authors=[{"familyName": "Vaswani", "givenName": "Ashish"}],
        year=2017,
        abstract=(
            "We propose the Transformer. However, we acknowledge limitations regarding quadratic computational "
            "complexity with respect to context sequence length. Future work should investigate memory-efficient "
            "approximations."
        ),
        extraction_status="ok",
    )
    paper2 = Paper(
        id="test-paper-gap-2",
        project_id=project_id,
        title="Deep Residual Learning for Image Recognition",
        authors=[{"familyName": "He", "givenName": "Kaiming"}],
        year=2016,
        abstract=(
            "Deep residual networks are easier to optimize. However, we note limitations regarding computational "
            "overhead and lack of evaluation on out-of-distribution benchmark datasets. Future work should explore "
            "sub-quadratic scaling."
        ),
        extraction_status="ok",
    )
    db.add(paper1)
    db.add(paper2)
    db.commit()

    res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/research-gaps",
        json={"paper_ids": [paper1.id, paper2.id]},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["analyzed_papers_count"] >= 2
    assert data["confidence_scoring_status"] == "deferred"
    assert "Potential research gaps" in data["disclaimer"]
    assert len(data["potential_gaps"]) >= 2

    gap1 = data["potential_gaps"][0]
    assert gap1["category"] in ["dataset", "scalability", "methodology"]
    assert gap1["raw_evidence_count"] >= 1
    assert len(gap1["author_limitations"]) > 0 or len(gap1["future_work_quotes"]) > 0


def test_literature_matrix_structured_synthesis(client: TestClient, db):
    """
    Test 8.3: Literature Review Matrix (Roadmap 8.3)
    Verifies multi-paper structured matrix generation with cell-level source references and Markdown table preview.
    """
    headers, project_id = setup_user_and_project(client)

    paper = Paper(
        id="test-paper-matrix-1",
        project_id=project_id,
        title="Attention Is All You Need",
        authors=[{"familyName": "Vaswani", "givenName": "Ashish"}],
        year=2017,
        doi="10.48550/arXiv.1706.03762",
        abstract="The Transformer is the first transduction model relying entirely on self-attention.",
        extraction_status="ok",
    )
    db.add(paper)
    db.commit()

    # Seed real indexed chunks so matrix cells are extracted from actual text
    db.add_all(
        [
            PaperChunk(
                paper_id=paper.id,
                project_id=project_id,
                page_number=3,
                section="3. Model Architecture",
                paragraph=1,
                content=(
                    "We propose the Transformer, a novel architecture that relies entirely "
                    "on self-attention to compute representations of its input and output."
                ),
            ),
            PaperChunk(
                paper_id=paper.id,
                project_id=project_id,
                page_number=4,
                section="4. Experiments",
                paragraph=1,
                content=(
                    "We evaluate our model on the WMT 2014 English-to-German translation "
                    "benchmark dataset and report results on newstest2014."
                ),
            ),
        ]
    )
    db.commit()

    res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/literature-matrix",
        json={"paper_ids": [paper.id]},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["total_papers"] >= 1
    assert "Method" in data["headers"]
    assert "Dataset" in data["headers"]
    assert "Results" in data["headers"]
    assert "Limitations" in data["headers"]
    assert len(data["rows"]) >= 1

    row = data["rows"][0]
    assert row["paper_id"] == paper.id

    # Method cell must be a real sentence from the seeded chunk with true provenance
    assert "Transformer" in row["method"]["value"]
    assert row["method"]["page_number"] == 3
    assert row["method"]["section"] == "3. Model Architecture"
    assert row["method"]["source_excerpt"] is not None

    # Dataset cell extracted from real text as well
    assert "WMT 2014" in row["dataset"]["value"]
    assert row["dataset"]["page_number"] == 4

    # Cells with no matching evidence are explicitly marked, never fabricated
    assert row["limitations"]["value"] == "Not stated in extracted text"
    assert row["limitations"]["source_excerpt"] is None
    assert "| Paper | Method | Dataset | Results | Limitations |" in data["markdown_table"]


def test_research_paper_review_engine(client: TestClient, db):
    """
    Test 8.4: Research Paper Review Engine (Roadmap 8.4)
    Verifies 5-dimension review: Structure, Citations, Writing, Argumentation, and Sources.
    """
    headers, project_id = setup_user_and_project(client)

    draft_text = (
        "# Introduction\n"
        "Transformer architectures are obviously superior and always eliminate every computational bottleneck. "
        "In our experiments, the proposed formulation improves throughput by 55% across all benchmarks "
        "without any accuracy degradation whatsoever.\n\n"
        "# Methodology\n"
        "We implement an attention mechanism that scales efficiently across multi-GPU distributed clusters "
        "during high-throughput inference workloads."
    )

    doc = Document(
        id="test-doc-review-1",
        project_id=project_id,
        title="Scalable Attention Inference",
        plain_text=draft_text,
        content_json={"type": "doc"},
    )
    db.add(doc)
    db.commit()

    res = client.post(
        f"/api/v1/projects/{project_id}/intelligence/paper-review",
        json={"document_id": doc.id},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["document_id"] == doc.id
    assert 0 <= data["overall_score"] <= 100

    categories = data["categories"]
    assert "structure" in categories
    assert "citations" in categories
    assert "writing" in categories
    assert "argumentation" in categories
    assert "sources" in categories

    assert len(data["issues"]) > 0
    categories_found = {iss["category"] for iss in data["issues"]}
    assert len(categories_found) >= 2


def test_zotero_import_and_sync(client: TestClient, db):
    """
    Test 8.5: Zotero CSL-JSON Import & Web API Sync
    Verifies parsing Zotero CSL JSON and saving directly into project Paper database.
    """
    headers, project_id = setup_user_and_project(client)

    sample_csl_json = [
        {
            "key": "ZT_TEST_01",
            "title": "Language Models are Few-Shot Learners",
            "creators": [
                {"firstName": "Tom", "lastName": "Brown"},
                {"firstName": "Benjamin", "lastName": "Mann"},
            ],
            "date": "2020",
            "DOI": "10.48550/arXiv.2005.14165",
            "publicationTitle": "NeurIPS 2020",
            "abstractNote": (
                "Recent work has demonstrated substantial gains on many NLP tasks by pre-training on a large "
                "corpus of text."
            ),
        }
    ]

    res = client.post(
        f"/api/v1/projects/{project_id}/zotero/import",
        json={"csl_json_content": json.dumps(sample_csl_json)},
        headers=headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert data["total_imported"] == 1
    assert len(data["papers"]) == 1
    assert data["papers"][0]["title"] == "Language Models are Few-Shot Learners"

    # Test simulated API sync endpoint
    sync_res = client.post(
        f"/api/v1/projects/{project_id}/zotero/sync",
        json={"user_id": "123456", "api_key": "sample_secret_key"},
        headers=headers,
    )
    assert sync_res.status_code == 201
    sync_data = sync_res.json()
    assert sync_data["synced_items_count"] >= 0


def test_provider_caching_and_quota_visibility(client: TestClient):
    """
    Test 8.6: Provider Quota & Caching Hardening (Roadmap 8.6)
    Verifies quota monitoring, caching statistics, and authenticated cache clearing.
    """
    headers, _ = setup_user_and_project(client)

    # Anonymous request resolves to the local user and succeeds without login
    res_unauth = client.post("/api/v1/system/provider-cache/clear")
    assert res_unauth.status_code == 200

    res = client.get("/api/v1/system/provider-status", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data["providers"]) >= 3

    crossref_stat = next((p for p in data["providers"] if p["provider_name"] == "Crossref"), None)
    assert crossref_stat is not None
    assert crossref_stat["requests_made"] >= 0
    assert crossref_stat["status"] in ["healthy", "warning", "exceeded"]

    # Clear cache with authentication
    clear_res = client.post("/api/v1/system/provider-cache/clear", headers=headers)
    assert clear_res.status_code == 200
    assert clear_res.json()["status"] == "ok"
