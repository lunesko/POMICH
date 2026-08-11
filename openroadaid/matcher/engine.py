from dataclasses import dataclass
from typing import List, Dict, Any


@dataclass
class Provider:
    id: str
    name: str
    location: Dict[str, float]
    capabilities: List[str]
    availability: float = 1.0


@dataclass
class Incident:
    id: str
    service_type: str
    location: Dict[str, float]


@dataclass
class MatchResult:
    provider_id: str
    score: float
    strategy: str


class Matcher:
    def __init__(self, strategy: str = "nearest") -> None:
        self.strategy = strategy

    def match(self, incident: Incident, providers: List[Provider]) -> List[MatchResult]:
        candidates = [p for p in providers if incident.service_type in p.capabilities and p.availability > 0]
        if not candidates:
            return []

        scored = []
        for provider in candidates:
            distance = self._distance(incident.location, provider.location)
            eta = max(1.0, distance / 35.0)
            score = self._score(incident, provider, eta)
            scored.append(MatchResult(provider.id, score, self.strategy))

        scored.sort(key=lambda item: item.score, reverse=True)
        return scored

    def _score(self, incident: Incident, provider: Provider, eta: float) -> float:
        if self.strategy == "nearest":
            return 100.0 / (1.0 + eta)
        if self.strategy == "weighted":
            return (provider.availability * 40.0) + (100.0 / (1.0 + eta))
        if self.strategy == "expected_ttr":
            return 100.0 / (1.0 + eta + (1.0 - provider.availability) * 2.0)
        return 100.0 / (1.0 + eta)

    def _distance(self, a: Dict[str, float], b: Dict[str, float]) -> float:
        return abs(a["lat"] - b["lat"]) + abs(a["lon"] - b["lon"])
