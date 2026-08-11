import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scenario_runner import ScenarioRunner


def main() -> None:
    parser = argparse.ArgumentParser(description="Run synthetic OpenRoadAid scenarios")
    parser.add_argument("--benchmark", action="store_true", help="Emit benchmark summary")
    args = parser.parse_args()

    scenarios_path = Path(__file__).with_name("synthetic_scenarios.json")
    scenarios = json.loads(scenarios_path.read_text(encoding="utf-8"))

    runner = ScenarioRunner()
    reports = [runner.run(scenario) for scenario in scenarios]

    if args.benchmark:
        print(json.dumps({"scenarios": len(reports), "reports": reports}, indent=2))
    else:
        print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()
