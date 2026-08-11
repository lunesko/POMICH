from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from matcher import Incident as MatcherIncident, Matcher, Provider as MatcherProvider
from app.db.models.provider import ProviderCapabilityModel, ProviderModel
from app.repositories.provider_repository import ProviderRepository
from app.utils import wkt_from_location


class MatchingService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = ProviderRepository(db)

    def search(self, incident_location: dict[str, float], radius_km: int, required_capabilities: list[str]) -> list[dict[str, Any]]:
        point_wkt = wkt_from_location(incident_location)
        providers = self.repository.list_eligible(point_wkt, radius_km, required_capabilities)
        if not providers:
            return []

        matcher = Matcher(strategy="nearest")
        incident = MatcherIncident(id="incident", service_type=required_capabilities[0].lower(), location=incident_location)
        candidates = [
            MatcherProvider(
                id=str(provider.id),
                name=provider.name,
                location={"lat": incident_location["lat"], "lon": incident_location["lon"]},
                capabilities=[cap.capability for cap in self.db.query(ProviderCapabilityModel).filter(ProviderCapabilityModel.provider_id == provider.id).all()],
                availability=provider.acceptance_rate or 0.5,
            )
            for provider in providers
        ]
        results = matcher.match(incident, candidates)
        return [{"provider_id": result.provider_id, "score": result.score} for result in results]
