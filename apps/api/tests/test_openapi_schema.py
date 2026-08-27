from fastapi.testclient import TestClient


def test_openapi_schema_generation(client: TestClient):
    """Verify that FastAPI produces a valid and complete OpenAPI 3.x schema."""
    response = client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    schema = response.json()

    assert schema["openapi"].startswith("3.")
    assert "info" in schema
    assert schema["info"]["title"] == "OpenResearch API"
    assert "paths" in schema
    assert len(schema["paths"]) >= 20

    # Ensure key academic endpoints are documented in OpenAPI schema
    paths = schema["paths"]
    assert any("documents" in p for p in paths)
    assert any("citations" in p for p in paths)
    assert "/api/v1/projects/{project_id}/papers/upload" in paths
    assert "/api/v1/projects/{project_id}/intelligence/verify-claims" in paths
    assert "/api/v1/projects/{project_id}/intelligence/research-gaps" in paths
    assert "/api/v1/projects/{project_id}/intelligence/literature-matrix" in paths
    assert "/api/v1/projects/{project_id}/intelligence/paper-review" in paths

    # Verify security schemes
    assert "components" in schema
    assert "securitySchemes" in schema["components"]
