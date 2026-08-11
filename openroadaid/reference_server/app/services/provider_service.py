from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.db.models.provider import ProviderCapabilityModel, ProviderModel
from app.repositories.provider_repository import ProviderRepository
from app.schemas.provider import ProviderCreateRequest, ProviderResponse
from app.utils import wkt_from_location


class ProviderService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = ProviderRepository(db)

    def create_provider(self, payload: ProviderCreateRequest) -> ProviderResponse:
        model = ProviderModel(
            id=uuid4(),
            name=payload.name,
            status=payload.status,
            verification_status=payload.verification_status,
            current_location=wkt_from_location(payload.location) if payload.location else None,
            acceptance_rate=payload.acceptance_rate,
            cancellation_rate=payload.cancellation_rate,
            completion_rate=payload.completion_rate,
        )
        created = self.repository.create(model)
        for capability in payload.capabilities:
            self.db.add(ProviderCapabilityModel(id=uuid4(), provider_id=created.id, capability=capability))
        self.db.commit()
        return ProviderResponse(
            id=created.id,
            name=created.name,
            status=created.status,
            verification_status=created.verification_status,
            current_location=payload.location,
            last_location_update=created.last_location_update,
            acceptance_rate=created.acceptance_rate,
            cancellation_rate=created.cancellation_rate,
            completion_rate=created.completion_rate,
            capabilities=payload.capabilities,
            created_at=created.created_at or datetime.now(timezone.utc),
            updated_at=created.updated_at or datetime.now(timezone.utc),
        )
