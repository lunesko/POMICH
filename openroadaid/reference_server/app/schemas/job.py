from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class JobResponse(BaseModel):
    id: UUID
    incident_id: UUID
    provider_id: Optional[UUID] = None
    status: str
    assigned_provider_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    actual_ttr_seconds: Optional[int] = None
    estimated_ttr_seconds: Optional[int] = None
