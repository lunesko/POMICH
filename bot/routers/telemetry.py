"""Minimal, anonymous field Web Vitals intake for operational analysis."""

from __future__ import annotations

import json
import logging
import math

from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter(tags=["telemetry"])
logger = logging.getLogger("pomich.web_vitals")
logger.setLevel(logging.INFO)
# Uvicorn does not configure application loggers consistently across runtimes.
# Emit one JSON line to stderr; container logging can retain/forward it.
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.propagate = False

_PAGES = {"landing", "customer", "provider", "admin"}
_VIEWPORTS = {"mobile", "desktop"}
_LIMITS = {"CLS": 10.0, "INP": 120_000.0, "LCP": 120_000.0}


@router.post("/telemetry/web-vitals", status_code=204)
async def web_vitals(request: Request) -> Response:
    # This public endpoint only records anonymous numeric samples. Bound the body
    # before parsing so accidental or hostile large submissions are rejected.
    if request.headers.get("content-length", "").isdigit() and int(request.headers["content-length"]) > 512:
        raise HTTPException(status_code=413, detail="payload_too_large")
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > 512:
            raise HTTPException(status_code=413, detail="payload_too_large")
    try:
        payload = json.loads(chunks)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="invalid_metrics") from exc
    if not isinstance(payload, dict) or payload.get("page") not in _PAGES or payload.get("viewport") not in _VIEWPORTS:
        raise HTTPException(status_code=400, detail="invalid_metrics")
    metrics = payload.get("metrics")
    if not isinstance(metrics, list) or not 1 <= len(metrics) <= 3:
        raise HTTPException(status_code=400, detail="invalid_metrics")
    seen: set[str] = set()
    for metric in metrics:
        if not isinstance(metric, dict):
            raise HTTPException(status_code=400, detail="invalid_metrics")
        name, value = metric.get("name"), metric.get("value")
        if name not in _LIMITS or name in seen or type(value) not in (int, float):
            raise HTTPException(status_code=400, detail="invalid_metrics")
        if not math.isfinite(value) or not 0 <= value <= _LIMITS[name]:
            raise HTTPException(status_code=400, detail="invalid_metrics")
        seen.add(name)
    # Log only allowlisted fields, never the request body, URL, IP or user agent.
    for metric in metrics:
        logger.info(json.dumps({"event": "web_vital", "page": payload["page"], "viewport": payload["viewport"], "name": metric["name"], "value": metric["value"]}, separators=(",", ":")))
    return Response(status_code=204)
