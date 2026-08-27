def test_comments_and_version_history(client):
    # 1. Setup User and Document
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": "feynman@caltech.edu",
            "password": "QuantumPhysics123",
            "name": "Richard Feynman",
        },
    )
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    proj_resp = client.post(
        "/api/v1/projects", json={"name": "Path Integral Formulations"}, headers=headers
    )
    project_id = proj_resp.json()["id"]

    doc_resp = client.post(
        "/api/v1/documents",
        json={
            "project_id": project_id,
            "title": "Quantum Electrodynamics Basics",
            "plain_text": (
                "Space-time approach to non-relativistic quantum mechanics.\n"
                "Initial formulation with Lagrangian dynamics."
            ),
        },
        headers=headers,
    )
    document_id = doc_resp.json()["id"]

    # 2. Test Comments CRUD & Threaded Replies (Roadmap 9.2)
    comment_resp = client.post(
        f"/api/v1/documents/{document_id}/comments",
        json={
            "selected_text": "Lagrangian dynamics",
            "from_pos": 50,
            "to_pos": 69,
            "content": "Should we include Hamiltonian comparisons in section 2?",
        },
        headers=headers,
    )
    assert comment_resp.status_code == 201
    comment = comment_resp.json()
    comment_id = comment["id"]
    assert comment["author_name"] == "Richard Feynman"
    assert comment["selected_text"] == "Lagrangian dynamics"
    assert comment["resolved"] is False

    # Reply to comment
    reply_resp = client.post(
        f"/api/v1/documents/{document_id}/comments/{comment_id}/replies",
        json={"content": "Yes, added in equation 4.1."},
        headers=headers,
    )
    assert reply_resp.status_code == 201
    assert reply_resp.json()["parent_id"] == comment_id

    # List comments
    list_c = client.get(f"/api/v1/documents/{document_id}/comments", headers=headers)
    assert list_c.status_code == 200
    assert len(list_c.json()) == 1
    assert len(list_c.json()[0]["replies"]) == 1

    # Resolve comment
    resolve_resp = client.patch(
        f"/api/v1/documents/{document_id}/comments/{comment_id}",
        json={"resolved": True},
        headers=headers,
    )
    assert resolve_resp.status_code == 200
    assert resolve_resp.json()["resolved"] is True

    # 3. Test Version History & Snapshots (Roadmap 9.2)
    # Create Version 1 snapshot
    v1_resp = client.post(
        f"/api/v1/documents/{document_id}/versions",
        json={
            "title": "QED Draft v1",
            "plain_text": "Space-time approach to quantum mechanics.\nInitial draft.",
            "change_summary": "First milestone outline",
        },
        headers=headers,
    )
    assert v1_resp.status_code == 201
    v1 = v1_resp.json()
    assert v1["version_number"] == 1
    v1_id = v1["id"]

    # Mutate document and create Version 2 snapshot
    client.patch(
        f"/api/v1/documents/{document_id}",
        json={
            "title": "QED Draft v2 (Revised)",
            "plain_text": (
                "Space-time approach to quantum mechanics with action integrals.\n"
                "Added path integral formulation section.\n"
                "Initial draft expanded."
            ),
        },
        headers=headers,
    )

    v2_resp = client.post(
        f"/api/v1/documents/{document_id}/versions",
        json={
            "title": "QED Draft v2 (Revised)",
            "plain_text": (
                "Space-time approach to quantum mechanics with action integrals.\n"
                "Added path integral formulation section.\n"
                "Initial draft expanded."
            ),
            "change_summary": "Expanded action integral derivation",
        },
        headers=headers,
    )
    assert v2_resp.status_code == 201
    v2 = v2_resp.json()
    assert v2["version_number"] == 2
    v2_id = v2["id"]

    # 4. Test Version Diff Computation
    diff_resp = client.get(
        f"/api/v1/documents/{document_id}/versions/{v1_id}/diff/{v2_id}", headers=headers
    )
    assert diff_resp.status_code == 200
    diff = diff_resp.json()
    assert diff["v1_version"] == 1
    assert diff["v2_version"] == 2
    assert "added" in diff["diff_summary"]
    assert len(diff["diff_items"]) > 0

    # 5. Test Version Restoration
    restore_resp = client.post(
        f"/api/v1/documents/{document_id}/versions/{v1_id}/restore", headers=headers
    )
    assert restore_resp.status_code == 201
    restored_v = restore_resp.json()
    assert restored_v["version_number"] == 3
    assert "Restored from Version 1" in restored_v["change_summary"]

    # Verify live document now matches v1
    curr_doc = client.get(f"/api/v1/documents/{document_id}", headers=headers).json()
    assert curr_doc["title"] == "QED Draft v1"

    # 6. Test Active Collaborators Query
    # Anonymous request resolves to the local user -> not a member -> 403
    collab_unauth = client.get(f"/api/v1/documents/{document_id}/collaborators")
    assert collab_unauth.status_code == 403

    collab_resp = client.get(f"/api/v1/documents/{document_id}/collaborators", headers=headers)
    assert collab_resp.status_code == 200
    assert "collaborators" in collab_resp.json()
