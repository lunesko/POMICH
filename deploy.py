"""
Deploy POMICH to production server via SSH.
Uploads project, builds with Docker Compose, configures Nginx.
"""
import os
import sys
import stat
import time
import paramiko
from pathlib import Path

HOST = os.environ.get("POMICH_SSH_HOST", "157.173.101.252")
USER = os.environ.get("POMICH_SSH_USER", "root")
PASSWORD = os.environ.get("POMICH_SSH_PASSWORD", "")
REMOTE_DIR = os.environ.get("POMICH_REMOTE_DIR", "/opt/pomich")
WEB_APP_BASE = "http://157.173.101.252:8000"

SKIP_DIRS = {
    "node_modules", ".git", "dist", "__pycache__", ".venv",
    ".mypy_cache", ".pytest_cache", ".vscode",
}
SKIP_FILES = {".env.deploy", "deploy.py"}


def ssh_connect():
    if not PASSWORD:
        print("ERROR: set POMICH_SSH_PASSWORD environment variable")
        sys.exit(1)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    return client


def run(ssh, cmd, check=True, timeout=300):
    print(f"  $ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace").strip()
    err = stderr.read().decode(errors="replace").strip()
    rc = stdout.channel.recv_exit_status()
    if out:
        print(f"    {out[:500]}")
    if err and rc != 0:
        print(f"    STDERR: {err[:500]}")
    if check and rc != 0:
        print(f"  [WARN] exit code {rc}")
    return out, err, rc


