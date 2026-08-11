from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class ProviderCreateRequest(BaseModel):
    name: str
    status: str = "ONLINE"
    verification_status: str = "VERIFIED"
    location: Optional[dict[str, float]] = None
    acceptance_rate: Optional[float] = None
    cancellation_rate: Optional[float] = None
    completion_rate: Optional[float] = None
    capabilities: list[str] = []


class ProviderResponse(BaseModel):
    id: UUID
    name: str
    status: str
    verification_status: str
    current_location: Optional[dict[str, float]] = None
    last_location_update: Optional[datetime] = None
    acceptance_rate: Optional[float] = None
    cancellation_rate: Optional[float] = None
    completion_rate: Optional[float] = None
    capabilities: list[str]
    created_at: datetime
    updated_at: datetime
