from sqlalchemy import Column, DateTime, Integer, JSON, String, UUID, func

from app.db.base import Base


class JobModel(Base):
    __tablename__ = "jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, nullable=False)
    incident_id = Column(UUID(as_uuid=True), nullable=False)
    provider_id = Column(UUID(as_uuid=True), nullable=True)
    status = Column(String(64), nullable=False, default="CREATED")
    state_version = Column(Integer, nullable=False, default=0)
    assigned_provider_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    metadata_json = Column(JSON, nullable=True)
