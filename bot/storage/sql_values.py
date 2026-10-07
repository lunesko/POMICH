import json
from typing import Any

def _json_safe_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _point(value: Any) -> tuple[float | None, float | None]:
    if not isinstance(value, dict):
        return None, None
    try:
        return float(value.get("lat")), float(value.get("lng"))
    except (TypeError, ValueError):
        return None, None


def _capability_index(value: Any) -> str:
    if not isinstance(value, list):
        return "|"
    cleaned = [str(item).strip().lower() for item in value if str(item).strip()]
    return "|" + "|".join(dict.fromkeys(cleaned)) + "|" if cleaned else "|"


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return _json_safe_copy(value if isinstance(value, dict) else {})
