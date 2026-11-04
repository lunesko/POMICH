"""Fixed-destination routing proxy; upstream URL is controlled by deployment."""
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from bot.routing import RouteResponse, route_geometry

router = APIRouter(tags=["routing"])


class RoutePoint(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fromPoint: RoutePoint
    toPoint: RoutePoint


@router.post("/routing/route", response_model=RouteResponse)
def route(payload: RouteRequest) -> RouteResponse:
    # Coordinates stay out of URL/access logs.
    return route_geometry(payload.fromPoint.model_dump(), payload.toPoint.model_dump())
