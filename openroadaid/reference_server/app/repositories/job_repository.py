from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models.job import JobModel


class JobRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, model: JobModel) -> JobModel:
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model

    def get_by_id(self, job_id: UUID) -> JobModel | None:
        return self.db.query(JobModel).filter(JobModel.id == job_id).first()

    def update(self, model: JobModel) -> JobModel:
        self.db.commit()
        self.db.refresh(model)
        return model
