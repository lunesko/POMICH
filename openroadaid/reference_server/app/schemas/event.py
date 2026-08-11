from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel


class EventResponse(BaseModel):
    id: UUID
    job_id: UUID
    event_type: str
    timestamp: datetime
    metadata: Optional[dict[str, Any]] = None
