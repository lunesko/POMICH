from ssh_common import run, ssh_connect

ssh = ssh_connect()
try:
    for cmd in [
        "curl -s -w '\\nHTTP:%{http_code}' -X POST http://127.0.0.1:8000/api/orders/PM-20260812135437977284/dispatch/retry",
        "curl -s http://127.0.0.1:8000/api/orders/PM-20260812135437977284 | head -c 600",
        "docker exec pomich-postgres psql -U pomich -d pomich -c \"SELECT id, status, payload->>'dispatchState' FROM orders WHERE status='searching';\"",
    ]:
        _, out, err = run(ssh, cmd)
        print("===", cmd[:70], "===")
        print(out or err or "(empty)")
finally:
    ssh.close()
