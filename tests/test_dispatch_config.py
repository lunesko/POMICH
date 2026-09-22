from bot.dispatch_config import (
    DISPATCH_WAVE1_SIZE,
    DISPATCH_WAVE2_SIZE,
    initial_radius_km_for_service,
    search_radius_steps_for_service,
    wave_batch_size,
)


def test_service_initial_radii_match_alpha_spec():
    assert initial_radius_km_for_service("battery") == 10
    assert initial_radius_km_for_service("wheel") == 10
    assert initial_radius_km_for_service("fuel") == 15
    assert initial_radius_km_for_service("lockout") == 15
    assert initial_radius_km_for_service("tow") == 30
    assert initial_radius_km_for_service("mechanic") == 20
    assert initial_radius_km_for_service("unknown") == 20


def test_search_radius_steps_expand_from_service_initial():
    wheel_steps = search_radius_steps_for_service("wheel")
    assert wheel_steps[0] == 10
    assert wheel_steps[-1] >= 40
    tow_steps = search_radius_steps_for_service("tow")
    assert tow_steps[0] == 30
    assert tow_steps[-1] >= 90


def test_wave_batch_sizes():
    assert wave_batch_size(1) == DISPATCH_WAVE1_SIZE
    assert wave_batch_size(2) == DISPATCH_WAVE2_SIZE
    assert wave_batch_size(3) == DISPATCH_WAVE2_SIZE
