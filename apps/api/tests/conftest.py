import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.auth import (
    login_rate_limiter,
    refresh_rate_limiter,
    register_rate_limiter,
)
from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app

# Shared In-memory database with StaticPool for test isolation
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def fresh_event_loop_per_test():
    """Give every test a pristine current event loop (asyncio.run consumers close theirs)."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield
    try:
        loop.close()
    finally:
        asyncio.set_event_loop(None)


@pytest.fixture(autouse=True)
def hermetic_test_environment(monkeypatch):
    """Keep the suite hermetic: no ambient Redis, no cross-test rate-limit state."""
    monkeypatch.setattr(settings, "REDIS_URL", "")
    if settings.ENVIRONMENT.strip().lower() != "test":
        monkeypatch.setattr(settings, "ENVIRONMENT", "test")
    login_rate_limiter.reset()
    register_rate_limiter.reset()
    refresh_rate_limiter.reset()
    # Enable local single-user mode for tests so endpoints that previously
    # relied on the anonymous-admin fallback continue to work.
    monkeypatch.setenv("OPENRESEARCH_DEV_INSECURE_AUTH", "1")


@pytest.fixture(autouse=True)
def isolated_provider_key_store(monkeypatch, tmp_path):
    """Keep AI provider API-key storage out of the developer's real storage/ dir."""
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))


@pytest.fixture(scope="function", autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db():
    db_session = TestingSessionLocal()
    try:
        yield db_session
    finally:
        db_session.close()


@pytest.fixture
def client():
    return TestClient(app)
