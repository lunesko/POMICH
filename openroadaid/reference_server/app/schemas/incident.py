from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class IncidentCreateRequest(BaseModel):
    external_id: Optional[str] = None
    incident_type: str = Field(..., min_length=1)
    description: Optional[str] = None
    vehicle_payload: Optional[dict[str, Any]] = None
    location: dict[str, float]


class IncidentResponse(BaseModel):
    id: UUID
    external_id: Optional[str] = None
    incident_type: str
    status: str
    description: Optional[str] = None
    vehicle_payload: Optional[dict[str, Any]] = None
    location: dict[str, float]
    created_at: datetime
    updated_at: datetime
