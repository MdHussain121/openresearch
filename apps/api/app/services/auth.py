import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.membership import Membership
from app.models.owner import Owner
from app.models.user import User
from app.schemas.models import TokenData

logger = logging.getLogger("openresearch.auth")

security = HTTPBearer(auto_error=False)

LOCAL_USER_EMAIL = "local@openresearch.dev"
LOCAL_USER_NAME = "Local Researcher"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    password_bytes = plain_password.encode("utf-8")[:72]
    hashed_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hashed_bytes)


def get_password_hash(password: str) -> str:
    password_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode("utf-8")


def _create_token(data: dict[str, Any], expires_delta: timedelta | None, token_type: str) -> str:
    to_encode = data.copy()
    now_utc = datetime.now(UTC)
    if expires_delta:
        expire = now_utc + expires_delta
    else:
        expire = now_utc + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "token_type": token_type})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    return _create_token(data, expires_delta, "access")


def create_refresh_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    return _create_token(
        data, expires_delta or timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES), "refresh"
    )


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    if payload.get("token_type", "access") != expected_type:
        raise jwt.InvalidTokenError(
            f"Expected {expected_type} token, got {payload.get('token_type')}"
        )
    return payload


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def get_or_create_local_user(db: Session) -> User:
    """
    Single-user local mode (no login): ensures the default local account exists
    and returns it. The local user is an admin so plugin management works.
    """
    user = db.query(User).filter(User.email == LOCAL_USER_EMAIL).first()
    if user is not None:
        return user

    owner = Owner(owner_type="user")
    db.add(owner)
    db.flush()

    user = User(
        email=LOCAL_USER_EMAIL,
        hashed_password=get_password_hash(LOCAL_USER_EMAIL),
        name=LOCAL_USER_NAME,
        personal_owner_id=owner.id,
        is_admin=True,
    )
    db.add(user)
    db.flush()
    membership = Membership(owner_id=owner.id, user_id=user.id, role="owner")
    db.add(membership)
    try:
        db.commit()
    except Exception:
        # Another request may have created the local user concurrently.
        db.rollback()
        existing = db.query(User).filter(User.email == LOCAL_USER_EMAIL).first()
        if existing is not None:
            return existing
        raise
    db.refresh(user)
    return user


def get_current_user(
    auth: HTTPAuthorizationCredentials | None = Depends(security), db: Session = Depends(get_db)
) -> User:
    """
    Resolves the acting user from a valid bearer token.
    If no valid token is provided, returns the auto-provisioned local user ONLY
    when OPENRESEARCH_DEV_INSECURE_AUTH=1 is set (local single-user dev mode).
    Otherwise raises 401.
    """
    dev_insecure = os.environ.get("OPENRESEARCH_DEV_INSECURE_AUTH", "").strip() == "1"

    if auth and auth.credentials:
        try:
            payload = decode_token(auth.credentials, expected_type="access")
            user_id = payload.get("sub")
            email = payload.get("email")
            if user_id is not None:
                token_data = TokenData(user_id=user_id, email=email)
                user = db.query(User).filter(User.id == token_data.user_id).first()
                if user is not None:
                    return user
        except (jwt.InvalidTokenError, ValidationError) as exc:
            logger.warning(
                "Invalid bearer token (%s); %s",
                type(exc).__name__,
                "falling back to local user (dev mode)" if dev_insecure else "rejecting",
            )
            if not dev_insecure:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired authentication token",
                    headers={"WWW-Authenticate": "Bearer"},
                ) from exc

    if dev_insecure:
        return get_or_create_local_user(db)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required for this operation",
        )
    return current_user


def create_user_with_personal_owner(db: Session, email: str, password: str, name: str) -> User:
    """
    Creates a user, their 1:1 polymorphic Owner entity, and an initial 'owner' Membership.
    """
    # 1. Create personal Owner
    owner = Owner(owner_type="user")
    db.add(owner)
    db.flush()

    # 2. Create User linked to personal Owner
    hashed_pw = get_password_hash(password)
    user = User(email=email, hashed_password=hashed_pw, name=name, personal_owner_id=owner.id)
    db.add(user)
    db.flush()

    # 3. Create explicit Membership granting 'owner' role to this Owner
    membership = Membership(owner_id=owner.id, user_id=user.id, role="owner")
    db.add(membership)
    db.commit()
    db.refresh(user)
    return user


def verify_user_access_to_owner(
    db: Session, user_id: str, owner_id: str, required_roles: list[str] | None = None
) -> bool:
    """
    Core authorization helper (Roadmap 1.3).
    Checks if a user has an active Membership for the requested Owner.
    Works identically for personal user owners and Phase 3 team workspaces.
    """
    query = db.query(Membership).filter(
        Membership.user_id == user_id, Membership.owner_id == owner_id
    )
    if required_roles:
        query = query.filter(Membership.role.in_(required_roles))

    membership = query.first()
    return membership is not None
