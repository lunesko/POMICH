from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.schemas.incident import IncidentCreateRequest, IncidentResponse
from app.services.incident_service import IncidentService

router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.post("", response_model=IncidentResponse)
def create_incident(payload: IncidentCreateRequest, db: Session = Depends(deps.get_db), auth=Depends(deps.require_client)) -> IncidentResponse:
    return IncidentService(db).create_incident(payload)


@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident(incident_id: str, db: Session = Depends(deps.get_db), auth=Depends(deps.require_client)) -> IncidentResponse:
    raise HTTPException(status_code=404, detail="Not implemented")
