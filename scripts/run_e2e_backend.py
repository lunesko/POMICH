"""Isolated real-backend browser harness. Never usable against a production DB."""
import json
import os
import sys
import tempfile
from pathlib import Path
from http.cookies import SimpleCookie

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
url = os.environ.get("POMICH_E2E_DATABASE_URL", "")
if url.rsplit("/", 1)[-1] != "pomich_e2e_test":
    raise RuntimeError("POMICH_E2E_DATABASE_URL must target the disposable pomich_e2e_test database")
os.environ.update(DATABASE_URL=url, POMICH_STORAGE_BACKEND="sql", POMICH_RUNTIME="dev",
    POMICH_SKIP_LOCAL_ENV="1", POMICH_CUSTOMER_SESSION_SECRET="synthetic-e2e-customer-secret",
    POMICH_PROVIDER_TOKEN="synthetic-e2e-provider-secret", POMICH_TELEGRAM_QUEUE_INLINE="1",
    TELEGRAM_BOT_TOKEN="", TELEGRAM_CUSTOMER_BOT_TOKEN="", TELEGRAM_PROVIDER_BOT_TOKEN="")
scratch = tempfile.TemporaryDirectory(prefix="pomich-e2e-")
os.environ["POMICH_OTP_STORE_PATH"] = str(Path(scratch.name) / "otp.json")
from bot.fastapi_app import app
from bot import runtime_store, order_store
from bot.browser_sessions import issue_browser_login, set_browser_session
from tests.helpers import verified_customer
from scripts.postgis_smoke import _provider
from fastapi import Response
from sqlalchemy import delete
import uvicorn

with runtime_store.get_engine().begin() as connection:
    for table in reversed(runtime_store._METADATA.sorted_tables):
        connection.execute(delete(table))
customer_id = "guest-browser-e2e"
verified_customer(customer_id)
order_store.update_customer_profile(customer_id, {"city": "Uzhhorod"})
provider_id = "browser-e2e-provider"
order_store.save_providers([_provider(provider_id, 48.6209, 22.2880, specialties=["battery"])])
customer = issue_browser_login("customer", customer_id, os.environ["POMICH_CUSTOMER_SESSION_SECRET"])
provider = issue_browser_login("provider", provider_id, os.environ["POMICH_PROVIDER_TOKEN"])
response = Response()
set_browser_session(response, customer)
cookie = SimpleCookie(response.headers["set-cookie"])["pomich_customer_session"].value
output = ROOT / "test-results" / "e2e-session.json"
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps({"customer": customer, "provider": provider, "cookie": cookie}), encoding="utf-8")
uvicorn.run(app, host="127.0.0.1", port=18001, log_level="warning")
