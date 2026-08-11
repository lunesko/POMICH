from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.config import settings
from app.db.models.offer import OfferModel
from app.repositories.offer_repository import OfferRepository
from app.schemas.offer import OfferResponse


class OfferService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = OfferRepository(db)

    def create_offer(self, job_id, provider_id, rank, distance_km, estimated_eta_seconds) -> OfferResponse:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.offer_lifetime_seconds)
        model = OfferModel(
            id=uuid4(),
            job_id=job_id,
            provider_id=provider_id,
            status="PENDING",
            rank=rank,
            distance_km=distance_km,
            estimated_eta_seconds=estimated_eta_seconds,
            expires_at=expires_at,
        )
        created = self.repository.create(model)
        return OfferResponse(
            id=created.id,
            job_id=created.job_id,
            provider_id=created.provider_id,
            status=created.status,
            rank=created.rank,
            distance_km=created.distance_km,
            estimated_eta_seconds=created.estimated_eta_seconds,
            expires_at=created.expires_at,
            created_at=created.created_at,
        )
