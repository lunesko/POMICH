from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.db.models.event import JobEventModel
from app.repositories.event_repository import EventRepository
from app.schemas.event import EventResponse


class EventService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = EventRepository(db)

    def create_event(self, job_id, event_type: str, metadata: dict | None = None) -> EventResponse:
        model = JobEventModel(id=uuid4(), job_id=job_id, event_type=event_type, metadata_json=metadata or {})
        created = self.repository.create(model)
        return EventResponse(
            id=created.id,
            job_id=created.job_id,
            event_type=created.event_type,
            timestamp=created.timestamp or datetime.now(timezone.utc),
            metadata=created.metadata_json,
        )

    def list_events(self, job_id) -> list[EventResponse]:
        return [
            EventResponse(
                id=item.id,
                job_id=item.job_id,
                event_type=item.event_type,
                timestamp=item.timestamp or datetime.now(timezone.utc),
                metadata=item.metadata_json,
            )
            for item in self.repository.list_for_job(job_id)
        ]
