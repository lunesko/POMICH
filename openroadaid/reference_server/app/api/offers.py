from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api import deps
from app.schemas.offer import OfferResponse
from app.services.offer_service import OfferService

router = APIRouter(prefix="/offers", tags=["offers"])


@router.post("/{offer_id}/accept", response_model=OfferResponse)
def accept_offer(offer_id: str, db: Session = Depends(deps.get_db), auth=Depends(deps.require_provider)) -> OfferResponse:
    raise HTTPException(status_code=404, detail="Not implemented")


@router.post("/{offer_id}/decline", response_model=OfferResponse)
def decline_offer(offer_id: str, db: Session = Depends(deps.get_db), auth=Depends(deps.require_provider)) -> OfferResponse:
    raise HTTPException(status_code=404, detail="Not implemented")
