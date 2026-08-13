#!/usr/bin/env python3
"""Expand settlements on prod (OSM build) and import providers for new ones."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
REMOTE_DIR = os.environ.get("POMICH_REMOTE_DIR", "/opt/pomich")
HOST = os.environ.get("POMICH_SSH_HOST", "157.173.101.252")
USER = os.environ.get("POMICH_SSH_USER", "root")

# Curated additions when OSM build is slow/unavailable (free UA, not occupied).
EXTRA_SETTLEMENTS: list[dict] = [
    {"id": "brovary", "name": "Бровари", "oblast": "Київська", "type": "city", "center": {"lat": 50.5111, "lng": 30.7900}, "bbox": [50.48, 30.75, 50.54, 30.83]},
    {"id": "irpin", "name": "Ірпінь", "oblast": "Київська", "type": "city", "center": {"lat": 50.5219, "lng": 30.2506}, "bbox": [50.49, 30.21, 50.55, 30.29]},
    {"id": "bucha", "name": "Буча", "oblast": "Київська", "type": "city", "center": {"lat": 50.5433, "lng": 30.2125}, "bbox": [50.52, 30.18, 50.57, 30.25]},
    {"id": "vyshhorod", "name": "Вишгород", "oblast": "Київська", "type": "city", "center": {"lat": 50.5833, "lng": 30.4833}, "bbox": [50.55, 30.44, 50.62, 30.53]},
    {"id": "fastiv", "name": "Фастів", "oblast": "Київська", "type": "city", "center": {"lat": 50.0769, "lng": 29.9172}, "bbox": [50.05, 29.88, 50.10, 29.96]},
    {"id": "boryspil", "name": "Бориспіль", "oblast": "Київська", "type": "city", "center": {"lat": 50.3527, "lng": 30.9310}, "bbox": [50.32, 30.89, 50.38, 30.97]},
    {"id": "obukhiv", "name": "Обухів", "oblast": "Київська", "type": "city", "center": {"lat": 50.1069, "lng": 30.6264}, "bbox": [50.08, 30.59, 50.13, 30.66]},
    {"id": "vasylkiv", "name": "Васильків", "oblast": "Київська", "type": "city", "center": {"lat": 49.8389, "lng": 30.3153}, "bbox": [49.81, 30.28, 49.87, 30.35]},
    {"id": "kovel", "name": "Ковель", "oblast": "Волинська", "type": "city", "center": {"lat": 51.2089, "lng": 24.7078}, "bbox": [51.18, 24.67, 51.24, 24.75]},
    {"id": "novovolynsk", "name": "Нововолинськ", "oblast": "Волинська", "type": "city", "center": {"lat": 51.0939, "lng": 24.1636}, "bbox": [51.06, 24.12, 51.13, 24.21]},
    {"id": "drohobych", "name": "Дрогобич", "oblast": "Львівська", "type": "city", "center": {"lat": 49.3497, "lng": 23.5056}, "bbox": [49.32, 23.47, 49.38, 23.54]},
    {"id": "stryi", "name": "Стрий", "oblast": "Львівська", "type": "city", "center": {"lat": 49.2622, "lng": 23.8561}, "bbox": [49.23, 23.82, 49.29, 23.89]},
    {"id": "chervonohrad", "name": "Червоноград", "oblast": "Львівська", "type": "city", "center": {"lat": 50.3911, "lng": 24.1511}, "bbox": [50.36, 24.11, 50.42, 24.19]},
    {"id": "kremenchuk", "name": "Кременчук", "oblast": "Полтавська", "type": "city", "center": {"lat": 49.0658, "lng": 33.4206}, "bbox": [49.03, 33.38, 49.10, 33.46]},
    {"id": "kamyanske", "name": "Кам'янське", "oblast": "Дніпропетровська", "type": "city", "center": {"lat": 48.5167, "lng": 34.6167}, "bbox": [48.48, 34.58, 48.55, 34.65]},
    {"id": "nikopol", "name": "Нікополь", "oblast": "Дніпропетровська", "type": "city", "center": {"lat": 47.5681, "lng": 34.3964}, "bbox": [47.54, 34.36, 47.60, 34.43]},
    {"id": "pavlohrad", "name": "Павлоград", "oblast": "Дніпропетровська", "type": "city", "center": {"lat": 48.5342, "lng": 35.8708}, "bbox": [48.50, 35.83, 48.57, 35.91]},
    {"id": "kamianets-podilskyi", "name": "Кам'янець-Подільський", "oblast": "Хмельницька", "type": "city", "center": {"lat": 48.6845, "lng": 26.5856}, "bbox": [48.65, 26.55, 48.72, 26.62]},
    {"id": "shepetivka", "name": "Шепетівка", "oblast": "Хмельницька", "type": "city", "center": {"lat": 50.1856, "lng": 27.0656}, "bbox": [50.16, 27.03, 50.21, 27.10]},
    {"id": "konotop", "name": "Конотоп", "oblast": "Сумська", "type": "city", "center": {"lat": 51.2403, "lng": 33.2028}, "bbox": [51.21, 33.16, 51.27, 33.24]},
    {"id": "shostka", "name": "Шостка", "oblast": "Сумська", "type": "city", "center": {"lat": 51.8739, "lng": 33.4697}, "bbox": [51.84, 33.43, 51.90, 33.51]},
    {"id": "okhtyrka", "name": "Охтирка", "oblast": "Сумська", "type": "city", "center": {"lat": 50.3103, "lng": 34.8989}, "bbox": [50.28, 34.86, 50.34, 34.94]},
    {"id": "uman", "name": "Умань", "oblast": "Черкаська", "type": "city", "center": {"lat": 48.7489, "lng": 30.2214}, "bbox": [48.72, 30.18, 48.78, 30.26]},
    {"id": "smila", "name": "Сміла", "oblast": "Черкаська", "type": "city", "center": {"lat": 49.2225, "lng": 31.8872}, "bbox": [49.19, 31.85, 49.25, 31.92]},
    {"id": "oleksandriia", "name": "Олександрія", "oblast": "Кіровоградська", "type": "city", "center": {"lat": 48.6697, "lng": 33.1153}, "bbox": [48.64, 33.08, 48.70, 33.15]},
    {"id": "svitlovodsk", "name": "Світловодськ", "oblast": "Кіровоградська", "type": "city", "center": {"lat": 49.0489, "lng": 33.2414}, "bbox": [49.02, 33.20, 49.08, 33.28]},
    {"id": "izmail", "name": "Ізмаїл", "oblast": "Одеська", "type": "city", "center": {"lat": 45.3511, "lng": 28.8361}, "bbox": [45.32, 28.80, 45.38, 28.87]},
    {"id": "chornomorsk", "name": "Чорноморськ", "oblast": "Одеська", "type": "city", "center": {"lat": 46.3014, "lng": 30.6531}, "bbox": [46.27, 30.61, 46.33, 30.69]},
    {"id": "yuzhne", "name": "Южне", "oblast": "Одеська", "type": "city", "center": {"lat": 46.6225, "lng": 31.1019}, "bbox": [46.59, 31.06, 46.65, 31.14]},
    {"id": "kolomyia", "name": "Коломия", "oblast": "Івано-Франківська", "type": "city", "center": {"lat": 48.5306, "lng": 25.0403}, "bbox": [48.50, 25.00, 48.56, 25.08]},
    {"id": "kalush", "name": "Калуш", "oblast": "Івано-Франківська", "type": "city", "center": {"lat": 49.0119, "lng": 24.3731}, "bbox": [48.98, 24.33, 49.04, 24.41]},
    {"id": "khmilnyk", "name": "Хмільник", "oblast": "Вінницька", "type": "city", "center": {"lat": 49.5597, "lng": 27.9572}, "bbox": [49.53, 27.92, 49.59, 28.00]},
    {"id": "zhmerynka", "name": "Жмеринка", "oblast": "Вінницька", "type": "city", "center": {"lat": 49.0372, "lng": 28.1125}, "bbox": [49.01, 28.07, 49.06, 28.15]},
    {"id": "khmelnyk", "name": "Хмельник", "oblast": "Вінницька", "type": "city", "center": {"lat": 49.5597, "lng": 27.9572}, "bbox": [49.53, 27.92, 49.59, 28.00]},
    {"id": "korosten", "name": "Коростень", "oblast": "Житомирська", "type": "city", "center": {"lat": 50.9597, "lng": 28.6386}, "bbox": [50.93, 28.60, 50.99, 28.68]},
    {"id": "berdychiv", "name": "Бердичів", "oblast": "Житомирська", "type": "city", "center": {"lat": 49.8947, "lng": 28.6025}, "bbox": [49.86, 28.56, 49.93, 28.64]},
    {"id": "varash", "name": "Вараш", "oblast": "Рівненська", "type": "city", "center": {"lat": 51.3539, "lng": 25.8328}, "bbox": [51.32, 25.79, 51.39, 25.87]},
    {"id": "dubno", "name": "Дубно", "oblast": "Рівненська", "type": "city", "center": {"lat": 50.4186, "lng": 25.7556}, "bbox": [50.39, 25.72, 50.45, 25.79]},
    {"id": "kostopil", "name": "Костопіль", "oblast": "Рівненська", "type": "city", "center": {"lat": 50.8789, "lng": 26.4519}, "bbox": [50.85, 26.41, 50.91, 26.49]},
    {"id": "nizhyn", "name": "Ніжин", "oblast": "Чернігівська", "type": "city", "center": {"lat": 51.0486, "lng": 31.8869}, "bbox": [51.02, 31.85, 51.08, 31.92]},
    {"id": "pryluky", "name": "Прилуки", "oblast": "Чернігівська", "type": "city", "center": {"lat": 50.5942, "lng": 32.3869}, "bbox": [50.56, 32.35, 50.63, 32.42]},
    {"id": "kremenets", "name": "Кременець", "oblast": "Тернопільська", "type": "city", "center": {"lat": 50.0969, "lng": 25.7247}, "bbox": [50.07, 25.69, 50.13, 25.76]},
    {"id": "chortkiv", "name": "Чортків", "oblast": "Тернопільська", "type": "city", "center": {"lat": 49.0172, "lng": 25.7986}, "bbox": [48.99, 25.76, 49.05, 25.84]},
    {"id": "mukacheve-smt", "name": "Міжгір'я", "oblast": "Закарпатська", "type": "town", "center": {"lat": 48.5236, "lng": 23.5053}, "bbox": [48.49, 23.47, 48.56, 23.54]},
    {"id": "khust", "name": "Хуст", "oblast": "Закарпатська", "type": "city", "center": {"lat": 48.1792, "lng": 23.2992}, "bbox": [48.15, 23.26, 48.21, 23.34]},
    {"id": "vynohradiv", "name": "Виноградів", "oblast": "Закарпатська", "type": "city", "center": {"lat": 48.1419, "lng": 23.0353}, "bbox": [48.11, 23.00, 48.17, 23.07]},
    {"id": "perechyn", "name": "Перечин", "oblast": "Закарпатська", "type": "town", "center": {"lat": 48.7369, "lng": 22.4769}, "bbox": [48.71, 22.44, 48.76, 22.51]},
    {"id": "svaliava", "name": "Свалява", "oblast": "Закарпатська", "type": "city", "center": {"lat": 48.5486, "lng": 22.9878}, "bbox": [48.52, 22.95, 48.58, 23.03]},
    {"id": "village-boyany", "name": "Бояни", "oblast": "Чернівецька", "type": "village", "center": {"lat": 48.2450, "lng": 25.7850}, "bbox": [48.22, 25.76, 48.27, 25.81]},
    {"id": "village-storozhynets", "name": "Сторожинець", "oblast": "Чернівецька", "type": "town", "center": {"lat": 48.1647, "lng": 25.7186}, "bbox": [48.14, 25.68, 48.19, 25.76]},
    {"id": "village-novoselytsia", "name": "Новоселиця", "oblast": "Чернівецька", "type": "town", "center": {"lat": 48.2175, "lng": 26.2653}, "bbox": [48.19, 26.23, 48.25, 26.30]},
    {"id": "lozova", "name": "Лозова", "oblast": "Харківська", "type": "city", "center": {"lat": 48.8894, "lng": 36.3175}, "bbox": [48.86, 36.28, 48.92, 36.36]},
    {"id": "izium", "name": "Ізium", "oblast": "Харківська", "type": "city", "center": {"lat": 49.2089, "lng": 37.2486}, "bbox": [49.18, 37.21, 49.24, 37.29]},
    {"id": "kupiansk", "name": "Куп'янськ", "oblast": "Харківська", "type": "city", "center": {"lat": 49.7103, "lng": 37.6153}, "bbox": [49.68, 37.58, 49.74, 37.65]},
    {"id": "village-petropavlivska", "name": "Петропавлівська Борщагівка", "oblast": "Київська", "type": "town", "center": {"lat": 50.4311, "lng": 30.3289}, "bbox": [50.41, 30.30, 50.45, 30.36]},
    {"id": "village-hostomel", "name": "Гостомель", "oblast": "Київська", "type": "town", "center": {"lat": 50.5689, "lng": 30.2650}, "bbox": [50.54, 30.23, 50.60, 30.30]},
    {"id": "village-vyshneve", "name": "Вишневе", "oblast": "Київська", "type": "town", "center": {"lat": 50.3892, "lng": 30.3708}, "bbox": [50.36, 30.34, 50.42, 30.40]},
    {"id": "village-slavutych", "name": "Славутич", "oblast": "Київська", "type": "city", "center": {"lat": 51.5225, "lng": 30.7531}, "bbox": [51.49, 30.72, 51.55, 30.79]},
    {"id": "village-kalynivka", "name": "Калинівка", "oblast": "Вінницька", "type": "town", "center": {"lat": 49.4536, "lng": 28.5264}, "bbox": [49.43, 28.49, 49.48, 28.56]},
    {"id": "village-ladyzhyn", "name": "Ладижин", "oblast": "Вінницька", "type": "city", "center": {"lat": 48.6847, "lng": 29.2369}, "bbox": [48.65, 29.20, 48.72, 29.27]},
    {"id": "village-mohyliv-podilskyi", "name": "Могилів-Подільський", "oblast": "Вінницька", "type": "city", "center": {"lat": 48.4419, "lng": 27.7986}, "bbox": [48.41, 27.76, 48.47, 27.84]},
    {"id": "village-koziatyn", "name": "Козятин", "oblast": "Вінницька", "type": "city", "center": {"lat": 49.7153, "lng": 28.8386}, "bbox": [49.68, 28.80, 49.75, 28.88]},
    {"id": "village-yahotyn", "name": "Яготин", "oblast": "Київська", "type": "city", "center": {"lat": 50.2736, "lng": 31.7625}, "bbox": [50.24, 31.72, 50.31, 31.80]},
    {"id": "village-pereiaslav", "name": "Пereiaslav", "oblast": "Київська", "type": "city", "center": {"lat": 50.0700, "lng": 31.4500}, "bbox": [50.04, 31.41, 50.10, 31.49]},
    {"id": "village-pereiaslav-khm", "name": "Переяслав", "oblast": "Київська", "type": "city", "center": {"lat": 50.0700, "lng": 31.4500}, "bbox": [50.04, 31.41, 50.10, 31.49]},
    {"id": "village-myrhorod", "name": "Миргород", "oblast": "Полтавська", "type": "city", "center": {"lat": 49.9669, "lng": 33.6086}, "bbox": [49.94, 33.57, 50.00, 33.65]},
    {"id": "village-lubny", "name": "Лубни", "oblast": "Полтавська", "type": "city", "center": {"lat": 50.0169, "lng": 33.0014}, "bbox": [49.99, 32.96, 50.05, 33.04]},
    {"id": "village-karlivka", "name": "Кarlivka", "oblast": "Полтавська", "type": "city", "center": {"lat": 49.4569, "lng": 35.1292}, "bbox": [49.43, 35.09, 49.49, 35.17]},
    {"id": "village-karlivka-ua", "name": "Кarlivka", "oblast": "Полтавська", "type": "city", "center": {"lat": 49.4569, "lng": 35.1292}, "bbox": [49.43, 35.09, 49.49, 35.17]},
    {"id": "karlivka", "name": "Кarlivka", "oblast": "Полтавська", "type": "city", "center": {"lat": 49.4569, "lng": 35.1292}, "bbox": [49.43, 35.09, 49.49, 35.17]},
    {"id": "lubny", "name": "Лубни", "oblast": "Полтавська", "type": "city", "center": {"lat": 50.0169, "lng": 33.0014}, "bbox": [49.99, 32.96, 50.05, 33.04]},
    {"id": "myrhorod", "name": "Миргород", "oblast": "Полтавська", "type": "city", "center": {"lat": 49.9669, "lng": 33.6086}, "bbox": [49.94, 33.57, 50.00, 33.65]},
    {"id": "pereiaslav", "name": "Переяслав", "oblast": "Київська", "type": "city", "center": {"lat": 50.0700, "lng": 31.4500}, "bbox": [50.04, 31.41, 50.10, 31.49]},
    {"id": "yahotyn", "name": "Яготин", "oblast": "Київська", "type": "city", "center": {"lat": 50.2736, "lng": 31.7625}, "bbox": [50.24, 31.72, 50.31, 31.80]},
    {"id": "koziatyn", "name": "Козятин", "oblast": "Вінницька", "type": "city", "center": {"lat": 49.7153, "lng": 28.8386}, "bbox": [49.68, 28.80, 49.75, 28.88]},
    {"id": "mohyliv-podilskyi", "name": "Могилів-Подільський", "oblast": "Вінницька", "type": "city", "center": {"lat": 48.4419, "lng": 27.7986}, "bbox": [48.41, 27.76, 48.47, 27.84]},
    {"id": "ladyzhyn", "name": "Ладижин", "oblast": "Вінницька", "type": "city", "center": {"lat": 48.6847, "lng": 29.2369}, "bbox": [48.65, 29.20, 48.72, 29.27]},
    {"id": "kalynivka", "name": "Калинівка", "oblast": "Вінницька", "type": "town", "center": {"lat": 49.4536, "lng": 28.5264}, "bbox": [49.43, 28.49, 49.48, 28.56]},
    {"id": "slavutych", "name": "Славутич", "oblast": "Київська", "type": "city", "center": {"lat": 51.5225, "lng": 30.7531}, "bbox": [51.49, 30.72, 51.55, 30.79]},
    {"id": "vyshneve", "name": "Вишневе", "oblast": "Київська", "type": "town", "center": {"lat": 50.3892, "lng": 30.3708}, "bbox": [50.36, 30.34, 50.42, 30.40]},
    {"id": "hostomel", "name": "Гостомель", "oblast": "Київська", "type": "town", "center": {"lat": 50.5689, "lng": 30.2650}, "bbox": [50.54, 30.23, 50.60, 30.30]},
    {"id": "petropavlivska-borshchahivka", "name": "Петропавлівська Борщагівка", "oblast": "Київська", "type": "town", "center": {"lat": 50.4311, "lng": 30.3289}, "bbox": [50.41, 30.30, 50.45, 30.36]},
    {"id": "kupiansk", "name": "Куп'янськ", "oblast": "Харківська", "type": "city", "center": {"lat": 49.7103, "lng": 37.6153}, "bbox": [49.68, 37.58, 49.74, 37.65]},
    {"id": "lozova", "name": "Лозова", "oblast": "Харківська", "type": "city", "center": {"lat": 48.8894, "lng": 36.3175}, "bbox": [48.86, 36.28, 48.92, 36.36]},
    {"id": "novoselytsia", "name": "Новоселиця", "oblast": "Чернівецька", "type": "town", "center": {"lat": 48.2175, "lng": 26.2653}, "bbox": [48.19, 26.23, 48.25, 26.30]},
    {"id": "storozhynets", "name": "Сторожинець", "oblast": "Чернівецька", "type": "town", "center": {"lat": 48.1647, "lng": 25.7186}, "bbox": [48.14, 25.68, 48.19, 25.76]},
    {"id": "mizhhiria", "name": "Міжгір'я", "oblast": "Закарпатська", "type": "town", "center": {"lat": 48.5236, "lng": 23.5053}, "bbox": [48.49, 23.47, 48.56, 23.54]},
]


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


def merge_local_settlements() -> tuple[list[str], int]:
    """Merge EXTRA into local settlements.json; return (new_ids, total)."""
    path = ROOT / "data" / "settlements.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    existing = payload.get("settlements") or []
    by_id = {str(s["id"]): s for s in existing if s.get("id")}
    before_ids = set(by_id)
    for item in EXTRA_SETTLEMENTS:
        sid = str(item["id"])
        if sid in by_id:
            by_id[sid] = {**by_id[sid], **item}
        else:
            by_id[sid] = item
    merged = sorted(by_id.values(), key=lambda x: (str(x.get("oblast") or ""), str(x.get("name") or "")))
    new_ids = [sid for sid in by_id if sid not in before_ids]
    payload["version"] = 2
    payload["description"] = "Ukraine settlements for directory parsing. Occupied coords excluded at import."
    payload["settlements"] = merged
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return new_ids, len(merged)


def run(ssh: paramiko.SSHClient, cmd: str, *, timeout: int = 900) -> tuple[str, int]:
    print(f"$ {cmd[:140]}")
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if out.strip():
        print(out[-2000:])
    if err.strip() and rc != 0:
        print("STDERR:", err[-800:])
    return out, rc


def ensure_app(ssh: paramiko.SSHClient) -> None:
    run(
        ssh,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --wait pomich-app",
        timeout=180,
    )


def api_count(ssh: paramiko.SSHClient) -> int:
    out, rc = run(
        ssh,
        "curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"",
        timeout=60,
    )
    if rc != 0:
        return 0
    try:
        return int((out.strip().splitlines() or ["0"])[-1])
    except ValueError:
        return 0


def main() -> int:
    new_ids, total_local = merge_local_settlements()
    print(f"Local settlements: {total_local}, new curated: {len(new_ids)}")

    password = load_password()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)

    # Upload settlements.json
    sftp = client.open_sftp()
    local_path = ROOT / "data" / "settlements.json"
    remote_path = f"{REMOTE_DIR}/data/settlements.json"
    sftp.put(str(local_path), remote_path)
    sftp.close()
    print(f"Uploaded settlements.json ({total_local} entries)")

    # Try OSM build on prod (may add more villages)
    run(
        client,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production "
        f"exec -T pomich-app python3 scripts/build_settlements.py",
        timeout=600,
    )

    # Get settlement count and IDs on prod
    out, _ = run(
        client,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
        f"python3 -c \"import json; from bot.settlements import load_settlements; s=load_settlements(); print(len(s)); "
        f"print(json.dumps([x['id'] for x in s]))\"",
        timeout=60,
    )
    lines = [ln.strip() for ln in out.strip().splitlines() if ln.strip()]
    prod_total = int(lines[0]) if lines else total_local
    all_ids = json.loads(lines[1]) if len(lines) > 1 else []
    original_26 = {
        "uzhhorod", "mukachevo", "beregove", "kyiv", "bila-tserkva", "vinnytsia", "dnipro",
        "zhytomyr", "zaporizhzhia", "ivano-frankivsk", "kryvyi-rih", "kropyvnytskyi", "lutsk",
        "lviv", "mykolaiv", "odesa", "poltava", "rivne", "sumy", "ternopil", "kharkiv",
        "kherson", "khmelnytskyi", "cherkasy", "chernivtsi", "chernihiv",
    }
    to_import = [sid for sid in all_ids if sid not in original_26]
    print(f"Prod settlements: {prod_total}, to import: {len(to_import)}")

    ensure_app(client)
    before = api_count(client)
    failed: list[str] = []
    imported_count = 0

    batch_size = 5
    for i in range(0, len(to_import), batch_size):
        batch = to_import[i : i + batch_size]
        ensure_app(client)
        city_args = " ".join(f"--city {c}" for c in batch)
        cmd = (
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production "
            f"exec -T pomich-app python3 scripts/import_ukraine_providers.py {city_args} --merge --delay 2"
        )
        out, rc = run(client, cmd, timeout=900)
        if rc != 0:
            failed.extend(batch)
            ensure_app(client)
        else:
            imported_count += len(batch)
        total = api_count(client)
        print(f"  batch {i // batch_size + 1}: total providers={total}")
        time.sleep(2)

    ensure_app(client)
    after = api_count(client)
    summary = {
        "settlementsTotal": prod_total,
        "newSettlementsImported": imported_count,
        "newSettlementIds": len(to_import),
        "providersBefore": before,
        "providersAfter": after,
        "failedBatches": failed,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    client.close()
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
