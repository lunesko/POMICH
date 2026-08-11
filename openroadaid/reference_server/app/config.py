import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite://")
    protocol_version: str = os.getenv("PROTOCOL_VERSION", "0.1.0")
    server_version: str = os.getenv("SERVER_VERSION", "0.1.0")
    search_radius_steps_km: str = os.getenv("SEARCH_RADIUS_STEPS_KM", "10,20,40")
    offer_lifetime_seconds: int = int(os.getenv("OFFER_LIFETIME_SECONDS", "15"))
    api_key: str = os.getenv("API_KEY", "dev-key")
    provider_api_key: str = os.getenv("PROVIDER_API_KEY", "provider-key")
    dispatcher_api_key: str = os.getenv("DISPATCHER_API_KEY", "dispatcher-key")


settings = Settings()