def upload_project(ssh):
    sftp = ssh.open_sftp()
    local_root = Path(__file__).parent.resolve()

    def ensure_remote_dir(remote_path):
        try:
            sftp.stat(remote_path)
        except FileNotFoundError:
            sftp.mkdir(remote_path)

    ensure_remote_dir(REMOTE_DIR)

    for root, dirs, files in os.walk(local_root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(root, local_root).replace("\\", "/")
        remote_base = REMOTE_DIR if rel == "." else f"{REMOTE_DIR}/{rel}"
        ensure_remote_dir(remote_base)

        for f in files:
            if f in SKIP_FILES:
                continue
            local_path = os.path.join(root, f)
            remote_path = f"{remote_base}/{f}"
            try:
                sftp.put(local_path, remote_path)
            except Exception as e:
                print(f"  [SKIP] {remote_path}: {e}")

    sftp.close()
    print(f"  Uploaded project to {REMOTE_DIR}")


def create_env_production(ssh):
    """Write production env only if missing — never clobber an existing configured file."""
    check, _, rc = run(ssh, f"test -f {REMOTE_DIR}/.env.production && grep -q POMICH_ENCRYPTION_KEY {REMOTE_DIR}/.env.production", check=False)
    if rc == 0:
        print("  .env.production already configured; skipping overwrite")
        return
    print("  WARNING: creating default .env.production — run server_ops.py deploy for full config")
    env_content = f"""VITE_APP_NAME=POMICH
VITE_APP_ENV=production
VITE_APP_VERSION=0.1.0
POMICH_RUNTIME=production
POMICH_ALLOW_HTTP_PILOT=true
POMICH_CORS_ORIGINS={WEB_APP_BASE}
POMICH_ADMIN_TOKEN=pomich-admin-secret-2026
POMICH_PROVIDER_TOKEN=pomich-provider-secret-2026
POMICH_CUSTOMER_SESSION_SECRET=pomich-session-secret-2026-long-random
POMICH_ADMIN_ACCOUNTS=[{{"username":"dispatcher","password":"admin-pomich-2026"}}]
POMICH_PROVIDER_ACCOUNTS=[{{"providerId":"provider-oleksandr","username":"oleksandr","password":"provider-pomich-2026"}}]
TELEGRAM_BOT_TOKEN=
TELEGRAM_MODE=polling
WEB_APP_URL={WEB_APP_BASE}/
POMICH_STORAGE_BACKEND=sql
POSTGRES_DB=pomich
POSTGRES_USER=pomich
POSTGRES_PASSWORD=pomich-db-pass-2026
DATABASE_URL=postgresql://pomich:pomich-db-pass-2026@postgres:5432/pomich
"""
    run(ssh, f"cat > {REMOTE_DIR}/.env.production << 'ENVEOF'\n{env_content}\nENVEOF")
    print("  Created .env.production")


def setup_nginx(ssh):
    # Disabled: POMICH uses IP:port only; do not add nginx vhosts on shared server.
    print("  Skipping Nginx (IP:port deploy only)")
    return
    
    nginx_conf = f"""server {{
    listen 80;
    server_name {DOMAIN};

    location / {{
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }}
}}
"""
    run(ssh, f"cat > /etc/nginx/sites-available/pomich << 'NGINXEOF'\n{nginx_conf}\nNGINXEOF")
    run(ssh, "ln -sf /etc/nginx/sites-available/pomich /etc/nginx/sites-enabled/pomich")
    run(ssh, "nginx -t")
    run(ssh, "systemctl reload nginx")
    print("  Nginx configured for POMICH")


def main():
    print("=== POMICH Deploy ===\n")

    print("1) Connecting to server...")
    ssh = ssh_connect()

    print("\n2) Checking Docker...")
    out, _, rc = run(ssh, "docker --version", check=False)
    if rc != 0:
        print("  Docker not found. Installing...")
        run(ssh, "curl -fsSL https://get.docker.com | sh")
        run(ssh, "systemctl enable docker && systemctl start docker")

    out, _, rc = run(ssh, "docker compose version", check=False)
    if rc != 0:
        print("  Docker Compose plugin not found. Installing...")
        run(ssh, "apt-get update && apt-get install -y docker-compose-plugin")

    print("\n3) Uploading project files...")
    upload_project(ssh)

    print("\n4) Creating .env.production...")
    create_env_production(ssh)

    print("\n5) Making start.sh executable...")
    run(ssh, f"chmod +x {REMOTE_DIR}/start.sh")

    print("\n6) Building and starting containers (keep postgres up to avoid downtime)...")
    run(
        ssh,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d postgres",
        check=False,
    )
    run(ssh, f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production build pomich-app")
    run(
        ssh,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --no-deps --wait pomich-app",
        check=False,
    )

    print("\n7) Waiting for app health...")
    healthy = False
    for attempt in range(12):
        out, _, rc = run(ssh, "curl -sf http://127.0.0.1:8000/api/health", check=False)
        if rc == 0 and out:
            healthy = True
            break
        time.sleep(5)
    if not healthy:
        print("  [WARN] health check did not pass within 60s")

    print("\n8) Checking container status...")
    run(ssh, "docker ps --filter name=pomich --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'")

    print("\n9) Checking app health...")
    run(ssh, "curl -sf http://127.0.0.1:8000/api/health || echo 'HEALTH_CHECK_FAILED'", check=False)

    print("\n10) Importing Ukraine directory providers (inside container -> PostgreSQL)...")
    if os.environ.get("POMICH_SKIP_IMPORT") == "1":
        print("  Skipped (POMICH_SKIP_IMPORT=1)")
    else:
        run(
            ssh,
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production "
            f"exec -T pomich-app python3 scripts/import_ukraine_providers.py --all --merge --delay 1.5",
            check=False,
            timeout=7200,
        )

    print("\n11) Post-deploy verification...")
    run(ssh, "curl -sf http://127.0.0.1:8000/api/health || echo 'HEALTH_CHECK_FAILED'", check=False)
    run(
        ssh,
        "curl -sf http://127.0.0.1:8000/geo/ukraine-border.geojson | python3 -c "
        "\"import sys,json; d=json.load(sys.stdin); print(d.get('type','?'))\"",
        check=False,
    )
    run(
        ssh,
        "curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c "
        "\"import sys,json; p=json.load(sys.stdin); "
        "lats=sorted(set(round(x.get('location',{}).get('lat',0),1) for x in p)); "
        "print(f'providers={len(p)} cities={len(lats)}')\"",
        check=False,
    )

    print("\n12) Skipping Nginx/SSL (use WEB_APP_BASE IP:port + polling bot)")

    ssh.close()

    print(f"\n{'='*50}")
    print(f"Deploy complete!")
    print(f"App URL: http://{HOST}:8000")
    print(f"App base: {WEB_APP_BASE}/")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
