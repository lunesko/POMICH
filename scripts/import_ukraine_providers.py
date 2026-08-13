#!/usr/bin/env python3
"""CLI: import directory providers for Ukraine settlements via OSM Overpass.

Examples:
  python scripts/import_ukraine_providers.py --city uzhhorod
  python scripts/import_ukraine_providers.py --city kyiv --city lviv
  python scripts/import_ukraine_providers.py --oblast Закарпатська
  python scripts/import_ukraine_providers.py --all --dry-run
  python scripts/import_ukraine_providers.py --all --merge
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bot.order_store import merge_directory_providers  # noqa: E402
from bot.provider_importer import import_ukraine_providers  # noqa: E402
from bot.settlements import load_settlements  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Ukraine roadside directory providers into POMICH")
    parser.add_argument("--city", action="append", dest="cities", help="Settlement id from data/settlements.json (repeatable)")
    parser.add_argument("--oblast", help="Import all settlements in oblast")
    parser.add_argument("--all", action="store_true", help="Import all known settlements (slow — Overpass rate limits apply)")
    parser.add_argument("--seed-only", action="store_true", help="Only Uzhgorod demo seeds (no OSM)")
    parser.add_argument("--no-osm", action="store_true", help="Skip OSM fetch")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between Overpass requests (default 2)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch/parse only — do not write providers store")
    parser.add_argument("--merge", action="store_true", help="Merge into providers store (default when not dry-run)")
    args = parser.parse_args()

    settlement_ids = args.cities
    if args.all:
        settlement_ids = [str(item.get("id")) for item in load_settlements()]
    if not settlement_ids and not args.oblast and not args.all:
        settlement_ids = ["uzhhorod"]

    result = import_ukraine_providers(
        settlement_ids=settlement_ids if not args.oblast else None,
        oblast=args.oblast,
        prefer_osm=not args.no_osm and not args.seed_only,
        use_seed=args.seed_only,
        delay_seconds=args.delay,
    )

    print(json.dumps({"perSettlement": result["perSettlement"], "counts": result["counts"]}, ensure_ascii=False, indent=2))

    if args.dry_run:
        print(f"Dry run: {result['counts']['total']} providers parsed, not stored.")
        return 0

    if args.merge or not args.dry_run:
        merge_result = merge_directory_providers(result["providers"])
        print(
            f"Stored: total={merge_result['total']}, directory={merge_result['directory']}, "
            f"added={merge_result['added']}, updated={merge_result['updated']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
