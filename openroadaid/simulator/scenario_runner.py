import json
import sys
from pathlib import Path
from typing import List, Dict, Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from matcher import Incident, Matcher, Provider


class ScenarioRunner:
    def __init__(self, output_dir: str = "simulator/out") -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def run(self, scenario: Dict[str, Any]) -> Dict[str, Any]:
        incident = Incident(
            id=scenario["incident"]["id"],
            service_type=scenario["incident"]["serviceType"],
            location=scenario["incident"]["location"],
        )
        providers = [
            Provider(
                id=item["id"],
                name=item["name"],
                location=item["location"],
                capabilities=item["capabilities"],
                availability=item.get("availability", 1.0),
            )
            for item in scenario["providers"]
        ]
        matcher = Matcher(strategy=scenario.get("strategy", "nearest"))
        results = matcher.match(incident, providers)
        report = {
            "incidentId": incident.id,
            "strategy": scenario.get("strategy", "nearest"),
            "results": [
                {"providerId": item.provider_id, "score": round(item.score, 2), "strategy": item.strategy}
                for item in results
            ],
        }
        self._write_report(report)
        return report

    def _write_report(self, report: Dict[str, Any]) -> None:
        path = self.output_dir / "benchmark.json"
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
