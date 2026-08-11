from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.db.models.job import JobModel
from app.repositories.job_repository import JobRepository
from app.schemas.job import JobResponse


class JobService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = JobRepository(db)

    def create_job(self, incident_id: UUID) -> JobResponse:
        model = JobModel(id=uuid4(), incident_id=incident_id, status="CREATED")
        created = self.repository.create(model)
        return JobResponse(
            id=created.id,
            incident_id=created.incident_id,
            provider_id=None,
            status=created.status,
            assigned_provider_id=created.assigned_provider_id,
            created_at=created.created_at or datetime.now(timezone.utc),
            updated_at=created.updated_at or datetime.now(timezone.utc),
            actual_ttr_seconds=None,
            estimated_ttr_seconds=None,
        )

    def get_job(self, job_id: UUID) -> JobResponse | None:
        model = self.repository.get_by_id(job_id)
        if not model:
            return None
        return JobResponse(
            id=model.id,
            incident_id=model.incident_id,
            provider_id=model.provider_id,
            status=model.status,
            assigned_provider_id=model.assigned_provider_id,
            created_at=model.created_at or datetime.now(timezone.utc),
            updated_at=model.updated_at or datetime.now(timezone.utc),
            actual_ttr_seconds=None,
            estimated_ttr_seconds=None,
        )
