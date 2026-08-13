#!/usr/bin/env python3
"""Retry failed settlement imports one at a time on prod."""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Reuse prod_import_cities helpers
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.ops.prod_import_cities import (  # noqa: E402
    CITIES as _unused,
    api_count,
    ensure_app,
    load_password,
    run,
)

import paramiko  # noqa: E402
import time  # noqa: E402

from scripts.ops.prod_import_cities import HOST, REMOTE_DIR, USER  # noqa: E402

FAILED = [
    "kalush", "kolomyia", "kovel", "novovolynsk", "zhmerynka", "kalynivka",
    "koziatyn", "ladyzhyn", "mohyliv-podilskyi", "khmelnyk", "khmilnyk",
    "kamyanske", "nikopol", "pavlohrad", "berdychiv", "korosten", "vynohradiv",
    "mizhhiria", "perechyn", "svaliava", "khust", "irpin", "boryspil", "brovary",
    "bucha", "vasylkiv", "vyshhorod", "vyshneve", "hostomel", "stryi",
    "chervonohrad", "izmail", "chornomorsk", "yuzhne", "karlivka", "kremenchuk",
    "lubny", "myrhorod", "varash", "dubno", "kostopil", "konotop", "okhtyrka",
    "shostka", "kremenets", "chortkiv", "lozova", "kamianets-podilskyi",
    "novoselytsia", "storozhynets", "nizhyn", "pryluky", "chernihiv",
]


def main() -> int:
    cities = sys.argv[1:] if len(sys.argv) > 1 else FAILED
    password = load_password()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)

    ensure_app(client)
    before = api_count(client)
    failed: list[str] = []
    ok: list[str] = []

    for city in cities:
        print(f"\n=== {city} ===")
        ensure_app(client)
        cmd = (
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production "
            f"exec -T pomich-app python3 scripts/import_ukraine_providers.py --city {city} --merge --delay 2"
        )
        _, rc = run(client, cmd, timeout=600)
        if rc != 0:
            failed.append(city)
            ensure_app(client)
        else:
            ok.append(city)
        print(f"  total={api_count(client)}")
        time.sleep(1)

    after = api_count(client)
    print(json.dumps({"before": before, "after": after, "ok": ok, "failed": failed}, ensure_ascii=False, indent=2))
    client.close()
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
