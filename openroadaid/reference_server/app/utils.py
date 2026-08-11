from math import sin, cos, radians


def wkt_from_location(location: dict[str, float]) -> str:
    return f"POINT({location['lon']} {location['lat']})"
