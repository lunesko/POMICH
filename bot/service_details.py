from __future__ import annotations

from typing import Any, Dict


SERVICE_DETAIL_RULES: Dict[str, Dict[str, set[str]]] = {
    "tow": {
        "incident": {"breakdown", "accident", "relocation"},
        "mobility": {"rolls", "locked", "unknown"},
    },
    "battery": {
        "symptom": {"silent", "clicks", "cranks", "electric"},
        "help": {"jump", "replace", "diagnose"},
    },
    "wheel": {
        "damage": {"one", "multiple", "unknown"},
        "spare": {"yes", "no", "unknown"},
    },
    "fuel": {
        "fuelType": {"petrol95", "petrol98", "diesel", "lpg", "unknown"},
        "amount": {"5", "10", "agree"},
    },
    "lockout": {
        "keySituation": {"inside", "lost", "broken"},
        "occupants": {"none", "adult", "childPet"},
    },
    "mechanic": {
        "issue": {"overheating", "fluid", "electrical", "noise", "other"},
        "mobility": {"drives", "stopped", "unsafe"},
    },
}


class ServiceDetailsValidationError(ValueError):
    pass


def validate_service_details(service: str, value: Any) -> dict:
    rules = SERVICE_DETAIL_RULES.get(str(service or "").strip().lower())
    if rules is None:
        raise ServiceDetailsValidationError("unsupported_service")
    if not isinstance(value, dict):
        raise ServiceDetailsValidationError("service_details_required")
    if value.get("version") != 1:
        raise ServiceDetailsValidationError("service_details_version_invalid")
    if value.get("service") != service:
        raise ServiceDetailsValidationError("service_details_mismatch")
    answers = value.get("answers")
    if not isinstance(answers, dict):
        raise ServiceDetailsValidationError("service_details_answers_required")

    required = dict(rules)
    if service == "tow" and answers.get("incident") == "accident":
        required["injuries"] = {"yes", "no"}

    for field, allowed in required.items():
        if answers.get(field) not in allowed:
            raise ServiceDetailsValidationError(f"service_detail_invalid:{field}")

    return {
        "version": 1,
        "service": service,
        "answers": {key: str(answers[key]) for key in required},
    }
