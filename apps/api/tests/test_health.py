from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_health_check(client: TestClient):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["components"]["database"] == "healthy"
    assert "version" in data
    assert data["local_first_default"] is True
    assert "redis" not in data["components"] or data["components"]["redis"] in {
        "healthy",
        "degraded",
    }


def test_health_reports_503_when_database_down(client: TestClient, monkeypatch):
    from app.core.database import get_db

    class BrokenSession:
        def execute(self, *args, **kwargs):
            raise RuntimeError("database unreachable")

    # Scoped restore: the autouse setup_test_db override comes back afterwards.
    monkeypatch.setitem(app.dependency_overrides, get_db, BrokenSession)

    response = client.get("/api/v1/health")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "unhealthy"
    assert data["components"]["database"] == "unhealthy"


def test_health_degrades_when_redis_configured_but_down(client: TestClient, monkeypatch):
    from app.services import provider_cache_service as pcs_module

    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6399/0")
    monkeypatch.setattr(pcs_module.provider_cache_service, "_get_redis", lambda: None)

    response = client.get("/api/v1/health")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "degraded"
    assert data["components"]["redis"] == "degraded"
    assert data["components"]["database"] == "healthy"
