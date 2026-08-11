from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api import deps
from app.schemas.provider import ProviderCreateRequest, ProviderResponse
from app.services.provider_service import ProviderService

router = APIRouter(prefix="/providers", tags=["providers"])


@router.post("", response_model=ProviderResponse)
def create_provider(payload: ProviderCreateRequest, db: Session = Depends(deps.get_db), auth=Depends(deps.require_dispatcher)) -> ProviderResponse:
    return ProviderService(db).create_provider(payload)


@router.get("/{provider_id}", response_model=ProviderResponse)
def get_provider(provider_id: str, db: Session = Depends(deps.get_db), auth=Depends(deps.require_provider)) -> ProviderResponse:
    raise HTTPException(status_code=404, detail="Not implemented")
