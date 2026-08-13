import os
import sys
import tempfile
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bot import runtime_store
from bot.order_store import (
    DispatchConflict,
    accept_offer,
    dispatch_order,
    load_offers,
    load_orders,
    load_providers,
    save_order,
    save_providers,
)


def _database_url() -> str:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is required for the PostGIS smoke test")
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def _wait_for_database(url: str) -> None:
    last_error: Exception | None = None
    for _ in range(45):
        try:
            engine = create_engine(url, future=True, pool_pre_ping=True)
            with engine.begin() as connection:
                connection.execute(text("SELECT 1"))
            engine.dispose()
            return
        except Exception as exc:  # pragma: no cover - only used around service startup.
            last_error = exc
            time.sleep(2)
    raise RuntimeError(f"PostGIS database did not become reachable: {last_error}") from last_error


def _provider(
    provider_id: str,
    lat: float,
    lng: float,
    specialties: list[str] | None = None,
    status: str = "online",
    verification_status: str = "verified",
    radius: int = 50,
) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    return {
        "id": provider_id,
        "name": provider_id,
        "rating": 4.8,
        "vehicle": "Service van",
        "plate": "TEST",
        "phone": "+380000000000",
        "telegram": "pomich_help_bot",
        "status": status,
        "etaMinutes": 10,
        "location": {"lat": lat, "lng": lng},
        "specialties": specialties or ["tow"],
        "serviceRadiusKm": radius,
        "verificationStatus": verification_status,
        "verification": {
            "identityDocument": True,
            "driverLicense": True,
            "vehicleRegistration": True,
            "serviceProof": True,
            "selfieCheck": True,
            "backgroundCheck": "passed",
        },
        "registeredAt": now,
        "profileUpdatedAt": now,
        "lastSeenAt": now,
        "lastLocationAt": now,
        "updatedAt": now,
    }


def main() -> None:
    url = _database_url()
    _wait_for_database(url)

    with tempfile.TemporaryDirectory(prefix="pomich-postgis-smoke-") as temp_dir:
        temp_path = Path(temp_dir)
        os.environ["POMICH_STORAGE_BACKEND"] = "sql"
        os.environ["DATABASE_URL"] = url
        os.environ["POMICH_ORDER_STORE_PATH"] = str(temp_path / "orders.json")
        os.environ["POMICH_PROVIDER_STORE_PATH"] = str(temp_path / "providers.json")
        os.environ["POMICH_OFFER_STORE_PATH"] = str(temp_path / "offers.json")
        os.environ["POMICH_CUSTOMER_STORE_PATH"] = str(temp_path / "customers.json")
        os.environ["POMICH_SESSION_STORE_PATH"] = str(temp_path / "sessions.json")

        runtime_store.reset_runtime_store_for_tests()
        for collection_name, empty_payload in [
            ("orders", []),
            ("offers", []),
            ("providers", []),
            ("customers", []),
            ("telegram_sessions", {}),
        ]:
            runtime_store.save_collection(collection_name, empty_payload)

        versions = [migration["version"] for migration in runtime_store.applied_schema_migrations()]
        assert versions == [
            "2026081101",
            "2026081102",
            "2026081103",
            "2026081104",
            "2026081201",
        ], versions

        save_providers(
            [
                _provider("p1", 50.4501, 30.5234),
                _provider("p2", 50.4503, 30.5236),
                _provider("wrong-service", 50.4501, 30.5234, ["fuel"]),
                _provider("offline", 50.4501, 30.5234, status="offline"),
                _provider("unverified", 50.4501, 30.5234, verification_status="pending"),
            ]
        )
        order = save_order({"service": "tow", "customerCoordinates": {"lat": 50.4502, "lng": 30.5235}})
        dispatched = dispatch_order(order["id"])
        offers = load_offers()

        assert dispatched["dispatchState"] == "OFFERS_SENT", dispatched
        assert dispatched["dispatchInfo"]["eligibleProviders"] == 2, dispatched["dispatchInfo"]
        assert {offer["providerId"] for offer in offers} == {"p1", "p2"}, offers

        def try_accept(offer: dict) -> tuple[str, str]:
            try:
                result = accept_offer(offer["id"], offer["providerId"], proposed_price=1200)
                return "accepted", result["provider"]["id"]
            except DispatchConflict as exc:
                return "conflict", exc.code

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(try_accept, offers))

        assert Counter(result[0] for result in results) == {"accepted": 1, "conflict": 1}, results
        assert ("conflict", "ORDER_ALREADY_ACCEPTED") in results, results
        assert Counter(offer["status"] for offer in load_offers()) == {"accepted": 1, "lost": 1}, load_offers()
        assert load_orders()[0]["status"] == "accepted", load_orders()[0]
        assert any(provider["status"] == "busy" for provider in load_providers()), load_providers()

    print("postgres_postgis_migration_dispatch_smoke=passed")


if __name__ == "__main__":
    main()
