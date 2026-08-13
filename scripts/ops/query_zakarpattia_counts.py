#!/usr/bin/env python3
"""Query prod provider counts for Zakarpattia settlements."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
HOST = os.environ.get("POMICH_SSH_HOST", "157.173.101.252")
USER = os.environ.get("POMICH_SSH_USER", "root")


def load_password() -> str:
    password = os.environ.get("POMICH_SSH_PASSWORD", "").strip()
    if password:
        return password
    deploy_env = ROOT / ".env.deploy"
    if deploy_env.exists():
        for line in deploy_env.read_text(encoding="utf-8").splitlines():
            if line.startswith("POMICH_SSH_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    print("ERROR: set POMICH_SSH_PASSWORD")
    sys.exit(1)


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=load_password(), timeout=20)

    queries = [
        ("all", "http://127.0.0.1:8000/api/map/providers?scope=all"),
        ("city_uzhhorod", "http://127.0.0.1:8000/api/map/providers?city=%D0%A3%D0%B6%D0%B3%D0%BE%D1%80%D0%BE%D0%B4"),
        ("radius30_uzh", "http://127.0.0.1:8000/api/map/providers?lat=48.62&lng=22.29&radius_km=30"),
        ("mukachevo", "http://127.0.0.1:8000/api/map/providers?city=%D0%9C%D1%83%D0%BA%D0%B0%D1%87%D0%B5%D0%B2%D0%BE"),
        ("khust", "http://127.0.0.1:8000/api/map/providers?city=%D0%A5%D1%83%D1%81%D1%82"),
        ("beregove", "http://127.0.0.1:8000/api/map/providers?city=%D0%91%D0%B5%D1%80%D0%B5%D0%B3%D0%BE%D0%B2%D0%B5"),
        ("vynohradiv", "http://127.0.0.1:8000/api/map/providers?city=%D0%92%D0%B8%D0%BD%D0%BE%D0%B3%D1%80%D0%B0%D0%B4%D1%96%D0%B2"),
        ("svaliava", "http://127.0.0.1:8000/api/map/providers?city=%D0%A1%D0%B2%D0%B0%D0%BB%D1%8F%D0%B2%D0%B0"),
        ("perechyn", "http://127.0.0.1:8000/api/map/providers?city=%D0%9F%D0%B5%D1%80%D0%B5%D1%87%D0%B8%D0%BD"),
        ("oblast_zakarpattia", "http://127.0.0.1:8000/api/map/providers?oblast=%D0%97%D0%B0%D0%BA%D0%B0%D1%80%D0%BF%D0%B0%D1%82%D1%81%D1%8C%D0%BA%D0%B0"),
    ]

    results: dict[str, object] = {}
    for name, url in queries:
        cmd = f"curl -sf '{url}'"
        _, stdout, _ = client.exec_command(cmd, timeout=120)
        out = stdout.read().decode("utf-8", errors="replace")
        rc = stdout.channel.recv_exit_status()
        if rc != 0 or not out.strip():
            results[name] = {"count": 0, "error": f"rc={rc}"}
            continue
        data = json.loads(out)
        entry: dict[str, object] = {"count": len(data)}
        if name in ("city_uzhhorod", "radius30_uzh"):
            specs: dict[str, int] = {}
            for provider in data:
                for spec in provider.get("specialties") or []:
                    specs[str(spec)] = specs.get(str(spec), 0) + 1
            entry["specialties"] = specs
        results[name] = entry

    print(json.dumps(results, ensure_ascii=False, indent=2))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
