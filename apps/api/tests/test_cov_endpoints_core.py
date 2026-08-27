"""Coverage: projects, documents, comments, plugins, graphs, evaluation,
intelligence/zotero guards, and misc endpoint error paths."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.document import Document


def _register(client: TestClient, email: str) -> dict:
    res = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Secure_Password_123", "name": f"User {email}"},
    )
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _project(client: TestClient, headers: dict, name: str = "Proj") -> dict:
    return client.post("/api/v1/projects", json={"name": name}, headers=headers).json()


def test_projects_endpoint_guards_and_listing(client: TestClient):
    owner = _register(client, "proj_owner@openresearch.org")
    outsider = _register(client, "proj_outsider@openresearch.org")

    # Create success
    created = _project(client, owner, "Guarded Project")
    assert created["name"] == "Guarded Project"
    pid = created["id"]

    # list all (no owner_id filter) returns accessible set
    mine = client.get("/api/v1/projects", headers=owner)
    assert mine.status_code == 200 and any(p["id"] == pid for p in mine.json())

    # explicit owner_id listing: forbidden for stranger, allowed for self
    me = client.get("/api/v1/auth/me", headers=owner).json()
    other_owner_id = me["personal_owner_id"] + "-not-real"
    assert (
        client.get(
            "/api/v1/projects", params={"owner_id": other_owner_id}, headers=owner
        ).status_code
        == 403
    )
    ok_self = client.get(
        "/api/v1/projects", params={"owner_id": me["personal_owner_id"]}, headers=owner
    )
    assert ok_self.status_code == 200

    # unknown owner id -> still 403 (access check precedes existence)
    assert (
        client.get("/api/v1/projects", params={"owner_id": "f" * 32}, headers=owner).status_code
        == 403
    )

    # get_project guards
    assert client.get(f"/api/v1/projects/{pid}", headers=outsider).status_code == 403
    assert client.get("/api/v1/projects/missing-proj", headers=owner).status_code == 404

    # update: 404 then success rename + description
    assert (
        client.patch("/api/v1/projects/nope", json={"name": "x"}, headers=owner).status_code == 404
    )
    renamed = client.patch(
        f"/api/v1/projects/{pid}", json={"name": "Renamed", "description": "desc"}, headers=owner
    )
    assert renamed.status_code == 200 and renamed.json()["name"] == "Renamed"

    # delete: 404 then success; afterwards inaccessible
    assert client.delete("/api/v1/projects/nope", headers=owner).status_code == 404
    assert client.delete(f"/api/v1/projects/{pid}", headers=owner).status_code == 204
    assert client.get(f"/api/v1/projects/{pid}", headers=owner).status_code == 404


def test_documents_crud_and_guards(client: TestClient, db: Session):
    owner = _register(client, "doc_owner@openresearch.org")
    outsider = _register(client, "doc_outsider@openresearch.org")
    proj = _project(client, owner)

    # create doc (body carries project_id)
    created = client.post(
        "/api/v1/documents",
        json={"project_id": proj["id"], "title": "Doc A", "plain_text": "hello world"},
        headers=owner,
    )
    assert created.status_code in (200, 201), created.text
    doc_id = created.json()["id"]

    base_list = f"/api/v1/projects/{proj['id']}/documents"

    # list docs of project (owner ok)
    listing = client.get(base_list, headers=owner)
    assert listing.status_code == 200 and any(d["id"] == doc_id for d in listing.json())

    # unknown project on create and list
    assert (
        client.post(
            "/api/v1/documents", json={"project_id": "nope", "title": "x"}, headers=owner
        ).status_code
        == 404
    )
    assert client.get("/api/v1/projects/nope/documents", headers=owner).status_code == 404

    # read single: stranger 403, missing 404
    assert client.get(f"/api/v1/documents/{doc_id}", headers=outsider).status_code == 403
    assert client.get("/api/v1/documents/missing-doc", headers=owner).status_code == 404
    got = client.get(f"/api/v1/documents/{doc_id}", headers=owner)
    assert got.status_code == 200

    # update document content
    upd = client.patch(
        f"/api/v1/documents/{doc_id}",
        json={
            "title": "Doc A2",
            "content_json": {"type": "doc", "content": []},
            "plain_text": "v2",
        },
        headers=owner,
    )
    assert upd.status_code == 200 and upd.json()["title"] == "Doc A2"

    # delete
    assert client.delete(f"/api/v1/documents/{doc_id}", headers=owner).status_code == 204
    assert client.get(f"/api/v1/documents/{doc_id}", headers=owner).status_code == 404


def _make_doc(db: Session, project_id: str, doc_id: str = "cm-doc") -> Document:
    doc = Document(id=doc_id, project_id=project_id, title="Comment Doc", plain_text="text")
    db.add(doc)
    db.commit()
    return doc


def test_comments_thread_crud_and_guards(client: TestClient, db: Session):
    from app.services.auth import create_user_with_personal_owner

    create_user_with_personal_owner(
        db, email="cm_user@openresearch.org", name="CM User", password="Secure_Password_123"
    )
    headers = _register(client, "cm_api@openresearch.org")
    client.get("/api/v1/auth/me", headers=headers)
    # align DB user with API user by reusing API-created project/document
    proj = _project(client, headers)
    doc = _make_doc(db, proj["id"], "cm-doc-api")

    base = f"/api/v1/documents/{doc.id}/comments"

    # access guards
    assert client.get("/api/v1/documents/ghost-doc/comments", headers=headers).status_code == 404

    # create root comment
    created = client.post(base, json={"content": "First!"}, headers=headers)
    assert created.status_code in (200, 201), created.text
    root_id = created.json()["id"]

    # reply to nonexistent parent -> 404 (dedicated replies route)
    assert (
        client.post(
            f"{base}/ghost-parent/replies", json={"content": "re"}, headers=headers
        ).status_code
        == 404
    )

    # reply success
    reply = client.post(f"{base}/{root_id}/replies", json={"content": "reply"}, headers=headers)
    assert reply.status_code in (200, 201)

    # list with resolved filter both ways
    listed = client.get(base, headers=headers).json()
    assert len(listed) >= 1
    assert client.get(base, params={"include_resolved": False}, headers=headers).status_code == 200

    # update someone else's comment -> forge second user's comment directly in db
    from app.models.comment import DocumentComment

    other = create_user_with_personal_owner(
        db, email="cm_other@openresearch.org", name="Other", password="Secure_Password_123"
    )
    foreign = DocumentComment(
        id="foreign-cm",
        document_id=doc.id,
        user_id=other.id,
        author_name="Other",
        content="foreign",
    )
    db.add(foreign)
    db.commit()
    assert (
        client.patch(f"{base}/foreign-cm", json={"content": "hack"}, headers=headers).status_code
        == 403
    )
    # own edit works
    edited = client.patch(f"{base}/{root_id}", json={"content": "edited"}, headers=headers)
    assert edited.status_code == 200 and edited.json()["content"] == "edited"

    # resolve flag via PATCH with resolved field
    resolved = client.patch(f"{base}/{root_id}", json={"resolved": True}, headers=headers)
    assert resolved.status_code == 200

    # delete: missing 404; foreign non-owner cannot delete others' comments (403); own ok
    assert client.delete(f"{base}/ghost-cm", headers=headers).status_code == 404
    # foreign comment: commenter is 'other' personal owner... current user is not owner of that
    # project-owner check passes because headers user owns project, but comment.user mismatch:
    # DELETE requires author OR project-owner role; our user IS project owner so allowed.
    assert client.delete(f"{base}/foreign-cm", headers=headers).status_code == 204

    # cleanup own comment
    assert client.delete(f"{base}/{root_id}", headers=headers).status_code == 204


def test_plugin_endpoints_404_paths(client: TestClient):
    headers = _register(client, "plugin_api@openresearch.org")
    assert client.get("/api/v1/plugins", headers=headers).status_code == 200
    assert client.get("/api/v1/plugins/ghost-plugin", headers=headers).status_code == 404
    # plugin mutations are admin-restricted: non-admin gets 403 before existence check
    assert client.get("/api/v1/plugins/ghost-plugin", headers=headers).status_code == 404
    assert (
        client.patch(
            "/api/v1/plugins/ghost-plugin/toggle", json={"enabled": True}, headers=headers
        ).status_code
        == 403
    )
    assert (
        client.patch(
            "/api/v1/plugins/ghost-plugin/config", json={"a": 1}, headers=headers
        ).status_code
        == 403
    )


def test_graph_evaluation_intelligence_zotero_guards(client: TestClient):
    owner = _register(client, "graph_owner@openresearch.org")
    outsider = _register(client, "graph_outsider@openresearch.org")
    proj = _project(client, owner)

    # research-graph: 404 + 403 + success(empty)
    assert client.get("/api/v1/projects/nope/research-graph", headers=owner).status_code == 404
    assert (
        client.get(f"/api/v1/projects/{proj['id']}/research-graph", headers=outsider).status_code
        == 403
    )
    ok = client.get(f"/api/v1/projects/{proj['id']}/research-graph", headers=owner)
    assert ok.status_code == 200

    # simulated evaluation benchmark was removed (Honesty & Grounding Pass)
    assert client.get("/api/v1/ai/evaluation/benchmark", headers=owner).status_code == 404
    assert client.post("/api/v1/ai/evaluation/benchmark", headers=owner).status_code == 404

    # intelligence verify-claims: 404 + 403
    payload = {"text": "Birds can fly."}
    assert (
        client.post(
            "/api/v1/projects/nope/intelligence/verify-claims",
            json=payload,
            headers=owner,
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/v1/projects/{proj['id']}/intelligence/verify-claims",
            json=payload,
            headers=outsider,
        ).status_code
        == 403
    )

    # zotero import into unknown project -> 404
    zreq = {"csl_json_content": "[]"}
    assert (
        client.post(
            "/api/v1/zotero/import", params={"project_id": "nope"}, json=zreq, headers=owner
        ).status_code
        == 404
    )
