"""Tests for closed alpha account seeding."""

from __future__ import annotations

import json
from pathlib import Path

from bot.alpha_accounts import (
    ALPHA_PROVIDERS,
    build_credential_bundle,
    build_provider_row,
    merge_account_env_lists,
    seed_alpha_accounts,
    upsert_alpha_providers,
)
from bot.api_deps import password_matches
from bot import order_store


def test_build_provider_row_is_offline_verified_alpha(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(order_store, "_default_provider_store_path", lambda: tmp_path / "providers.json")
    row = build_provider_row(ALPHA_PROVIDERS[0])
    assert row["status"] == "offline"
    assert row["verificationStatus"] == "verified"
    assert row["alphaTest"] is True
    assert row["excludeFromAnalytics"] is True
    assert row["providerKind"] == "dispatch"
    assert "[TEST]" in row["name"]
    assert row["city"] == "Ужгород"


def test_seed_alpha_accounts_writes_gitignored_credentials(tmp_path: Path, monkeypatch) -> None:
    store = tmp_path / "providers.json"
    creds = tmp_path / "alpha-credentials.local.json"
    monkeypatch.setattr(order_store, "_default_provider_store_path", lambda: store)
    monkeypatch.setattr(order_store, "_should_use_sql_store", lambda *_a, **_k: False)

    result = seed_alpha_accounts(credentials_path=creds, store_path=store)
    assert creds.is_file()
    payload = json.loads(creds.read_text(encoding="utf-8"))
    assert len(payload["accounts"]) == 5
    assert result["providers"]["totalAlpha"] == 4
    assert all(item["exists"] for item in result["statuses"].values())
    assert all(item["status"] == "offline" for item in result["statuses"].values())

    # Passwords verify against hashes
    for account in result["providerAccounts"]:
        username = account["username"]
        assert password_matches(account, result["plaintext"][username])


def test_upsert_is_idempotent(tmp_path: Path, monkeypatch) -> None:
    store = tmp_path / "providers.json"
    monkeypatch.setattr(order_store, "_default_provider_store_path", lambda: store)
    monkeypatch.setattr(order_store, "_should_use_sql_store", lambda *_a, **_k: False)
    providers = [build_provider_row(spec) for spec in ALPHA_PROVIDERS]
    first = upsert_alpha_providers(providers, store_path=store)
    second = upsert_alpha_providers(providers, store_path=store)
    assert first["added"] == 4
    assert second["added"] == 0
    assert second["updated"] == 4
    loaded = order_store.load_providers(store)
    assert sum(1 for item in loaded if item.get("alphaTest")) == 4


def test_merge_account_env_lists_keeps_existing_and_adds_alpha() -> None:
    existing = json.dumps([{"providerId": "provider-oleksandr", "username": "oleksandr", "password": "x"}])
    bundle = build_credential_bundle({"alpha-tow-01": "tow-pass", "alpha-dispatcher": "disp-pass"})
    merged = json.loads(merge_account_env_lists(existing, bundle["providerAccounts"], id_keys=("providerId", "username", "id")))
    ids = {item.get("providerId") or item.get("username") for item in merged}
    assert "provider-oleksandr" in ids
    assert "alpha-tow-01" in ids
