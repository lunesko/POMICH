from sqlalchemy import Column, DateTime, JSON, String, UUID, func

from app.db.base import Base


class JobEventModel(Base):
    __tablename__ = "job_events"

    id = Column(UUID(as_uuid=True), primary_key=True, nullable=False)
    job_id = Column(UUID(as_uuid=True), nullable=False)
    event_type = Column(String(64), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    metadata_json = Column(JSON, nullable=True)
