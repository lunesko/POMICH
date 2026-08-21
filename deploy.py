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

def load_env_deploy():
    env_file = Path(__file__).parent / ".env.deploy"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

load_env_deploy()

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
    print(f"  $ {cmd}", flush=True)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    channel = stdout.channel
    channel.settimeout(timeout)
    try:
        out = stdout.read().decode(errors="replace").strip()
        err = stderr.read().decode(errors="replace").strip()
        rc = channel.recv_exit_status()
    except Exception as e:
        try:
            channel.close()
        except Exception:
            pass
        print(f"  [WARN] command timed out/failed after {timeout}s: {e}")
        return "", str(e), 1
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
    """Keep pomich.help vhost pointing at the app with a Mini App–friendly 502 retry page."""
    retry_html = """<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="2" />
  <title>POMICH · оновлення</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
      background:#0F172A;color:#F8FAFC;padding:24px;text-align:center}
    h1{font-size:1.25rem;margin:0 0 8px}
    p{margin:0;opacity:.75;font-size:.95rem}
  </style>
</head>
<body>
  <div>
    <h1>POMICH оновлюється</h1>
    <p>Зачекайте кілька секунд — сторінка відкриється сама.</p>
  </div>
  <script>setTimeout(function(){location.reload()},2000)</script>
</body>
</html>
"""
    nginx_conf = """server {
    listen 80;
    listen [::]:80;
    server_name pomich.help www.pomich.help;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
        allow all;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name pomich.help www.pomich.help;

    ssl_certificate /etc/letsencrypt/live/pomich.help/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pomich.help/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    error_page 502 503 504 = @pomich_retry;

    location @pomich_retry {
        default_type text/html;
        charset utf-8;
        add_header Cache-Control "no-store" always;
        add_header Retry-After 2 always;
        root /var/www/pomich;
        try_files /retry.html =502;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 3s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 25m;
    }
}
"""
    run(ssh, "mkdir -p /var/www/pomich", check=False)
    run(ssh, f"cat > /var/www/pomich/retry.html << 'HTMLEOF'\n{retry_html}\nHTMLEOF", check=False)
    run(ssh, f"cat > /etc/nginx/sites-available/pomich.help << 'NGINXEOF'\n{nginx_conf}\nNGINXEOF", check=False)
    run(ssh, "ln -sfn /etc/nginx/sites-available/pomich.help /etc/nginx/sites-enabled/pomich.help", check=False)
    out, err, rc = run(ssh, "nginx -t", check=False)
    if rc == 0:
        run(ssh, "systemctl reload nginx", check=False)
        print("  Nginx pomich.help updated (502 auto-retry)")
    else:
        print(f"  [WARN] nginx -t failed; left previous vhost in place ({err or out})")


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

    print("\n6) Building image while current container keeps serving...")
    run(
        ssh,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d postgres",
        check=False,
    )
    # Build first so recreate only swaps to an already-built image (shorter 502 window).
    run(
        ssh,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production build pomich-app",
        timeout=900,
    )
    print("\n6b) Recreating app container...")
    run(
        ssh,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --no-deps --wait pomich-app",
        check=False,
        timeout=300,
    )

    print("\n7) Waiting for app health...")
    healthy = False
    for attempt in range(18):
        out, _, rc = run(ssh, "curl -sf http://127.0.0.1:8000/api/health", check=False)
        if rc == 0 and out:
            healthy = True
            break
        time.sleep(5)
    if not healthy:
        print("  [WARN] health check did not pass within 90s")

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

    print("\n12) Ensuring nginx 502 auto-retry for Telegram Mini App...")
    setup_nginx(ssh)
    run(
        ssh,
        "curl -sf https://pomich.help/api/health || echo 'PUBLIC_HEALTH_FAILED'",
        check=False,
    )

    ssh.close()

    print(f"\n{'='*50}")
    print(f"Deploy complete!")
    print(f"App URL: https://pomich.help")
    print(f"Direct: http://{HOST}:8000")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
