from scripts.ops import telegram_set_webhooks


def _set_two_bot_env(monkeypatch, *, same_tokens: bool = False) -> None:
    customer_token = "111:customer-secret"
    provider_token = customer_token if same_tokens else "222:provider-secret"
    monkeypatch.setenv("TELEGRAM_CUSTOMER_BOT_USERNAME", "pomich_ua_bot")
    monkeypatch.setenv("TELEGRAM_PROVIDER_BOT_USERNAME", "pomich_help_bot")
    monkeypatch.setenv("TELEGRAM_CUSTOMER_BOT_TOKEN", customer_token)
    monkeypatch.setenv("TELEGRAM_PROVIDER_BOT_TOKEN", provider_token)
    monkeypatch.setenv("TELEGRAM_CUSTOMER_WEB_APP_URL", "https://pomich.help/?role=customer&tgBot=customer")
    monkeypatch.setenv("TELEGRAM_PROVIDER_WEB_APP_URL", "https://pomich.help/?role=provider&tgBot=provider")
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "webhook-secret-value")
    monkeypatch.setenv("WEB_APP_URL", "https://pomich.help")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("VITE_TELEGRAM_BOT_TOKEN", raising=False)


def test_telegram_set_webhooks_dry_run_strict_prints_safe_preflight(monkeypatch, capsys) -> None:
    _set_two_bot_env(monkeypatch)

    code = telegram_set_webhooks.main(["--origin", "https://pomich.help", "--dry-run", "--strict"])

    output = capsys.readouterr().out
    assert code == 0
    assert "DRY RUN Configuring customer bot @pomich_ua_bot" in output
    assert "DRY RUN Configuring provider bot @pomich_help_bot" in output
    assert "https://pomich.help/api/telegram/customer/webhook" in output
    assert "https://pomich.help/api/telegram/provider/webhook" in output
    assert "secret_token: configured" in output
    assert "111:customer-secret" not in output
    assert "222:provider-secret" not in output
    assert "webhook-secret-value" not in output


def test_telegram_set_webhooks_strict_rejects_single_token_mode(monkeypatch, capsys) -> None:
    _set_two_bot_env(monkeypatch, same_tokens=True)

    code = telegram_set_webhooks.main(["--origin", "https://pomich.help", "--dry-run", "--strict"])

    output = capsys.readouterr().out
    assert code == 1
    assert "different customer/provider bot tokens" in output


def test_telegram_set_webhooks_requires_public_https_origin(monkeypatch, capsys) -> None:
    _set_two_bot_env(monkeypatch)

    code = telegram_set_webhooks.main(["--origin", "http://127.0.0.1:8443", "--dry-run"])

    output = capsys.readouterr().out
    assert code == 2
    assert "public HTTPS URL" in output
