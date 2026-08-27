"""Phase 7 quality-gate tests: closes coverage gaps in RAG chunking, teams,
version history, Zotero dedup, and plugin service branches."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.paper import Paper
from app.models.project import Project
from app.schemas.models import PluginManifest, ZoteroImportRequest
from app.services.plugin_service import PluginService
from app.services.rag_service import EmbeddingService, RAGService
from app.services.zotero_service import ZoteroService

# ---------------------------------------------------------------------------
# Embedding service edge cases (rag_service.py lines 55, 62-64, 76, 83)
# ---------------------------------------------------------------------------


def test_embedding_service_edge_cases():
    # Empty / whitespace-only text returns zero vector
    assert EmbeddingService.generate_embedding("") == [0.0] * 128
    assert EmbeddingService.generate_embedding("   ") == [0.0] * 128

    # Text composed entirely of stop words falls back, then yields a valid vector
    stopword_text = "the of and to a"
    vec = EmbeddingService.generate_embedding(stopword_text)
    assert len(vec) == 128

    # Punctuation-only input has no usable tokens -> zero vector
    assert EmbeddingService.generate_embedding("! ? . ,") == [0.0] * 128

    # Deterministic output & unit length for real text
    v1 = EmbeddingService.generate_embedding("Transformer architectures dominate NLP benchmarks")
    v2 = EmbeddingService.generate_embedding("Transformer architectures dominate NLP benchmarks")
    assert v1 == v2
    norm = sum(x * x for x in v1) ** 0.5
    assert abs(norm - 1.0) < 1e-3

    # cosine similarity guards against mismatched or empty vectors
    assert EmbeddingService.cosine_similarity([], v1) == 0.0
    assert EmbeddingService.cosine_similarity(v1, []) == 0.0
    assert EmbeddingService.cosine_similarity([0.1, 0.2], [0.1, 0.2, 0.3]) == 0.0


# ---------------------------------------------------------------------------
# chunk_paper full pipeline (lines 102-104, 130, 136-191, 221-228, 254-260, 303)
# ---------------------------------------------------------------------------


def _make_paper(project_id: str, extraction_status: str = "ok") -> Paper:
    long_paragraph = (
        "Empirical scaling results demonstrate that language model performance improves "
        "predictably with compute, dataset size, and parameter count across several orders "
        "of magnitude. " * 12
    )  # > 1000 chars to trigger sliding-window sub-chunking
    return Paper(
        id="rag-pipeline-paper",
        project_id=project_id,
        title="Scaling Laws for Neural Language Models",
        authors=[
            {"familyName": "Kaplan", "givenName": "Jared"},
            {"familyName": "McCandlish", "givenName": "Sam"},
        ],
        year=2020,
        abstract="We study empirical scaling laws for language model performance on test loss.",
        metadata_json={
            "sections": [
                {
                    "title": "Introduction",
                    "page_number": 1,
                    "text": "Scaling laws provide a predictive framework.\n\nThis finding guides compute allocation.",
                },
                {"title": "Results", "page_number": 4, "text": long_paragraph},
                {"title": "Empty Section", "page_number": 5, "text": ""},
            ],
            "tables": [
                {
                    "caption": "Table 1: Loss vs Parameters",
                    "page_number": 6,
                    "raw_text": "117M -> 3.10 | 350M -> 2.85",
                },
                {"caption": "Table 2: Empty", "page_number": 7, "raw_text": ""},
            ],
            "equations": [
                {"latex": "L(N) = (N_c/N)^alpha", "page_number": 3, "is_text_searchable": True}
            ],
        },
        extraction_status=extraction_status,
    )


def test_chunk_paper_full_pipeline(db: Session):
    from app.models.chunk import PaperChunk as PaperChunkModel
    from app.services.auth import create_user_with_personal_owner

    user = create_user_with_personal_owner(
        db,
        email="rag_pipeline@openresearch.org",
        name="RAG Pipeline User",
        password="Secure_Password_123",
    )
    project = Project(id="rag-proj-1", owner_id=user.personal_owner_id, name="RAG Pipeline Project")
    db.add(project)

    paper = _make_paper("rag-proj-1")
    db.add(paper)
    db.commit()

    service = RAGService()
    chunks = service.chunk_paper(db, paper)

    sections = [c.section for c in chunks]
    # Abstract chunk created because no section is titled "Abstract"
    assert "Abstract" in sections
    # Regular short paragraph chunks
    assert "Introduction" in sections
    # Long paragraph produced multiple overlapping sub-chunks
    assert sections.count("Results") >= 2
    # Table and equation chunks
    assert "Tables" in sections
    assert "Equations" in sections

    table_chunk = next(c for c in chunks if c.section == "Tables")
    assert table_chunk.metadata_json["is_table"] is True
    assert "Loss vs Parameters" in table_chunk.metadata_json["caption"]

    eq_chunk = next(c for c in chunks if c.section == "Equations")
    assert eq_chunk.metadata_json["is_equation"] is True
    assert "L(N)" in eq_chunk.content

    # Re-indexing replaces previous chunks instead of duplicating them
    reindexed = service.chunk_paper(db, paper)
    stored = db.query(PaperChunkModel).filter(PaperChunkModel.paper_id == paper.id).all()
    assert len(stored) == len(reindexed)


def test_chunk_paper_skips_abstract_when_section_present(db: Session):
    from app.services.auth import create_user_with_personal_owner

    user = create_user_with_personal_owner(
        db,
        email="rag_abstract@openresearch.org",
        name="Abstract User",
        password="Secure_Password_123",
    )
    project = Project(
        id="rag-proj-2", owner_id=user.personal_owner_id, name="Abstract Dedup Project"
    )
    db.add(project)
    paper = _make_paper("rag-proj-2")
    paper.metadata_json = {
        "sections": [{"title": "Abstract", "page_number": 1, "text": "Already present."}]
    }
    db.add(paper)
    db.commit()

    chunks = RAGService().chunk_paper(db, paper)
    assert all(c.section != "Abstract" for c in chunks)


def test_hybrid_search_modes_and_penalties(db: Session):
    from app.models.chunk import PaperChunk as PaperChunkModel
    from app.services.auth import create_user_with_personal_owner

    user = create_user_with_personal_owner(
        db, email="rag_search@openresearch.org", name="Search User", password="Secure_Password_123"
    )
    project = Project(id="rag-proj-3", owner_id=user.personal_owner_id, name="Search Project")
    db.add(project)
    paper = _make_paper("rag-proj-3", extraction_status="unverified")
    db.add(paper)
    db.commit()

    service = RAGService()
    chunks = service.chunk_paper(db, paper)
    assert len(chunks) > 0

    # Empty query -> no results
    assert service.hybrid_search(db, "rag-proj-3", "") == []
    assert service.hybrid_search(db, "rag-proj-3", "   ") == []

    # General mode bypasses retrieval entirely
    assert service.hybrid_search(db, "rag-proj-3", "scaling laws", mode="general") == []

    # Lexical + semantic hybrid retrieval finds relevant content
    results = service.hybrid_search(db, "rag-proj-3", "scaling laws parameters")
    assert len(results) > 0
    top = results[0]
    assert top.paper_id == paper.id

    # Document-scoped search restricts to one paper but still matches
    scoped = service.hybrid_search(
        db, "rag-proj-3", "scaling laws", mode="document", paper_id=paper.id
    )
    assert all(p.paper_id == paper.id for p in scoped)

    # Unverified extraction penalty applied without dropping results entirely
    unverified_meta_chunks = (
        db.query(PaperChunkModel).filter(PaperChunkModel.paper_id == paper.id).all()
    )
    assert all(
        c.metadata_json.get("extraction_status") == "unverified" for c in unverified_meta_chunks
    )


# ---------------------------------------------------------------------------
# Teams endpoint error paths (teams.py lines 62, 95-107, 125-133, 157-166, ...)
# ---------------------------------------------------------------------------


def _register(client: TestClient, email: str) -> dict:
    res = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Secure_Password_123", "name": f"User {email}"},
    )
    assert res.status_code in (200, 201), res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_teams_endpoint_error_paths(client: TestClient):
    owner_headers = _register(client, "team_owner_gates@openresearch.org")
    outsider_headers = _register(client, "team_outsider_gates@openresearch.org")

    team = client.post(
        "/api/v1/teams",
        json={"name": "Quality Gate Team", "description": "Coverage"},
        headers=owner_headers,
    ).json()
    team_id = team["id"]

    # get_team: unknown id -> 404; non-member -> 403; member -> success
    assert client.get("/api/v1/teams/nonexistent-team", headers=owner_headers).status_code == 404
    assert client.get(f"/api/v1/teams/{team_id}", headers=outsider_headers).status_code == 403
    ok = client.get(f"/api/v1/teams/{team_id}", headers=owner_headers)
    assert ok.status_code == 200 and ok.json()["member_count"] == 1

    # update_team: 404, forbidden role, and successful rename by owner
    payload = {"name": "Renamed Team"}
    assert (
        client.patch(
            "/api/v1/teams/nonexistent-team", json=payload, headers=owner_headers
        ).status_code
        == 404
    )
    assert (
        client.patch(f"/api/v1/teams/{team_id}", json=payload, headers=outsider_headers).status_code
        == 403
    )
    renamed = client.patch(f"/api/v1/teams/{team_id}", json=payload, headers=owner_headers)
    assert renamed.status_code == 200 and renamed.json()["name"] == "Renamed Team"

    # list_teams for user with no memberships -> empty list
    empty_list = client.get("/api/v1/teams", headers=outsider_headers)
    assert empty_list.status_code == 200 and empty_list.json() == []

    # add member errors: missing user, duplicate membership; then success
    assert (
        client.post(
            f"/api/v1/teams/{team_id}/members",
            json={"email": "ghost_user@openresearch.org"},
            headers=owner_headers,
        ).status_code
        == 404
    )
    client.post(
        f"/api/v1/teams/{team_id}/members",
        json={"email": "team_outsider_gates@openresearch.org", "role": "editor"},
        headers=owner_headers,
    )
    dup = client.post(
        f"/api/v1/teams/{team_id}/members",
        json={"email": "team_outsider_gates@openresearch.org"},
        headers=owner_headers,
    )
    assert dup.status_code == 409

    members = client.get(f"/api/v1/teams/{team_id}/members", headers=owner_headers).json()
    assert len(members) == 2
    editor_entry = next(m for m in members if m["role"] == "editor")
    assert (
        client.get(f"/api/v1/teams/{team_id}/members", headers=outsider_headers).status_code == 200
    )

    # update member role errors: non-owner, unknown membership id
    assert (
        client.patch(
            f"/api/v1/teams/{team_id}/members/{editor_entry['id']}",
            json={"role": "viewer"},
            headers=outsider_headers,
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/v1/teams/{team_id}/members/nonexistent-membership",
            json={"role": "viewer"},
            headers=owner_headers,
        ).status_code
        == 404
    )
    promoted = client.patch(
        f"/api/v1/teams/{team_id}/members/{editor_entry['id']}",
        json={"role": "viewer"},
        headers=owner_headers,
    )
    assert promoted.status_code == 200 and promoted.json()["role"] == "viewer"

    # remove member errors and success
    assert (
        client.delete(
            f"/api/v1/teams/{team_id}/members/nonexistent-membership", headers=owner_headers
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/api/v1/teams/{team_id}/members/{editor_entry['id']}", headers=outsider_headers
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/v1/teams/{team_id}/members/{editor_entry['id']}", headers=owner_headers
        ).status_code
        == 204
    )

    # delete_team: forbidden for non-owner, 404, then owner success
    assert client.delete(f"/api/v1/teams/{team_id}", headers=outsider_headers).status_code == 403
    assert client.delete("/api/v1/teams/ghost-team", headers=owner_headers).status_code == 404
    assert client.delete(f"/api/v1/teams/{team_id}", headers=owner_headers).status_code == 204
    assert client.get(f"/api/v1/teams/{team_id}", headers=owner_headers).status_code == 404


# ---------------------------------------------------------------------------
# Version history lifecycle (version_history.py lines 28,31,42-50,98-107,196-204)
# ---------------------------------------------------------------------------


def test_version_history_full_lifecycle(client: TestClient, db: Session):
    headers = _register(client, "version_gate_user@openresearch.org")
    project = client.post(
        "/api/v1/projects", json={"name": "Version Gate Project"}, headers=headers
    ).json()

    doc = Document(
        id="version-gate-doc",
        project_id=project["id"],
        title="Original Title",
        plain_text="First draft line\nSecond line",
        content_json={"type": "doc", "content": []},
    )
    db.add(doc)
    db.commit()

    base = f"/api/v1/documents/{doc.id}/versions"

    # Access checks: unknown document -> 404
    assert client.get("/api/v1/documents/missing-doc/versions", headers=headers).status_code == 404

    # List versions: initially empty
    assert client.get(base, headers=headers).json() == []

    # Create two explicit snapshots
    v1 = client.post(
        base,
        json={"title": "Snapshot One", "plain_text": "First draft line\nSecond line"},
        headers=headers,
    )
    assert v1.status_code == 201
    v2 = client.post(
        base,
        json={"title": "Snapshot Two", "plain_text": "Revised first line\nSecond line\nThird line"},
        headers=headers,
    )
    assert v2.status_code == 201
    assert v2.json()["version_number"] == 2

    listed = client.get(base, headers=headers).json()
    assert [v["version_number"] for v in listed] == [2, 1]

    # get single version: success and 404
    got = client.get(f"{base}/{v1.json()['id']}", headers=headers)
    assert got.status_code == 200 and got.json()["title"] == "Snapshot One"
    assert client.get(f"{base}/missing-version", headers=headers).status_code == 404

    # diff: insert/delete accounting and 404 handling
    diff_ok = client.get(f"{base}/{v1.json()['id']}/diff/{v2.json()['id']}", headers=headers)
    assert diff_ok.status_code == 200
    diff_body = diff_ok.json()
    assert diff_body["diff_summary"].startswith("+") and "-" in diff_body["diff_summary"]
    change_types = {item["change_type"] for item in diff_body["diff_items"]}
    assert "insert" in change_types
    assert (
        client.get(f"{base}/{v1.json()['id']}/diff/missing-version", headers=headers).status_code
        == 404
    )

    # restore: rewinds document content and records a checkpoint version
    restored = client.post(f"{base}/{v1.json()['id']}/restore", headers=headers)
    assert restored.status_code == 201
    assert "Restored from Version 1" in restored.json()["change_summary"]
    final_versions = client.get(base, headers=headers).json()
    assert final_versions[0]["change_summary"].startswith("Restored from Version")

    # restore unknown version -> 404
    assert client.post(f"{base}/missing-version/restore", headers=headers).status_code == 404


# ---------------------------------------------------------------------------
# Zotero import: invalid JSON, dedup skip path (zotero_service.py 40-42,104-107)
# ---------------------------------------------------------------------------


def test_zotero_import_invalid_json_dedup_and_empty(db: Session):
    service = ZoteroService()

    # Invalid JSON content -> error response
    bad = service.import_csl_or_api_data(
        db, "proj-zot", ZoteroImportRequest(csl_json_content="{not valid json")
    )
    assert bad.total_imported == 0
    assert "Invalid JSON" in bad.message

    # Empty payload -> nothing imported
    empty = service.import_csl_or_api_data(db, "proj-zot", ZoteroImportRequest())
    assert empty.total_imported == 0 and "No references" in empty.message

    csl = """
    [
      {"id": "zot-1", "type": "article-journal", "title": "Attention Is All You Need",
       "DOI": "10.5555/attention", "issued": {"date-parts": [[2017]]},
       "author": [{"family": "Vaswani", "given": "Ashish"}],
       "container-title": "NeurIPS", "volume": "30", "page": "5998-6008"},
      {"id": "zot-2", "type": "book", "title": "Deep Learning", "literal": "Goodfellow"}
    ]
    """
    req = ZoteroImportRequest(csl_json_content=csl)

    first = service.import_csl_or_api_data(db, "proj-zot-dedup", req)
    assert first.total_imported == 2 and first.skipped_count == 0

    # Second import of identical references skips duplicates via DOI/title match
    second = service.import_csl_or_api_data(db, "proj-zot-dedup", req)
    assert second.total_imported == 0
    assert second.skipped_count == 2


# ---------------------------------------------------------------------------
# Plugin service branches (plugin_service.py 106-114, 136, 146, 164, 166)
# ---------------------------------------------------------------------------


def test_plugin_service_register_update_toggle_hooks(db: Session):
    manifest = PluginManifest(
        id="com.openresearch.quality-provider",
        name="Quality Provider",
        plugin_type="research_provider",
        description="Deterministic provider used by tests",
        author="OpenResearch",
        license="MIT",
        entrypoints={"on_paper_extract": "app.plugins.crossref_provider:on_paper_extract"},
    )

    created = PluginService.register_plugin(db, manifest)
    assert created.plugin_id == manifest.id and created.enabled is True

    # Re-registering updates the existing row rather than duplicating it
    updated_manifest = manifest.model_copy(
        update={"name": "Quality Provider v2", "version": "2.0.0"}
    )
    updated = PluginService.register_plugin(db, updated_manifest)
    assert updated.id == created.id and updated.version == "2.0.0"

    # toggle + config update on unknown plugins safely return None
    assert PluginService.toggle_plugin(db, "unknown-plugin", False) is None
    assert PluginService.update_plugin_config(db, "unknown-plugin", {}) is None

    disabled = PluginService.toggle_plugin(db, manifest.id, False)
    assert disabled.enabled is False

    PluginService.toggle_plugin(db, manifest.id, True)
    configured = PluginService.update_plugin_config(db, manifest.id, {"retries": 3})
    assert configured.config_json == {"retries": 3}

    # Register citation-processor and export-transformer plugins so all hook branches run
    PluginService.register_plugin(
        db,
        PluginManifest(
            id="com.openresearch.csl-hook",
            name="CSL Hook",
            plugin_type="citation_processor",
            entrypoints={"on_citation_format": "app.plugins.csl_processor:on_citation_format"},
        ),
    )
    PluginService.register_plugin(
        db,
        PluginManifest(
            id="com.openresearch.export-hook",
            name="Export Hook",
            plugin_type="export_transformer",
            entrypoints={"on_export": "app.plugins.latex_exporter:on_export"},
        ),
    )

    # Hook dispatch executes the registered entrypoint code across all three plugin types
    enriched = PluginService.execute_hook(db, "on_paper_extract", {})
    assert manifest.id in enriched["enriched_by"]

    citation_result = PluginService.execute_hook(
        db, "on_citation_format", {"authors": ["A. Turing"], "title": "T", "year": 1950}
    )
    assert citation_result.get("processed_by_csl") is True
    assert citation_result["formatted"].startswith("Turing, A.")

    export_result = PluginService.execute_hook(db, "on_export", {"title": "T", "content": "body"})
    assert export_result.get("supports_custom_transform") is True
    assert "\\documentclass" in export_result["content"]
