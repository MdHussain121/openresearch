from fastapi.testclient import TestClient


def test_local_mode_requests_without_token_are_accepted(client: TestClient):
    """Local single-user mode: requests without an Authorization header run as the
    auto-provisioned local user instead of being rejected (404/403/422 may still
    occur for unknown resources or invalid payloads, but never 401)."""
    endpoints = [
        # Documents
        ("GET", "/api/v1/projects/proj-123/documents"),
        ("POST", "/api/v1/documents"),
        ("GET", "/api/v1/documents/doc-123"),
        ("PATCH", "/api/v1/documents/doc-123"),
        ("DELETE", "/api/v1/documents/doc-123"),
        # Papers
        ("GET", "/api/v1/papers/paper-123"),
        ("DELETE", "/api/v1/papers/paper-123"),
        # Citations
        ("GET", "/api/v1/documents/doc-123/citations"),
        ("POST", "/api/v1/documents/doc-123/citations"),
        ("DELETE", "/api/v1/documents/doc-123/citations/cit-123"),
        ("POST", "/api/v1/projects/proj-123/papers/import-bibtex"),
        # Comments
        ("GET", "/api/v1/documents/doc-123/comments"),
        ("POST", "/api/v1/documents/doc-123/comments"),
        ("POST", "/api/v1/documents/doc-123/comments/com-123/replies"),
        ("PATCH", "/api/v1/documents/doc-123/comments/com-123"),
        ("DELETE", "/api/v1/documents/doc-123/comments/com-123"),
        # Projects
        ("GET", "/api/v1/projects"),
        ("POST", "/api/v1/projects"),
        ("GET", "/api/v1/projects/proj-123"),
        ("PATCH", "/api/v1/projects/proj-123"),
        ("DELETE", "/api/v1/projects/proj-123"),
        # Version history
        ("GET", "/api/v1/documents/doc-123/versions"),
        ("POST", "/api/v1/documents/doc-123/versions"),
        # Intelligence
        ("POST", "/api/v1/projects/proj-123/intelligence/verify-claims"),
        ("POST", "/api/v1/projects/proj-123/intelligence/research-gaps"),
        ("POST", "/api/v1/projects/proj-123/intelligence/literature-matrix"),
        ("POST", "/api/v1/projects/proj-123/intelligence/paper-review"),
        # Zotero
        ("POST", "/api/v1/projects/proj-123/zotero/import"),
        ("POST", "/api/v1/projects/proj-123/zotero/sync"),
        # Provider Cache & System
        ("POST", "/api/v1/system/provider-cache/clear"),
        ("GET", "/api/v1/system/provider-status"),
    ]

    for method, path in endpoints:
        if method == "GET":
            response = client.get(path)
        elif method == "POST":
            response = client.post(path, json={})
        elif method == "PUT":
            response = client.put(path, json={})
        elif method == "PATCH":
            response = client.patch(path, json={})
        elif method == "DELETE":
            response = client.delete(path)
        else:
            continue

        assert response.status_code != 401, (
            f"Expected no auth rejection for {method} {path}, got {response.status_code}: {response.text}"
        )


def test_invalid_token_falls_back_to_local_user(client: TestClient):
    """Malformed or invalid JWT tokens no longer hard-reject: they resolve to the
    local user so the app keeps working without any login."""
    headers = {"Authorization": "Bearer invalid.jwt.token"}

    response = client.get("/api/v1/projects", headers=headers)
    assert response.status_code == 200

    response = client.get("/api/v1/system/provider-status", headers=headers)
    assert response.status_code == 200

    response = client.post("/api/v1/projects", headers=headers, json={"name": "Tokenless Project"})
    assert response.status_code == 201
