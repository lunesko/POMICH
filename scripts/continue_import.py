#!/usr/bin/env python3
import os, json, time, paramiko
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
password = os.environ.get("POMICH_SSH_PASSWORD") or [
    l.split("=", 1)[1].strip().strip('"').strip("'")
    for l in (ROOT / ".env.deploy").read_text(encoding="utf-8").splitlines()
    if l.startswith("POMICH_SSH_PASSWORD=")
][0]

OBLASTS = [
    "Чернівецька", "Рівненська", "Житомирська", "Вінницька", "Хмельницька",
    "Черкаська", "Кіровоградська", "Полтавська", "Сумська", "Чернігівська",
    "Київська", "Харківська", "Дніпропетровська", "Запорізька",
    "Миколаївська", "Херсонська", "Одеська",
]
RETRY_CITIES = ["ternopil", "ivano-frankivsk", "mukachevo", "uzhhorod"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("157.173.101.252", username="root", password=password, timeout=20)

def run(cmd, timeout=1800):
    print("$", cmd[:120])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    rc = o.channel.recv_exit_status()
    if out: print(out[-2500:])
    if err and rc: print("ERR:", err[-1000:])
    return rc, out

run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production up -d pomich-app")
time.sleep(10)
run("curl -sf http://127.0.0.1:8000/api/health || echo DOWN")
_, out = run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; print(len(load_providers()))\"")
start = int(out.strip().splitlines()[-1])
print("start", start)

for oblast in OBLASTS:
    t0 = time.time()
    rc, out = run(
        f"cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
        f"python3 scripts/import_ukraine_providers.py --oblast '{oblast}' --merge --delay 2.0"
    )
    _, out2 = run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; print(len(load_providers()))\"", timeout=60)
    try:
        cnt = int(out2.strip().splitlines()[-1])
    except Exception:
        run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production up -d pomich-app")
        time.sleep(12)
        _, out2 = run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; print(len(load_providers()))\"", timeout=60)
        cnt = int(out2.strip().splitlines()[-1])
    print(json.dumps({"oblast": oblast, "db": cnt, "sec": round(time.time()-t0,1)}, ensure_ascii=False))

for city in RETRY_CITIES:
    rc, out = run(
        f"cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
        f"python3 scripts/import_ukraine_providers.py --city {city} --merge --delay 2.0"
    )
    _, out2 = run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; print(len(load_providers()))\"", timeout=60)
    print(city, out2.strip().splitlines()[-1])

_, out = run("curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"")
api = out.strip().splitlines()[-1]
_, out = run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; from collections import Counter; p=load_providers(); print(len(p)); print(Counter(x.get('city') for x in p).most_common(20))\"")
print("FINAL api", api)
client.close()
