from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.config import settings


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_client(x_api_key: str | None = Header(default=None)) -> None:
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def require_provider(x_api_key: str | None = Header(default=None)) -> None:
    if x_api_key not in {settings.provider_api_key, settings.dispatcher_api_key, settings.api_key}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def require_dispatcher(x_api_key: str | None = Header(default=None)) -> None:
    if x_api_key not in {settings.dispatcher_api_key, settings.api_key}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
