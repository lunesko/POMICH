from ssh_common import run, ssh_connect

ssh = ssh_connect()
try:
    for cmd in [
        "docker ps -a --filter name=pomich",
        "docker logs pomich-app --tail 40 2>&1",
        "cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production up -d pomich-app 2>&1 | tail -20",
        "sleep 15 && docker ps -a --filter name=pomich-app",
        "curl -sf http://127.0.0.1:8000/api/health || echo FAIL",
    ]:
        _, out, err = run(ssh, cmd, timeout=120)
        print("===", cmd[:70], "===")
        print(out or err or "(empty)")
        print()
finally:
    ssh.close()
