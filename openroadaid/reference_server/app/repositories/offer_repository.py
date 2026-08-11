from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models.offer import OfferModel


class OfferRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, model: OfferModel) -> OfferModel:
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model

    def get_by_id(self, offer_id: UUID) -> OfferModel | None:
        return self.db.query(OfferModel).filter(OfferModel.id == offer_id).first()

    def update(self, model: OfferModel) -> OfferModel:
        self.db.commit()
        self.db.refresh(model)
        return model
