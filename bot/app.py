"""Compatibility module for the canonical FastAPI app (ASGI only)."""
import os
from bot.fastapi_app import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
