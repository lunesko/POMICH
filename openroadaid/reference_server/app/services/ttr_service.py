from datetime import datetime, timezone


class TTRService:
    @staticmethod
    def compute(provider_arrived_at: datetime | None, incident_confirmed_at: datetime | None) -> int | None:
        if not provider_arrived_at or not incident_confirmed_at:
            return None
        return int((provider_arrived_at - incident_confirmed_at).total_seconds())
