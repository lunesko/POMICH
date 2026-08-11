from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models.incident import IncidentModel


class IncidentRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, incident_id: UUID) -> IncidentModel | None:
        return self.db.query(IncidentModel).filter(IncidentModel.id == incident_id).first()

    def create(self, model: IncidentModel) -> IncidentModel:
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model
