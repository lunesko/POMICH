"""Prevent the static-file edge policy diverging from the API policy."""
from pathlib import Path
import re

from bot.security_headers import _CSP


def test_nginx_policy_matches_backend_and_covers_overriding_locations():
    config = (Path(__file__).resolve().parent.parent / "deploy/nginx/pomich.help.conf").read_text()
    assert f'set $pomich_csp "{_CSP}";' in config
    assert "proxy_hide_header Content-Security-Policy;" in config
    # Nginx locations with their own add_header do not inherit server headers.
    for body in re.findall(r"location\s+[^\n]+\{(.*?)\n    }", config, re.S):
        if "add_header" in body:
            assert "add_header Content-Security-Policy $pomich_csp always;" in body
