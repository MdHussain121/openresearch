def test_team_workspaces_crud_and_membership_roles(client):
    # 1. Register Owner User
    resp_owner = client.post(
        "/api/v1/auth/register",
        json={
            "email": "lab_director@stanford.edu",
            "password": "SecurePass123",
            "name": "Prof. Quantum",
        },
    )
    assert resp_owner.status_code == 201
    owner_token = resp_owner.json()["access_token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    # Register Collaborator 1 (Editor)
    resp_editor = client.post(
        "/api/v1/auth/register",
        json={"email": "postdoc@stanford.edu", "password": "SecurePass123", "name": "Dr. Postdoc"},
    )
    assert resp_editor.status_code == 201
    editor_token = resp_editor.json()["access_token"]
    editor_headers = {"Authorization": f"Bearer {editor_token}"}

    # Register Collaborator 2 (Viewer)
    resp_viewer = client.post(
        "/api/v1/auth/register",
        json={
            "email": "intern@stanford.edu",
            "password": "SecurePass123",
            "name": "Student Intern",
        },
    )
    assert resp_viewer.status_code == 201
    viewer_token = resp_viewer.json()["access_token"]
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

    # 2. Create Team Workspace
    team_resp = client.post(
        "/api/v1/teams",
        json={"name": "Quantum Computing Lab", "description": "Department of Applied Physics"},
        headers=owner_headers,
    )
    assert team_resp.status_code == 201
    team = team_resp.json()
    team_id = team["id"]
    assert team["name"] == "Quantum Computing Lab"
    assert team["current_user_role"] == "owner"
    assert team["member_count"] == 1

    # 3. List Teams for Owner
    list_resp = client.get("/api/v1/teams", headers=owner_headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    # 4. Add Members to Team
    # Add Editor
    add_ed = client.post(
        f"/api/v1/teams/{team_id}/members",
        json={"email": "postdoc@stanford.edu", "role": "editor"},
        headers=owner_headers,
    )
    assert add_ed.status_code == 201
    assert add_ed.json()["role"] == "editor"

    # Add Viewer
    add_vw = client.post(
        f"/api/v1/teams/{team_id}/members",
        json={"email": "intern@stanford.edu", "role": "viewer"},
        headers=owner_headers,
    )
    assert add_vw.status_code == 201
    assert add_vw.json()["role"] == "viewer"

    # 5. Verify Editor and Viewer can see team
    ed_teams = client.get("/api/v1/teams", headers=editor_headers).json()
    assert len(ed_teams) == 1
    assert ed_teams[0]["current_user_role"] == "editor"

    vw_teams = client.get("/api/v1/teams", headers=viewer_headers).json()
    assert len(vw_teams) == 1
    assert vw_teams[0]["current_user_role"] == "viewer"

    # 6. Create Project Under Team Workspace
    proj_resp = client.post(
        "/api/v1/projects",
        json={
            "name": "QML Algorithms Benchmark",
            "description": "Joint lab paper on QAOA optimization",
            "owner_id": team_id,
        },
        headers=owner_headers,
    )
    assert proj_resp.status_code == 201
    project = proj_resp.json()
    project_id = project["id"]
    assert project["owner_id"] == team_id

    # 7. Test Role Enforcement on Document Mutations (Roadmap 9.1)
    # Editor can create document
    doc_ed_resp = client.post(
        "/api/v1/documents",
        json={
            "project_id": project_id,
            "title": "QAOA Parameter Optimization Draft",
            "plain_text": "We evaluate quantum approximate optimization algorithms.",
        },
        headers=editor_headers,
    )
    assert doc_ed_resp.status_code == 201
    doc_id = doc_ed_resp.json()["id"]

    # Viewer CAN READ document
    doc_vw_read = client.get(f"/api/v1/documents/{doc_id}", headers=viewer_headers)
    assert doc_vw_read.status_code == 200

    # Viewer CANNOT create document (403 Forbidden)
    doc_vw_create = client.post(
        "/api/v1/documents",
        json={"project_id": project_id, "title": "Unauthorized Intern Draft"},
        headers=viewer_headers,
    )
    assert doc_vw_create.status_code == 403

    # Viewer CANNOT delete document (403 Forbidden)
    doc_vw_del = client.delete(f"/api/v1/documents/{doc_id}", headers=viewer_headers)
    assert doc_vw_del.status_code == 403

    # 8. Update Member Role
    members_list = client.get(f"/api/v1/teams/{team_id}/members", headers=owner_headers).json()
    intern_mem = next(m for m in members_list if m["email"] == "intern@stanford.edu")

    update_role_resp = client.patch(
        f"/api/v1/teams/{team_id}/members/{intern_mem['id']}",
        json={"role": "editor"},
        headers=owner_headers,
    )
    assert update_role_resp.status_code == 200
    assert update_role_resp.json()["role"] == "editor"

    # Now promoted intern can create document
    doc_promoted = client.post(
        "/api/v1/documents",
        json={"project_id": project_id, "title": "Promoted Intern Draft"},
        headers=viewer_headers,
    )
    assert doc_promoted.status_code == 201

    # 9. Remove Member
    del_mem_resp = client.delete(
        f"/api/v1/teams/{team_id}/members/{intern_mem['id']}", headers=owner_headers
    )
    assert del_mem_resp.status_code == 204

    # Removed member no longer has access
    doc_removed = client.post(
        "/api/v1/documents",
        json={"project_id": project_id, "title": "Should Fail"},
        headers=viewer_headers,
    )
    assert doc_removed.status_code == 403
