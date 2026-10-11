from bot.pilot_policy import pickup_in_pilot_area, pilot_mode_enabled
from bot.order_store import load_providers


def test_pilot_area_and_mode(monkeypatch):
    monkeypatch.setenv("POMICH_PILOT_MODE", "true")
    assert pilot_mode_enabled()
    assert pickup_in_pilot_area(48.622, 22.3)
    assert not pickup_in_pilot_area(49.8397, 24.0297)
    monkeypatch.setenv("POMICH_PILOT_MODE", "false")
    assert not pilot_mode_enabled()


def test_pilot_does_not_seed_demo_providers(monkeypatch, tmp_path):
    monkeypatch.setenv("POMICH_PILOT_MODE", "true")
    assert load_providers(tmp_path / "missing-providers.json") == []
