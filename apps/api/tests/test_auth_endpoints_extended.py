"""Comprehensive tests for auth endpoints (registration, login, refresh, forgot password, reset password)."""

import jwt
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.auth import (
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    create_user_with_personal_owner,
)


def test_auth_forgot_password_existing_and_non_existing_user(client: TestClient, db: Session):
    # 1. Non-existent user -> returns 200 safe message without leaking user existence
    resp_non_exist = client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"})
    assert resp_non_exist.status_code == 200
    data_non_exist = resp_non_exist.json()
    assert "If an account exists" in data_non_exist["message"]
    assert data_non_exist.get("reset_token") is None

    # 2. Existing user -> returns 200 with dev reset_token
    create_user_with_personal_owner(
        db=db,
        email="test_forgot@example.com",
        password="OldPassword123",
        name="Test Forgot",
    )

    resp_exist = client.post("/api/v1/auth/forgot-password", json={"email": "test_forgot@example.com"})
    assert resp_exist.status_code == 200
    data_exist = resp_exist.json()
    assert "If an account exists" in data_exist["message"]
    assert data_exist.get("reset_token") is not None


def test_auth_reset_password_flow(client: TestClient, db: Session):
    user = create_user_with_personal_owner(
        db=db,
        email="test_reset@example.com",
        password="InitialPassword123",
        name="Test Reset",
    )

    # 1. Invalid reset token
    resp_invalid = client.post("/api/v1/auth/reset-password", json={"token": "invalid.jwt.token", "new_password": "NewPassword123"})
    assert resp_invalid.status_code == 400

    # 2. Reset token with non-existent user sub
    fake_token = create_password_reset_token("non-existent-user-id", "fake@example.com")
    resp_fake_user = client.post("/api/v1/auth/reset-password", json={"token": fake_token, "new_password": "NewPassword123"})
    assert resp_fake_user.status_code == 400

    # 3. Valid reset token -> updates password successfully
    valid_token = create_password_reset_token(user.id, user.email)
    resp_valid = client.post("/api/v1/auth/reset-password", json={"token": valid_token, "new_password": "NewPassword123"})
    assert resp_valid.status_code == 200
    assert resp_valid.json()["message"] == "Password has been reset successfully."

    # Verify user can login with new password
    login_resp = client.post("/api/v1/auth/login", json={"email": "test_reset@example.com", "password": "NewPassword123"})
    assert login_resp.status_code == 200
    assert "access_token" in login_resp.json()


def test_auth_refresh_token_edge_cases(client: TestClient, db: Session):
    user = create_user_with_personal_owner(
        db=db,
        email="test_refresh@example.com",
        password="Password123",
        name="Test Refresh",
    )

    # 1. Passing access token instead of refresh token -> 401
    access_tok = create_access_token(data={"sub": user.id, "email": user.email})
    resp_wrong_type = client.post("/api/v1/auth/refresh", json={"refresh_token": access_tok})
    assert resp_wrong_type.status_code == 401

    # 2. Refresh token for deleted / non-existent user -> 401
    fake_refresh = create_refresh_token(data={"sub": "missing-user-id", "email": "missing@example.com"})
    resp_missing_user = client.post("/api/v1/auth/refresh", json={"refresh_token": fake_refresh})
    assert resp_missing_user.status_code == 401

    # 3. Refresh token missing 'sub' claim -> 401
    bad_payload_token = jwt.encode({"type": "refresh"}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    resp_no_sub = client.post("/api/v1/auth/refresh", json={"refresh_token": bad_payload_token})
    assert resp_no_sub.status_code == 401

    # 4. Valid refresh token -> 200 + new token pair
    valid_refresh = create_refresh_token(data={"sub": user.id, "email": user.email})
    resp_valid = client.post("/api/v1/auth/refresh", json={"refresh_token": valid_refresh})
    assert resp_valid.status_code == 200
    data = resp_valid.json()
    assert "access_token" in data
    assert "refresh_token" in data
