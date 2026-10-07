"""Legacy Flask entrypoint removed — use FastAPI (`bot.fastapi_app:app`) with uvicorn."""

raise SystemExit(
    "POMICH no longer ships a Flask app. Start the API with:\n"
    "  uvicorn bot.fastapi_app:app --host 0.0.0.0 --port 8000"
)
