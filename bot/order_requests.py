"""Public create contract. Persistence/dispatch fields never come from callers."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Coordinates(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    lat: float = Field(ge=44, le=52.5)
    lng: float = Field(ge=22, le=40.5)


class ServiceDetails(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=100)
    version: Literal[1]
    service: Literal["tow", "battery", "wheel", "fuel", "lockout", "mechanic"]
    answers: dict[str, str] = Field(max_length=8)


class CreateOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_max_length=2000)
    source: Literal["web", "telegram-mini-app"] = "web"
    service: Literal["tow", "battery", "wheel", "fuel", "lockout", "mechanic"]
    serviceDetails: ServiceDetails
    customerCoordinates: Coordinates
    destinationCoordinates: Coordinates | None = None
    customerId: str | None = Field(default=None, max_length=120)
    customerLocation: str = Field(default="", max_length=500)
    destination: str = Field(default="", max_length=500)
    vehicleState: str = Field(default="", max_length=500)
    customerComment: str = Field(default="", max_length=2000)
    distanceKm: float | None = Field(default=None, ge=0, le=3000)
    telegramInitData: str | None = Field(default=None, max_length=8192)
    # Legacy identity hints are verified/overwritten by the authenticated channel.
    chatId: str | int | None = None
    telegramUserId: str | int | None = None
    telegramUsername: str | None = None
    telegramFirstName: str | None = None
    notify: bool = False
