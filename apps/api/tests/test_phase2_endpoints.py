def test_auth_registration_and_login_flow(client):
    # 1. Register new user
    reg_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "curie@radium.org",
            "password": "PoloniumPassword123",
            "name": "Marie Curie",
        },
    )
    assert reg_response.status_code == 201
    reg_data = reg_response.json()
    assert "access_token" in reg_data
    assert reg_data["user"]["email"] == "curie@radium.org"
    assert reg_data["user"]["name"] == "Marie Curie"
    assert reg_data["user"]["personal_owner_id"] is not None

    token = reg_data["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get current user profile
    me_response = client.get("/api/v1/auth/me", headers=headers)
    assert me_response.status_code == 200
    me_data = me_response.json()
    assert me_data["email"] == "curie@radium.org"

    # 3. Test duplicate registration failure
    dup_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "curie@radium.org",
            "password": "AnotherPassword123",
            "name": "Marie Curie Clone",
        },
    )
    assert dup_response.status_code == 400

    # 4. Test Login
    login_response = client.post(
        "/api/v1/auth/login", json={"email": "curie@radium.org", "password": "PoloniumPassword123"}
    )
    assert login_response.status_code == 200
    login_data = login_response.json()
    assert "access_token" in login_data
    assert login_data["user"]["name"] == "Marie Curie"

    # 5. Test Invalid Login
    invalid_login = client.post(
        "/api/v1/auth/login", json={"email": "curie@radium.org", "password": "wrongpassword"}
    )
    assert invalid_login.status_code == 401


def test_project_and_document_crud_lifecycle(client):
    # Register user
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "einstein@princeton.edu",
            "password": "RelativityPassword123",
            "name": "Albert Einstein",
        },
    ).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Create Project
    proj_res = client.post(
        "/api/v1/projects",
        json={"name": "General Relativity", "description": "Geometric theory of gravitation"},
        headers=headers,
    )
    assert proj_res.status_code == 201
    proj_data = proj_res.json()
    project_id = proj_data["id"]
    assert proj_data["name"] == "General Relativity"

    # 2. List Projects
    list_res = client.get("/api/v1/projects", headers=headers)
    assert list_res.status_code == 200
    projects = list_res.json()
    assert len(projects) == 1
    assert projects[0]["id"] == project_id

    # 3. Update Project
    patch_proj = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"name": "General Relativity (Revised)"},
        headers=headers,
    )
    assert patch_proj.status_code == 200
    assert patch_proj.json()["name"] == "General Relativity (Revised)"

    # 4. Create Document in Project
    initial_content = {
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 1},
                "content": [{"type": "text", "text": "The Field Equations"}],
            },
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "Gravity arises from spacetime curvature."}],
            },
        ],
    }
    doc_res = client.post(
        "/api/v1/documents",
        json={
            "project_id": project_id,
            "title": "Field Equations Paper",
            "content_json": initial_content,
            "plain_text": "The Field Equations\nGravity arises from spacetime curvature.",
        },
        headers=headers,
    )
    assert doc_res.status_code == 201
    doc_data = doc_res.json()
    doc_id = doc_data["id"]
    assert doc_data["title"] == "Field Equations Paper"
    assert doc_data["content_json"]["type"] == "doc"

    # 5. List Documents in Project
    docs_list_res = client.get(f"/api/v1/projects/{project_id}/documents", headers=headers)
    assert docs_list_res.status_code == 200
    docs_list = docs_list_res.json()
    assert len(docs_list) == 1
    assert docs_list[0]["id"] == doc_id
    assert docs_list[0]["title"] == "Field Equations Paper"

    # 6. Retrieve Document with Content
    get_doc = client.get(f"/api/v1/documents/{doc_id}", headers=headers)
    assert get_doc.status_code == 200
    assert get_doc.json()["content_json"] == initial_content

    # 7. Autosave / Patch Document
    updated_content = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": r"R_{\mu\nu} - 1/2 R g_{\mu\nu} = 8\pi G T_{\mu\nu}"}
                ],
            }
        ],
    }
    patch_doc = client.patch(
        f"/api/v1/documents/{doc_id}",
        json={
            "title": "Einstein Field Equations (Published)",
            "content_json": updated_content,
            "plain_text": r"R_\mu\nu - 1/2 R g_\mu\nu = 8\pi G T_\mu\nu",
        },
        headers=headers,
    )
    assert patch_doc.status_code == 200
    assert patch_doc.json()["title"] == "Einstein Field Equations (Published)"
    assert patch_doc.json()["content_json"] == updated_content

    # 8. Delete Document
    del_doc = client.delete(f"/api/v1/documents/{doc_id}", headers=headers)
    assert del_doc.status_code == 204

    # Confirm deletion
    get_deleted = client.get(f"/api/v1/documents/{doc_id}", headers=headers)
    assert get_deleted.status_code == 404

    # 9. Delete Project
    del_proj = client.delete(f"/api/v1/projects/{project_id}", headers=headers)
    assert del_proj.status_code == 204
