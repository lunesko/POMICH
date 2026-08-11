from matcher import Incident, Matcher, Provider


def test_nearest_match_prefers_closest_provider():
    incident = Incident(id="inc-1", service_type="towing", location={"lat": 10.0, "lon": 10.0})
    providers = [
        Provider(id="p1", name="Near", location={"lat": 10.1, "lon": 10.0}, capabilities=["towing"], availability=0.95),
        Provider(id="p2", name="Far", location={"lat": 12.0, "lon": 10.0}, capabilities=["towing"], availability=0.8),
    ]

    results = Matcher(strategy="nearest").match(incident, providers)
    assert results[0].provider_id == "p1"


def test_expected_ttr_strategy_uses_availability():
    incident = Incident(id="inc-2", service_type="battery", location={"lat": 0.0, "lon": 0.0})
    providers = [
        Provider(id="p1", name="Fast", location={"lat": 0.1, "lon": 0.0}, capabilities=["battery"], availability=0.65),
        Provider(id="p2", name="Reliable", location={"lat": 0.2, "lon": 0.0}, capabilities=["battery"], availability=0.92),
    ]

    results = Matcher(strategy="expected_ttr").match(incident, providers)
    assert results[0].provider_id == "p2"
