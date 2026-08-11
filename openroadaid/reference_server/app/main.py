from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import incidents, providers, offers, jobs, events
from app.config import settings
from app.db.session import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="OpenRoadAid Reference Server", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(incidents.router, prefix="/v1")
app.include_router(providers.router, prefix="/v1")
app.include_router(offers.router, prefix="/v1")
app.include_router(jobs.router, prefix="/v1")
app.include_router(events.router, prefix="/v1")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "database": "ok", "protocol": settings.protocol_version}


@app.get("/version")
def version() -> dict:
    return {"version": settings.server_version}

