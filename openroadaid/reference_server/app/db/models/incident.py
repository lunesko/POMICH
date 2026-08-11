from sqlalchemy import Column, DateTime, JSON, String, Text, UUID, func

from app.db.base import Base


class IncidentModel(Base):
    __tablename__ = "incidents"

    id = Column(UUID(as_uuid=True), primary_key=True, nullable=False)
    external_id = Column(String(255), nullable=True)
    incident_type = Column(String(64), nullable=False)
    status = Column(String(64), nullable=False, default="CREATED")
    description = Column(Text, nullable=True)
    vehicle_payload = Column(JSON, nullable=True)
    location = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
