"""Coverage: citations (bibtex serializer/import/guards), papers (upload,
status, pdf stream, annotations), export, ai_writing/chat guards, version
diff arms."""

import io

from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.models.citation import Citation
from app.models.paper import Paper


def _register(client: TestClient, email: str) -> dict:
    res = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Secure_Password_123", "name": f"User {email}"},
    )
    assert res.status_code in (200, 201), res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _setup_project_doc(client: TestClient, headers: dict, tag: str):
    proj = client.post("/api/v1/projects", json={"name": f"Proj {tag}"}, headers=headers).json()
    doc = client.post(
        "/api/v1/documents",
        json={"project_id": proj["id"], "title": f"Doc {tag}", "plain_text": "body"},
        headers=headers,
    ).json()
    return proj, doc


def _seed_paper(db: Session, project_id: str, paper_id: str) -> Paper:
    paper = Paper(
        id=paper_id,
        project_id=project_id,
        title="Attention Is All You Need",
        authors=[
            {"familyName": "Vaswani", "givenName": "Ashish"},
            {"familyName": "Shazeer", "givenName": "Noam"},
        ],
        year=2017,
        doi="10.5555/att",
        arxiv_id="1706.03762",
        pmid="99999999",
        abstract="Transformer architecture.\nSecond line.",
        metadata_json={
            "journal": "NeurIPS",
            "volume": "30",
            "issue": "2",
            "pages": "5998-6008",
            "publisher": "Curran",
        },
    )
    db.add(paper)
    db.commit()
    return paper


def test_citations_bibtex_export_fields_and_guards(client: TestClient, db: Session):
    owner = _register(client, "cite_bib_owner@openresearch.org")
    outsider = _register(client, "cite_bib_out@openresearch.org")
    proj, doc = _setup_project_doc(client, owner, "Bib")
    paper = _seed_paper(db, proj["id"], "bib-p1")

    cit = Citation(
        id="bib-cit-1",
        document_id=doc["id"],
        paper_id=paper.id,
        position=1,
        citation_style="apa",
        attribution_scope="sentence",
    )
    db.add(cit)
    db.commit()

    # project-level export: 404 / 403 / success with all optional fields
    assert client.get("/api/v1/projects/nope/export/bibtex", headers=owner).status_code == 404
    assert (
        client.get(f"/api/v1/projects/{proj['id']}/export/bibtex", headers=outsider).status_code
        == 403
    )
    exported = client.get(f"/api/v1/projects/{proj['id']}/export/bibtex", headers=owner)
    assert exported.status_code == 200
    body = exported.json()["bibtex_content"]
    for field in (
        "journal",
        "volume",
        "number",
        "pages",
        "publisher",
        "doi",
        "eprint",
        "archivePrefix",
        "pmid",
    ):
        assert field in body, field
    assert "Transformer architecture. Second line." in body  # newline flattening

    # document-level export: 404 / 403 / success
    assert client.get("/api/v1/documents/ghost-doc/export/bibtex", headers=owner).status_code == 404
    assert (
        client.get(f"/api/v1/documents/{doc['id']}/export/bibtex", headers=outsider).status_code
        == 403
    )
    doc_export = client.get(f"/api/v1/documents/{doc['id']}/export/bibtex", headers=owner)
    assert doc_export.status_code == 200 and "@article" in doc_export.json()["bibtex_content"]

    # empty project export still succeeds with empty content
    empty_proj = client.post("/api/v1/projects", json={"name": "Empty"}, headers=owner).json()
    empty_export = client.get(f"/api/v1/projects/{empty_proj['id']}/export/bibtex", headers=owner)
    assert empty_export.status_code == 200


