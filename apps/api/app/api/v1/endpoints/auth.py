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
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
    Token,
    TokenRefreshRequest,
    UserCreate,
    UserLogin,
    UserResponse,
)
from app.services.auth import (
    authenticate_user,
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    create_user_with_personal_owner,
    decode_password_reset_token,
    decode_token,
    get_current_user,
    get_password_hash,
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
forgot_password_rate_limiter = SlidingWindowRateLimiter(max_requests=5, window_seconds=300)
reset_password_rate_limiter = SlidingWindowRateLimiter(max_requests=5, window_seconds=300)


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


@router.post("/auth/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit_dependency(forgot_password_rate_limiter)),
) -> ForgotPasswordResponse:
    """
    Request a password reset link.

    Always returns success to prevent email enumeration.
    In production, this should send an email with the reset link.
    In development, the reset token is included in the response.
    """
    user = db.query(User).filter(User.email == body.email).first()

    # Always return success to prevent email enumeration
    if user is None:
        return ForgotPasswordResponse(message="If an account exists, a reset link has been sent.")

    reset_token = create_password_reset_token(user.id, user.email)
    logger.info(
        "Password reset requested for %s (token generated, not yet emailed)",
        body.email,
    )

    # TODO: In production, send an email with the reset link instead of returning the token.
    # For now, include the token in the response for development/testing.
    return ForgotPasswordResponse(
        message="If an account exists, a reset link has been sent.",
        reset_token=reset_token,
    )


@router.post("/auth/reset-password", response_model=ResetPasswordResponse)
def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit_dependency(reset_password_rate_limiter)),
) -> ResetPasswordResponse:
    """
    Reset a user's password using a valid password reset token.
    """
    try:
        payload = decode_password_reset_token(body.token)
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        ) from None
    except Exception:
        logger.exception("Unexpected error decoding password reset token")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        ) from None

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    # Update the password
    user.hashed_password = get_password_hash(body.new_password)
    db.commit()

    logger.info("Password reset completed for user %s", user.email)
    return ResetPasswordResponse(message="Password has been reset successfully.")


__all__ = [
    "get_client_ip",
    "login_rate_limiter",
    "refresh_rate_limiter",
    "register_rate_limiter",
    "router",
]
