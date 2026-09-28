import pytest

from bot.service_details import ServiceDetailsValidationError, validate_service_details


@pytest.mark.parametrize(
    ("service", "answers"),
    [
        ("tow", {"incident": "breakdown", "mobility": "rolls"}),
        ("battery", {"symptom": "silent", "help": "jump"}),
        ("wheel", {"damage": "one", "spare": "yes"}),
        ("fuel", {"fuelType": "diesel", "amount": "5"}),
        ("lockout", {"keySituation": "inside", "occupants": "none"}),
        ("mechanic", {"issue": "overheating", "mobility": "stopped"}),
    ],
)
def test_accepts_complete_service_details(service, answers):
    result = validate_service_details(service, {"version": 1, "service": service, "answers": answers})
    assert result["answers"] == answers


def test_accident_requires_injury_answer():
    with pytest.raises(ServiceDetailsValidationError, match="injuries"):
        validate_service_details(
            "tow",
            {"version": 1, "service": "tow", "answers": {"incident": "accident", "mobility": "locked"}},
        )


def test_rejects_details_for_a_different_service():
    with pytest.raises(ServiceDetailsValidationError, match="mismatch"):
        validate_service_details(
            "fuel",
            {"version": 1, "service": "wheel", "answers": {"fuelType": "diesel", "amount": "5"}},
        )
