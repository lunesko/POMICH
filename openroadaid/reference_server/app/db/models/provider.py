from sqlalchemy import Column, DateTime, Float, JSON, String, UUID, func

from app.db.base import Base


class ProviderModel(Base):
    __tablename__ = "providers"

    id = Column(UUID(as_uuid=True), primary_key=True, nullable=False)
    name = Column(String(255), nullable=False)
    status = Column(String(64), nullable=False, default="OFFLINE")
    verification_status = Column(String(64), nullable=False, default="PENDING")
    current_location = Column(String(255), nullable=True)
    last_location_update = Column(DateTime(timezone=True), nullable=True)
    acceptance_rate = Column(Float, nullable=True, default=0.0)
    cancellation_rate = Column(Float, nullable=True, default=0.0)
    completion_rate = Column(Float, nullable=True, default=0.0)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ProviderCapabilityModel(Base):
    __tablename__ = "provider_capabilities"

    id = Column(UUID(as_uuid=True), primary_key=True, nullable=False)
    provider_id = Column(UUID(as_uuid=True), nullable=False)
    capability = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
