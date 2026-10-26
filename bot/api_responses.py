"""Stable public response fields. Legacy extensions are retained during migration."""
from typing import Literal
from pydantic import BaseModel, ConfigDict


class AssignedProviderResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str | None = None
    name: str | None = None
    distanceKm: float | None = None
    roadDistanceKm: float | None = None
    etaMinutes: float | None = None
    etaSource: Literal["osrm", "approximate"] = "approximate"


class OrderRead(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    status: str
    service: str | None = None
    customerId: str | None = None
    assignedProviderId: str | None = None
    assignedProvider: AssignedProviderResponse | None = None
    etaMinutes: float | None = None
    createdAt: str | None = None
    updatedAt: str | None = None
