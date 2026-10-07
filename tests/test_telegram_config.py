from bot import telegram_config as config


def test_getters_do_not_reload_deleted_environment(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("TELEGRAM_PROVIDER_BOT_TOKEN=222:local-test\nWEB_APP_URL=https://pomich.help\n")
    monkeypatch.setenv("POMICH_LOAD_LOCAL_ENV", "1")
    monkeypatch.setattr(config, "_project_root", lambda: tmp_path)
    for name in ["TELEGRAM_PROVIDER_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "VITE_TELEGRAM_BOT_TOKEN", "WEB_APP_URL"]:
        monkeypatch.delenv(name, raising=False)
    assert config.get_telegram_bot_token("provider") is None
    config.load_local_env()
    assert config.get_telegram_bot_token("provider") == "222:local-test"
    monkeypatch.delenv("TELEGRAM_PROVIDER_BOT_TOKEN")
    assert config.get_telegram_bot_token("provider") is None


def test_local_env_never_overwrites_server_secret(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("TELEGRAM_PROVIDER_BOT_TOKEN=222:local-test\n")
    monkeypatch.setenv("POMICH_LOAD_LOCAL_ENV", "1")
    monkeypatch.setenv("TELEGRAM_PROVIDER_BOT_TOKEN", "222:server-test")
    config.load_local_env(env_file)
    assert config.get_telegram_bot_token("provider") == "222:server-test"
