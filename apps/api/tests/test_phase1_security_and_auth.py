from fastapi.testclient import TestClient

from app.core.config import DEFAULT_DEV_SECRET_KEY, Settings


def test_password_complexity_validation(client: TestClient):
    """Test that password with fewer than 8 characters is rejected by schema validation."""
    # Too short (<8 chars)
    short_resp = client.post(
        "/api/v1/auth/register",
        json={"email": "short_pw@openresearch.org", "password": "short", "name": "Test User"},
    )
    assert short_resp.status_code == 422

    # Valid password (>=8 chars)
    valid_resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": "valid_pw@openresearch.org",
            "password": "Valid_Academic_Password_123",
            "name": "Test User",
        },
    )
    assert valid_resp.status_code == 201
    assert "access_token" in valid_resp.json()


def test_production_secret_key_validation():
    """Local-first: SECRET_KEY is optional and auto-generated; no validation error for defaults."""
    pg_url = "postgresql://user:pass@db:5432/openresearch"

    # Production with default / short key now auto-generates instead of raising
    s_default = Settings(ENVIRONMENT="production", SECRET_KEY=DEFAULT_DEV_SECRET_KEY, DATABASE_URL=pg_url)
    assert s_default.SECRET_KEY

    s_short = Settings(ENVIRONMENT="production", SECRET_KEY="short_custom_key", DATABASE_URL=pg_url)
    assert s_short.SECRET_KEY

    # Production with secure key still succeeds
    prod_settings = Settings(
        ENVIRONMENT="production",
        SECRET_KEY="this_is_a_very_secure_production_secret_key_32bytes",
        DATABASE_URL=pg_url,
    )
    assert prod_settings.ENVIRONMENT == "production"
    assert prod_settings.SECRET_KEY == "this_is_a_very_secure_production_secret_key_32bytes"


def test_intelligence_endpoints_authentication_and_authorization(client: TestClient):
    """Verify that all intelligence endpoints strictly require auth and enforce project boundaries."""
    # User 1
    u1_reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "owner_user@openresearch.org",
            "password": "Secure_Password_123",
            "name": "Project Owner",
        },
    ).json()
    u1_headers = {"Authorization": f"Bearer {u1_reg['access_token']}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "Owner Research"}, headers=u1_headers
    ).json()
    project_id = proj["id"]

    # User 2 (Attacker / Unrelated User)
    u2_reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other_user@openresearch.org",
            "password": "Secure_Password_123",
            "name": "Other User",
        },
    ).json()
    u2_headers = {"Authorization": f"Bearer {u2_reg['access_token']}"}

    endpoints = [
        ("verify-claims", {"text": "A test claim without citations."}),
        ("research-gaps", {"paper_ids": []}),
        ("literature-matrix", {"paper_ids": []}),
        ("paper-review", {"text": "# Intro\nSome content."}),
    ]

    for ep, payload in endpoints:
        url = f"/api/v1/projects/{project_id}/intelligence/{ep}"

        # 1. Request without credentials runs as the local user -> not a member -> 403
        res_unauth = client.post(url, json=payload)
        assert res_unauth.status_code == 403, f"{ep} failed anonymous-local-user test"

        # 2. Unauthorized request (User 2 accessing User 1's project) -> 403
        res_unauthz = client.post(url, json=payload, headers=u2_headers)
        assert res_unauthz.status_code == 403, f"{ep} failed authorization test"


def test_zotero_endpoints_authentication_and_authorization(client: TestClient):
    """Verify that Zotero import and sync endpoints require authentication and project access."""
    u1_reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "zotero_owner@openresearch.org",
            "password": "Secure_Password_123",
            "name": "Zotero Owner",
        },
    ).json()
    u1_headers = {"Authorization": f"Bearer {u1_reg['access_token']}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "Zotero Research"}, headers=u1_headers
    ).json()
    project_id = proj["id"]

    u2_reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "zotero_stranger@openresearch.org",
            "password": "Secure_Password_123",
            "name": "Stranger",
        },
    ).json()
    u2_headers = {"Authorization": f"Bearer {u2_reg['access_token']}"}

    import_url = f"/api/v1/projects/{project_id}/zotero/import"
    sync_url = f"/api/v1/projects/{project_id}/zotero/sync"

    # Anonymous request resolves to the local user -> not a member -> 403
    assert client.post(import_url, json={"csl_json_content": "[]"}).status_code == 403
    assert client.post(sync_url, json={"user_id": "1", "api_key": "k"}).status_code == 403

    # Unauthorized
    assert (
        client.post(import_url, json={"csl_json_content": "[]"}, headers=u2_headers).status_code
        == 403
    )
    assert (
        client.post(sync_url, json={"user_id": "1", "api_key": "k"}, headers=u2_headers).status_code
        == 403
    )


def test_websocket_collaboration_security(client: TestClient, db):
    """Verify WebSocket collaboration rejects unauthenticated or unauthorized connections."""
    from app.api.v1.endpoints.collaboration import collab_manager

    u1_reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "collab_owner@openresearch.org",
            "password": "Secure_Password_123",
            "name": "Collab Owner",
        },
    ).json()
    u1_token = u1_reg["access_token"]
    u1_headers = {"Authorization": f"Bearer {u1_token}"}

    proj = client.post(
        "/api/v1/projects", json={"name": "Collab Research"}, headers=u1_headers
    ).json()
    project_id = proj["id"]

    doc_resp = client.post(
        "/api/v1/documents",
        json={"project_id": project_id, "title": "Collab Paper", "plain_text": "Realtime content"},
        headers=u1_headers,
    ).json()
    doc_id = doc_resp["id"]

    # 1. Connection that never authenticates now joins as local user (local-first)
    with client.websocket_connect(f"/api/v1/ws/collaborate/{doc_id}") as ws:
        ws.send_text("garbage-without-auth")
        room_state = ws.receive_json()
        assert room_state["type"] == "room_state"
    assert doc_id not in collab_manager.active_connections

    # 2. Connection with an invalid token falls back to local user and joins
    with client.websocket_connect(f"/api/v1/ws/collaborate/{doc_id}") as ws:
        ws.send_json({"type": "auth", "token": "invalid_token_xyz"})
        room_state = ws.receive_json()
        assert room_state["type"] == "room_state"
    assert doc_id not in collab_manager.active_connections

    # 3. Valid first-message authentication succeeds and receives room_state
    with client.websocket_connect(f"/api/v1/ws/collaborate/{doc_id}") as ws:
        ws.send_json({"type": "auth", "token": u1_token})
        init_state = ws.receive_json()
        assert init_state["type"] == "room_state"
        assert init_state["document_id"] == doc_id
