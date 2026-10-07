"""Validate the actual edge files using nginx -t and disposable TLS fixtures."""
from pathlib import Path
import shutil
import subprocess
import tempfile

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def check() -> None:
    nginx = shutil.which('nginx') or ('/usr/sbin/nginx' if Path('/usr/sbin/nginx').exists() else None)
    if not nginx:
        raise SystemExit('nginx is required; CI installs the Ubuntu package before this check.')
    with tempfile.TemporaryDirectory(prefix='pomich-nginx-check-') as temporary:
        root = Path(temporary)
        tls = root / 'tls'
        live = tls / 'live' / 'pomich.help'
        live.mkdir(parents=True)
        subprocess.run([
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=pomich.help', '-keyout', str(live / 'privkey.pem'),
            '-out', str(live / 'fullchain.pem'),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run([
            'openssl', 'genpkey', '-genparam', '-algorithm', 'DH',
            '-pkeyopt', 'group:ffdhe2048', '-out', str(tls / 'ssl-dhparams.pem'),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        (tls / 'options-ssl-nginx.conf').write_text('# Disposable certificate configuration for syntax checking.\n')
        # All routing, limits, CSP and response headers are copied unchanged. Only
        # certificate/include locations change; no production files are touched.
        edge = (PROJECT_ROOT / 'deploy/nginx/pomich.help.conf').read_text()
        (root / 'edge.conf').write_text(edge.replace('/etc/letsencrypt', str(tls)))
        shutil.copyfile(PROJECT_ROOT / 'deploy/nginx/pomich_upstream.conf', root / 'upstream.conf')
        config = root / 'nginx.conf'
        config.write_text(
            f'pid {root}/nginx.pid;\nerror_log stderr;\nevents {{}}\n'
            f'http {{ access_log off; include {root}/upstream.conf; include {root}/edge.conf; }}\n'
        )
        subprocess.run([nginx, '-t', '-p', str(root), '-c', str(config)], check=True)


if __name__ == '__main__':
    check()
