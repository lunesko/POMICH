"""Exercise deploy preflight without SSH/network access or real credentials."""
import os
from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]


def check_settings(overrides=None, empty=False):
    env = {k: v for k, v in os.environ.items() if not k.startswith('POMICH_')}
    if not empty:
        env.update(POMICH_SSH_HOST='example.invalid', POMICH_SSH_USER='deploy',
                   POMICH_SSH_KNOWN_HOSTS='synthetic-host-key',
                   POMICH_SSH_PRIVATE_KEY='SYNTHETIC-SECRET-NOT-A-REAL-KEY',
                   POMICH_DEPLOY_SHA='a' * 40)
    env.update(overrides or {})
    return subprocess.run(['bash', 'scripts/deploy_github_actions.sh', '--check'],
                          cwd=ROOT, env=env, text=True, capture_output=True, timeout=5)


def test_missing_settings_are_reported_together_without_network():
    result = check_settings(empty=True)
    assert result.returncode == 1
    for name in ('POMICH_SSH_HOST', 'POMICH_SSH_USER', 'POMICH_SSH_KNOWN_HOSTS',
                 'POMICH_SSH_PRIVATE_KEY'):
        assert name in result.stderr


def test_check_mode_does_not_connect_to_unreachable_server_or_print_key():
    result = check_settings()
    assert result.returncode == 0, result.stderr
    assert 'SSH access not tested' in result.stdout
    assert 'SYNTHETIC-SECRET' not in result.stdout + result.stderr


@pytest.mark.parametrize('port', ['0', '65536', 'abc', '99999999999999999'])
def test_invalid_ports_fail_before_network(port):
    result = check_settings({'POMICH_SSH_PORT': port})
    assert result.returncode == 1
    assert '1..65535' in result.stderr


def test_password_fallback_can_pass_preflight_without_sshpass_installed():
    result = check_settings({'POMICH_SSH_PRIVATE_KEY': '',
                             'POMICH_SSH_PASSWORD': 'synthetic-password'})
    assert result.returncode == 0, result.stderr
    assert 'synthetic-password' not in result.stdout + result.stderr


def test_remote_directory_cannot_be_root():
    assert check_settings({'POMICH_REMOTE_DIR': '/'}).returncode == 1
