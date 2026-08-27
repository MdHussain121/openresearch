from fastapi import APIRouter, Depends

from app.models.user import User
from app.schemas.models import CacheClearResponse, ProviderQuotaResponse
from app.services.auth import get_current_user
from app.services.provider_cache_service import provider_cache_service

router = APIRouter()


@router.get("/system/provider-status", response_model=ProviderQuotaResponse)
def get_provider_status_endpoint(
    current_user: User = Depends(get_current_user),
) -> ProviderQuotaResponse:
    """
    8.6 Provider & Cost Hardening (Roadmap 8.6):
    Surfaces real-time quota visibility, cache statistics, and usage thresholds for academic providers.
    """
    return provider_cache_service.get_quota_status()


@router.post("/system/provider-cache/clear", response_model=CacheClearResponse)
def clear_provider_cache_endpoint(
    current_user: User = Depends(get_current_user),
) -> CacheClearResponse:
    """
    Clears in-memory provider query cache.
    """
    return provider_cache_service.clear()
