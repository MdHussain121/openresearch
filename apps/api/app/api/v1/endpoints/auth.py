import logging

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import (
    SlidingWindowRateLimiter,
    get_client_ip,
    rate_limit_dependency,
)
from app.models.user import User
from app.schemas.models import (
    Token,
    TokenRefreshRequest,
    UserCreate,
    UserLogin,
    UserResponse,
)
from app.services.auth import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    create_user_with_personal_owner,
    decode_token,
    get_current_user,
)

router = APIRouter()
logger = logging.getLogger("openresearch.auth_endpoint")

login_rate_limiter = SlidingWindowRateLimiter(
    max_requests=settings.LOGIN_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
)
register_rate_limiter = SlidingWindowRateLimiter(
    max_requests=settings.REGISTER_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=settings.REGISTER_RATE_LIMIT_WINDOW_SECONDS,
)
refresh_rate_limiter = SlidingWindowRateLimiter(max_requests=60, window_seconds=300)


def _issue_token_pair(user: User) -> Token:
    access_token = create_access_token(data={"sub": user.id, "email": user.email})
    refresh_token = create_refresh_token(data={"sub": user.id, "email": user.email})
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


@router.post("/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(
    request: Request,
    user_in: UserCreate,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit_dependency(register_rate_limiter)),
) -> Token:
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to register with the provided information.",
        )

    user = create_user_with_personal_owner(
        db=db, email=user_in.email, password=user_in.password, name=user_in.name
    )
    return _issue_token_pair(user)


@router.post("/auth/login", response_model=Token)
def login(
    request: Request,
    login_in: UserLogin,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit_dependency(login_rate_limiter)),
) -> Token:
    user = authenticate_user(db, email=login_in.email, password=login_in.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _issue_token_pair(user)


@router.post("/auth/refresh", response_model=Token)
def refresh_tokens(
    request: Request,
    token_in: TokenRefreshRequest,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit_dependency(refresh_rate_limiter)),
) -> Token:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token_in.refresh_token, expected_type="refresh")
    except jwt.PyJWTError:
        raise credentials_exception from None
    except Exception:
        logger.exception("Unexpected error decoding refresh token")
        raise credentials_exception from None

    user_id = payload.get("sub")
    if not user_id:
        raise credentials_exception
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    return _issue_token_pair(user)


@router.get("/auth/me", response_model=UserResponse)
def get_me(request: Request, current_user: User = Depends(get_current_user)) -> User:
    return current_user


__all__ = [
    "get_client_ip",
    "login_rate_limiter",
    "refresh_rate_limiter",
    "register_rate_limiter",
    "router",
]
