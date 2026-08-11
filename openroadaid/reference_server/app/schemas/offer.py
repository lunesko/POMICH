from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class OfferResponse(BaseModel):
    id: UUID
    job_id: UUID
    provider_id: UUID
    status: str
    rank: int
    distance_km: Optional[float] = None
    estimated_eta_seconds: Optional[int] = None
    expires_at: datetime
    created_at: datetime
