from sqlalchemy.orm import Session

from app.db.models.event import JobEventModel


class EventRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, model: JobEventModel) -> JobEventModel:
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model

    def list_for_job(self, job_id) -> list[JobEventModel]:
        return self.db.query(JobEventModel).filter(JobEventModel.job_id == job_id).order_by(JobEventModel.timestamp).all()
