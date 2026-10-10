"""Bounded public mutation contracts. Server-owned identity/trust fields are absent."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from fastapi import HTTPException
from bot.order_requests import Coordinates

class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=2000, allow_inf_nan=False)


class CustomerProfilePatch(RequestModel):
    name: str | None = Field(default=None, max_length=180)
    displayName: str | None = Field(default=None, max_length=180)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=254)
    telegram: str | None = Field(default=None, max_length=180)
    city: str | None = Field(default=None, max_length=180)
    vehicle: str | None = Field(default=None, max_length=180)
    avatarUrl: str | None = None
    bio: str | None = None
    preferredRole: Literal["customer", "provider"] | None = None
    telegramBotKind: Literal["customer", "provider"] | None = None
    telegramNotificationChannel: str | None = Field(default=None, max_length=100)


class ProviderProfilePatch(RequestModel):
    name: str | None = Field(default=None, max_length=180)
    phone: str | None = Field(default=None, max_length=32)
    telegram: str | None = Field(default=None, max_length=180)
    city: str | None = Field(default=None, max_length=180)
    vehicle: str | None = Field(default=None, max_length=180)
    vehicleMake: str | None = Field(default=None, max_length=100)
    vehicleModel: str | None = Field(default=None, max_length=100)
    plate: str | None = Field(default=None, max_length=30)
    specialties: list[Literal["tow", "battery", "wheel", "fuel", "lockout", "mechanic"]] = Field(min_length=1, max_length=6)
    serviceRadiusKm: int = Field(default=15, ge=1, le=100)
    location: Coordinates | None = None


class PresencePatch(RequestModel):
    status: Literal["online", "offline", "busy"]
    location: Coordinates | None = None


class OfferAccept(RequestModel):
    providerId: str | None = Field(default=None, max_length=120)
    proposedPrice: float | None = Field(default=None, gt=0, le=1000000)
    partnerProposedPrice: float | None = Field(default=None, gt=0, le=1000000)
    priceNote: str | None = Field(default=None, max_length=500)
    partnerPriceNote: str | None = Field(default=None, max_length=500)


class StatusPatch(RequestModel):
    status: str = Field(min_length=1, max_length=40)


class RolePatch(RequestModel):
    role: Literal["customer", "provider"] | None = None
    preferredRole: Literal["customer", "provider"] | None = None


def validated(model, payload: dict) -> dict:
    try:
        return model.model_validate(payload).model_dump(exclude_unset=True)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_input=False, include_context=False)) from exc


def request_schema(model) -> dict:
    """Document the same DTO while keeping authentication before body errors."""
    schema = model.model_json_schema()
    definitions = schema.pop("$defs", {})
    def expand(value):
        if isinstance(value, list):
            return [expand(item) for item in value]
        if isinstance(value, dict):
            if "$ref" in value:
                return expand(definitions[value["$ref"].rsplit("/", 1)[-1]])
            return {key: expand(item) for key, item in value.items()}
        return value
    return {"requestBody": {"required": True, "content": {"application/json": {"schema": expand(schema)}}}}
