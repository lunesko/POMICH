from sqlalchemy import Column, DateTime, Float, Integer, JSON, String, UUID, func

from app.db.base import Base


class OfferModel(Base):
    __tablename__ = "offers"

    id = Column(UUID(as_uuid=True), primary_key=True, nullable=False)
    job_id = Column(UUID(as_uuid=True), nullable=False)
    provider_id = Column(UUID(as_uuid=True), nullable=False)
    status = Column(String(64), nullable=False, default="PENDING")
    rank = Column(Integer, nullable=False, default=0)
    distance_km = Column(Float, nullable=True)
    estimated_eta_seconds = Column(Integer, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    metadata_json = Column(JSON, nullable=True)
