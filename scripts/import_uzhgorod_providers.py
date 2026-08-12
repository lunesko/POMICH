#!/usr/bin/env python3
"""CLI: import Uzhgorod directory providers into POMICH store.

Usage:
  python scripts/import_uzhgorod_providers.py
  python scripts/import_uzhgorod_providers.py --seed-only
  python scripts/import_uzhgorod_providers.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bot.order_store import merge_directory_providers  # noqa: E402
from bot.provider_importer import import_uzhgorod_providers  # noqa: E402

FAKE_PHONE = "+380000000000"


def _verify_no_fake_phones(providers: list[dict]) -> list[str]:
    violations: list[str] = []
    for p in providers:
        phone = str(p.get("phone") or "")
        if phone == FAKE_PHONE:
            violations.append(f"{p.get('name')} ({p.get('id')})")
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Uzhgorod roadside providers into POMICH")
    parser.add_argument("--seed-only", action="store_true", help="Skip Overpass and use seed data only")
    parser.add_argument("--dry-run", action="store_true", help="Fetch/print counts without writing DB")
    args = parser.parse_args()

    result = import_uzhgorod_providers(prefer_osm=not args.seed_only, use_seed=args.seed_only)
    counts = result["counts"]
    print(f"Data source: {result['source']}")
    print(
        f"Fetched: OSM={counts['osm']}, seed={counts['seed']}, total={counts['total']}, "
        f"withPhone={counts['withPhone']}, directoryOnly={counts['directoryOnly']}"
    )

    violations = _verify_no_fake_phones(result["providers"])
    if violations:
        print(f"ERROR: {len(violations)} providers still have fake phone placeholder:")
        for v in violations[:5]:
            print(f"  - {v}")
        return 1
    print("Phone check: OK (no +380000000000 placeholders)")

    if args.dry_run:
        samples = []
        for p in result["providers"]:
            if p.get("phone"):
                samples.append({"name": p["name"], "phone": p["phone"], "address": p.get("address"), "specialties": p.get("specialties")})
                if len(samples) >= 5:
                    break
        print("Sample entries with phone:")
        print(json.dumps(samples, ensure_ascii=False, indent=2))
        return 0

    merge_result = merge_directory_providers(result["providers"])
    print(
        f"Stored providers: total={merge_result['total']}, directory={merge_result['directory']}, "
        f"added={merge_result['added']}, updated={merge_result['updated']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
