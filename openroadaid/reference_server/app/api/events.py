from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.schemas.event import EventResponse
from app.services.event_service import EventService

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/{job_id}", response_model=list[EventResponse])
def list_events(job_id: str, db: Session = Depends(deps.get_db), auth=Depends(deps.require_provider)) -> list[EventResponse]:
    return EventService(db).list_events(job_id)