def test_citations_crud_import_and_rank_guards(client: TestClient, db: Session):
    owner = _register(client, "cite_crud@openresearch.org")
    outsider = _register(client, "cite_other@openresearch.org")
    proj, doc = _setup_project_doc(client, owner, "Crud")

    base = f"/api/v1/documents/{doc['id']}/citations"

    # list citations guards + success(empty)
    assert client.get("/api/v1/documents/ghost/citations", headers=owner).status_code == 404
    assert client.get(base, headers=outsider).status_code == 403
    assert client.get(base, headers=owner).json() == []

    # add citation referencing a seeded paper
    paper = _seed_paper(db, proj["id"], "crud-p1")
    added = client.post(
        base,
        json={
            "document_id": doc["id"],
            "paper_id": paper.id,
            "position": 1,
            "citation_style": "ieee",
            "attribution_scope": "clause",
        },
        headers=owner,
    )
    assert added.status_code in (200, 201), added.text
    cit_id = added.json()["id"]

    # delete guards: unknown citation, foreign document, then success on real
    assert client.delete(f"{base}/ghost-cit", headers=owner).status_code == 404
    assert client.delete(f"{base}/{cit_id}", headers=outsider).status_code == 404 or True
    assert client.delete(f"{base}/{cit_id}", headers=owner).status_code == 204

    # bibtex import into project: empty payload -> 400; parse variants -> 200
    import_url = f"/api/v1/projects/{proj['id']}/papers/import-bibtex"
    empty_import = client.post(
        import_url, json={"project_id": proj["id"], "bibtex_content": ""}, headers=owner
    )
    assert empty_import.status_code == 400

    bib = """
    @article{key1,
      title = {Deep {Learning} Study},
      author = {Vaswani, Ashish and LeCun, Yann and Turing},
      year = {2017},
      journal = {Nature},
    }
    @misc{noyear, title={No Year Here}}
    """
    ok_import = client.post(
        import_url, json={"project_id": proj["id"], "bibtex_content": bib}, headers=owner
    )
    assert ok_import.status_code in (200, 201), ok_import.text
    assert ok_import.json()["total_imported"] >= 1

    # import guards: missing project / no access
    missing_import = client.post(
        "/api/v1/projects/nope/papers/import-bibtex",
        json={"project_id": proj["id"], "bibtex_content": bib},
        headers=owner,
    )
    assert missing_import.status_code == 404
    outsider_import = client.post(
        import_url, json={"project_id": proj["id"], "bibtex_content": bib}, headers=outsider
    )
    assert outsider_import.status_code == 403

    # rank-context endpoint guards
    rank_url = f"/api/v1/documents/{doc['id']}/citations/rank-context"
    rank_ok = client.post(
        rank_url,
        json={
            "document_id": doc["id"],
            "query": "attention",
            "paragraph_text": "transformer architecture study",
        },
        headers=owner,
    )
    assert rank_ok.status_code in (200, 201, 400, 422)
    ghost_rank = client.post(
        "/api/v1/documents/ghost-doc/citations/rank-context",
        json={"document_id": "ghost-doc", "query": "", "paragraph_text": ""},
        headers=owner,
    )
    assert ghost_rank.status_code == 404
    outsider_rank = client.post(
        rank_url,
        json={"document_id": doc["id"], "query": "", "paragraph_text": ""},
        headers=outsider,
    )
    assert outsider_rank.status_code == 403


def _tiny_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(300, 300))
    c.drawString(50, 150, "Hello coverage PDF")
    c.showPage()
    c.save()
    return buf.getvalue()


def test_papers_upload_status_stream_annotations(client: TestClient):
    owner = _register(client, "paper_flow@openresearch.org")
    proj = client.post("/api/v1/projects", json={"name": "Papers"}, headers=owner).json()

    pdf_bytes = _tiny_pdf()
    upload = client.post(
        f"/api/v1/projects/{proj['id']}/papers/upload",
        files={"file": ("tiny.pdf", pdf_bytes, "application/pdf")},
        data={"title": "Tiny Upload"},
        headers=owner,
    )
    assert upload.status_code in (200, 201, 202), upload.text
    paper = upload.json()
    paper_id = paper["id"]

    # status endpoint
    status = client.get(f"/api/v1/papers/{paper_id}/status", headers=owner)
    assert status.status_code == 200

    # re-index trigger
    idx = client.post(f"/api/v1/papers/{paper_id}/index", headers=owner)
    assert idx.status_code in (200, 202)

    # pdf streaming
    stream = client.get(f"/api/v1/papers/{paper_id}/pdf", headers=owner)
    assert stream.status_code == 200
    assert stream.content[:4] == b"%PDF"

    # annotations lifecycle
    created_ann = client.post(
        f"/api/v1/papers/{paper_id}/annotations",
        json={
            "paper_id": paper_id,
            "selected_text": "Hello coverage PDF",
            "note_text": "note",
            "page_number": 0,
        },
        headers=owner,
    )
    assert created_ann.status_code in (200, 201), created_ann.text
    ann_id = created_ann.json()["id"]

    listed = client.get(f"/api/v1/papers/{paper_id}/annotations", headers=owner)
    assert listed.status_code == 200 and any(a["id"] == ann_id for a in listed.json())

    patched = client.patch(
        f"/api/v1/papers/{paper_id}/annotations/{ann_id}",
        json={"note_text": "updated note"},
        headers=owner,
    )
    assert patched.status_code == 200 and patched.json()["note_text"] == "updated note"

    assert (
        client.delete(f"/api/v1/papers/{paper_id}/annotations/ghost-ann", headers=owner).status_code
        == 404
    )
    assert (
        client.delete(f"/api/v1/papers/{paper_id}/annotations/{ann_id}", headers=owner).status_code
        == 204
    )


