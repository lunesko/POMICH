from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.db.models.incident import IncidentModel
from app.repositories.incident_repository import IncidentRepository
from app.schemas.incident import IncidentCreateRequest, IncidentResponse
from app.utils import wkt_from_location


class IncidentService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = IncidentRepository(db)

    def create_incident(self, payload: IncidentCreateRequest) -> IncidentResponse:
        model = IncidentModel(
            id=uuid4(),
            external_id=payload.external_id,
            incident_type=payload.incident_type,
            status="CREATED",
            description=payload.description,
            vehicle_payload=payload.vehicle_payload,
            location=wkt_from_location(payload.location),
        )
        created = self.repository.create(model)
        return IncidentResponse(
            id=created.id,
            external_id=created.external_id,
            incident_type=created.incident_type,
            status=created.status,
            description=created.description,
            vehicle_payload=created.vehicle_payload,
            location=payload.location,
            created_at=created.created_at or datetime.now(timezone.utc),
            updated_at=created.updated_at or datetime.now(timezone.utc),
        )
