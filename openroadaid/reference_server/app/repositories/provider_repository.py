from uuid import UUID

from geoalchemy2.functions import ST_DWithin
from sqlalchemy.orm import Session

from app.db.models.provider import ProviderCapabilityModel, ProviderModel


class ProviderRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, model: ProviderModel) -> ProviderModel:
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model

    def get_by_id(self, provider_id: UUID) -> ProviderModel | None:
        return self.db.query(ProviderModel).filter(ProviderModel.id == provider_id).first()

    def list_eligible(self, point_wkt: str, radius_km: int, required_capabilities: list[str]) -> list[ProviderModel]:
        return (
            self.db.query(ProviderModel)
            .join(ProviderCapabilityModel, ProviderCapabilityModel.provider_id == ProviderModel.id)
            .filter(ProviderModel.status == "ONLINE")
            .filter(ProviderModel.verification_status == "VERIFIED")
            .filter(ProviderCapabilityModel.capability.in_(required_capabilities))
            .filter(ST_DWithin(ProviderModel.current_location, point_wkt, radius_km * 1000))
            .all()
        )