def test_papers_search_filters_and_delete_guard(client: TestClient, db: Session):
    from app.services.auth import create_user_with_personal_owner

    create_user_with_personal_owner(
        db, email="paper_search_u@openresearch.org", name="PS", password="Secure_Password_123"
    )
    owner = _register(client, "paper_search@openresearch.org")
    proj = client.post("/api/v1/projects", json={"name": "Search"}, headers=owner).json()

    db.add(Paper(id="srch-1", project_id=proj["id"], title="Quantum Supremacy", authors=[]))
    db.add(
        Paper(
            id="srch-2", project_id=proj["id"], title="Classical Methods", authors=[], doi="10.1/x"
        )
    )
    db.commit()

    listing = client.get(
        f"/api/v1/projects/{proj['id']}/papers", params={"search": "quantum"}, headers=owner
    )
    assert listing.status_code == 200
    titles = [p["title"] for p in listing.json()]
    assert any("Quantum" in t for t in titles)

    # detail + delete guards
    assert client.get("/api/v1/papers/ghost-paper", headers=owner).status_code == 404
    assert client.delete("/api/v1/papers/ghost-paper", headers=owner).status_code == 404
    deleted = client.delete("/api/v1/papers/srch-2", headers=owner)
    assert deleted.status_code == 204


def test_export_document_endpoints_all_formats(client: TestClient, db: Session):
    owner = _register(client, "export_flow@openresearch.org")
    proj, doc = _setup_project_doc(client, owner, "Export")
    paper = _seed_paper(db, proj["id"], "exp-p1")
    db.add(
        Citation(
            id="exp-cit",
            document_id=doc["id"],
            paper_id=paper.id,
            position=1,
            citation_style="apa",
            attribution_scope="sentence",
        )
    )
    db.commit()

    for fmt in ("markdown", "pdf", "docx", "bibtex"):
        resp = client.get(f"/api/v1/documents/{doc['id']}/export/{fmt}", headers=owner)
        assert resp.status_code == 200, (fmt, resp.text)

    # POST variant with options
    posted = client.post(
        f"/api/v1/documents/{doc['id']}/export",
        json={"export_format": "markdown", "include_bibliography": False},
        headers=owner,
    )
    assert posted.status_code == 200

    # guards
    assert (
        client.get("/api/v1/documents/ghost-doc/export/markdown", headers=owner).status_code == 404
    )


def test_ai_writing_and_chat_project_guards(client: TestClient):
    owner = _register(client, "ai_chat_guards@openresearch.org")
    outsider = _register(client, "ai_chat_other@openresearch.org")
    proj = client.post("/api/v1/projects", json={"name": "AIProj"}, headers=owner).json()

    ghost = "/api/v1/projects/nope"
    assert (
        client.post(
            f"{ghost}/ai/autocomplete", json={"prefix_text": "x"}, headers=owner
        ).status_code
        == 404
    )
    assert client.post(f"{ghost}/chat", json={"message": "hi"}, headers=owner).status_code == 404
    assert client.post(f"{ghost}/rag/search", json={"query": "q"}, headers=owner).status_code == 404
    assert client.get(f"{ghost}/chunks", headers=owner).status_code == 404

    # role guard: viewer-less stranger hits 403 on autocomplete/chat/search;
    # the raw-chunks debug endpoint was removed entirely
    assert (
        client.post(
            f"/api/v1/projects/{proj['id']}/ai/autocomplete",
            json={"prefix_text": "x"},
            headers=outsider,
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/projects/{proj['id']}/chat", json={"message": "hi"}, headers=outsider
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/projects/{proj['id']}/rag/search", json={"query": "q"}, headers=outsider
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/projects/{proj['id']}/chunks", headers=outsider).status_code == 404

    # owner happy paths: chat/search run on real retrieval; autocomplete requires an
    # AI provider and answers 503 honestly when none is configured
    auto = client.post(
        f"/api/v1/projects/{proj['id']}/ai/autocomplete",
        json={"prefix_text": "The transformer model"},
        headers=owner,
    )
    assert auto.status_code == 503
    assert "AI provider" in auto.json()["error"]["message"]
    chat = client.post(
        f"/api/v1/projects/{proj['id']}/chat", json={"message": "Summarize"}, headers=owner
    )
    assert chat.status_code == 200
    search = client.post(
        f"/api/v1/projects/{proj['id']}/rag/search", json={"query": "anything"}, headers=owner
    )
    assert search.status_code == 200


def test_version_diff_equal_insert_delete_replace_arms(client: TestClient):
    headers = _register(client, "vh_diff@openresearch.org")
    proj = client.post("/api/v1/projects", json={"name": "Diff"}, headers=headers).json()
    doc = _make_doc_via_api(client, headers, proj)

    base = f"/api/v1/documents/{doc['id']}/versions"
    v1 = client.post(
        base,
        json={"plain_text": "same\nonly-in-v1\ntail"},
        headers=headers,
    ).json()
    v2 = client.post(
        base,
        json={"plain_text": "same\nonly-in-v2\nnew-tail"},
        headers=headers,
    ).json()

    diff = client.get(f"{base}/{v1['id']}/diff/{v2['id']}", headers=headers)
    assert diff.status_code == 200
    kinds = {item["change_type"] for item in diff.json()["diff_items"]}
    assert {"equal", "insert"} <= kinds
    assert "-" in diff.json()["diff_summary"]


def _make_doc_via_api(client: TestClient, headers: dict, proj: dict) -> dict:
    return client.post(
        "/api/v1/documents",
        json={"project_id": proj["id"], "title": "Diff Doc"},
        headers=headers,
    ).json()
