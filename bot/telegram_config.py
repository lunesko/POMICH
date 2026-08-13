"""Telegram two-bot registry: customer (@pomich_ua_bot) and provider (@pomich_help_bot)."""

from __future__ import annotations

import os
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

TelegramBotKind = Literal["customer", "provider"]

_BOT_KINDS: tuple[TelegramBotKind, ...] = ("customer", "provider")

_DEFAULT_USERNAMES: dict[TelegramBotKind, str] = {
    "customer": "pomich_ua_bot",
    "provider": "pomich_help_bot",
}


@dataclass(frozen=True)
class TelegramBotConfig:
    kind: TelegramBotKind
    username: str
    token: str
    web_app_url: str


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_local_env(path: Path | None = None) -> None:
    env_path = path or (_project_root() / ".env")
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(name, value)


def normalize_telegram_bot_kind(value: str | None) -> TelegramBotKind | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"customer", "client", "ua"}:
        return "customer"
    if normalized in {"provider", "partner", "help"}:
        return "provider"
    return None


def _is_public_https_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urllib.parse.urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        return False
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return False
    if host.endswith(".local"):
        return False
    return True


def get_base_web_app_url() -> str | None:
    load_local_env()
    url = (os.getenv("WEB_APP_URL") or os.getenv("VITE_WEB_APP_URL") or "").strip()
    return url if _is_public_https_url(url) else None


def _legacy_bot_token() -> str | None:
    """Backward-compatible local fallback only. Never use VITE_ tokens in new code paths."""
    load_local_env()
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    if token:
        return token
    # Legacy local/dev only — keep reading but never document as preferred.
    return (os.getenv("VITE_TELEGRAM_BOT_TOKEN") or "").strip() or None


def _token_for_kind(kind: TelegramBotKind) -> str | None:
    load_local_env()
    if kind == "customer":
        dedicated = (os.getenv("TELEGRAM_CUSTOMER_BOT_TOKEN") or "").strip()
    else:
        dedicated = (os.getenv("TELEGRAM_PROVIDER_BOT_TOKEN") or "").strip()
    if dedicated:
        return dedicated
    return _legacy_bot_token()


def _username_for_kind(kind: TelegramBotKind) -> str:
    load_local_env()
    if kind == "customer":
        configured = (os.getenv("TELEGRAM_CUSTOMER_BOT_USERNAME") or "").strip().lstrip("@")
    else:
        configured = (os.getenv("TELEGRAM_PROVIDER_BOT_USERNAME") or "").strip().lstrip("@")
    return configured or _DEFAULT_USERNAMES[kind]


def _append_web_app_params(base: str, *, role: TelegramBotKind, tg_bot: TelegramBotKind) -> str:
    parsed = urllib.parse.urlparse(base)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    query["role"] = [role]
    query["tgBot"] = [tg_bot]
    new_query = urllib.parse.urlencode(query, doseq=True)
    return urllib.parse.urlunparse(parsed._replace(query=new_query))


def _web_app_url_for_kind(kind: TelegramBotKind) -> str | None:
    load_local_env()
    if kind == "customer":
        dedicated = (os.getenv("TELEGRAM_CUSTOMER_WEB_APP_URL") or "").strip()
    else:
        dedicated = (os.getenv("TELEGRAM_PROVIDER_WEB_APP_URL") or "").strip()
    if _is_public_https_url(dedicated):
        return dedicated

    base = get_base_web_app_url()
    if not base:
        return None
    return _append_web_app_params(base, role=kind, tg_bot=kind)


def get_telegram_bot_token(kind: TelegramBotKind) -> str | None:
    return _token_for_kind(kind)


def get_telegram_web_app_url(kind: TelegramBotKind) -> str | None:
    return _web_app_url_for_kind(kind)


def get_telegram_bot_config(kind: TelegramBotKind) -> TelegramBotConfig | None:
    token = _token_for_kind(kind)
    if not token:
        return None
    web_app_url = _web_app_url_for_kind(kind) or ""
    return TelegramBotConfig(
        kind=kind,
        username=_username_for_kind(kind),
        token=token,
        web_app_url=web_app_url,
    )


def get_telegram_bot_configs() -> list[TelegramBotConfig]:
    configs: list[TelegramBotConfig] = []
    seen_tokens: set[str] = set()
    for kind in _BOT_KINDS:
        config = get_telegram_bot_config(kind)
        if config is None:
            continue
        # When only TELEGRAM_BOT_TOKEN is set, expose a single customer fallback config
        # unless a dedicated provider token exists (or same legacy token is intentionally reused).
        if config.token in seen_tokens and kind == "provider":
            customer = get_telegram_bot_config("customer")
            provider_dedicated = bool((os.getenv("TELEGRAM_PROVIDER_BOT_TOKEN") or "").strip())
            if customer and customer.token == config.token and not provider_dedicated:
                # Single-token local mode: still expose provider kind so initData can verify,
                # but polling may dedupe — keep both configs for verification.
                pass
        seen_tokens.add(config.token)
        configs.append(config)
    return configs


def get_configured_token() -> str | None:
    """Preferred token for legacy single-bot call sites: customer first, then provider, then legacy."""
    for kind in _BOT_KINDS:
        token = _token_for_kind(kind)
        if token:
            return token
    return None


def any_telegram_bot_configured() -> bool:
    return bool(get_telegram_bot_configs())


def telegram_webhook_path(kind: TelegramBotKind) -> str:
    return f"/telegram/{kind}/webhook"


def telegram_webhook_url(kind: TelegramBotKind, *, origin: str | None = None) -> str | None:
    base = (origin or get_base_web_app_url() or "").rstrip("/")
    if not base:
        return None
    return f"{base}/api{telegram_webhook_path(kind)}"
