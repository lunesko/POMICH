"""Server-side auth session families, logout revocation, and short-lived realtime tickets."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException

_LOCK = threading.RLock()
_REVOKED_SIDS: dict[str, int] = {}  # sid -> expires_at (unix)
_RT_PREFIX = "pomich_rt_v1"
_DEFAULT_TICKET_TTL_SECONDS = 120
_DEFAULT_STREAM_TTL_SECONDS = 3600
_REVOCATION_RETENTION_SECONDS = 31 * 24 * 60 * 60


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _revocation_path() -> Path:
    return Path(os.getenv("POMICH_AUTH_REVOCATION_PATH") or Path(__file__).resolve().parent.parent / "data" / "auth_revocations.json")


def _prune_locked(now: int | None = None) -> None:
    stamp = int(now if now is not None else time.time())
    stale = [sid for sid, expires_at in _REVOKED_SIDS.items() if int(expires_at or 0) <= stamp]
    for sid in stale:
        _REVOKED_SIDS.pop(sid, None)


def _persist_locked() -> None:
    path = _revocation_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"revoked": dict(_REVOKED_SIDS), "updatedAt": int(time.time())}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    if _sql_enabled():
        try:
            from bot.runtime_store import sql_replace_auth_revocations

            sql_replace_auth_revocations(_REVOKED_SIDS)
        except Exception:
            # File store remains the local fallback when SQL is unavailable.
            pass


def _sql_enabled() -> bool:
    try:
        from bot.runtime_store import sql_storage_enabled

        return bool(sql_storage_enabled())
    except Exception:
        return False


def _load_locked() -> None:
    global _REVOKED_SIDS
    loaded: dict[str, int] = {}
    if _sql_enabled():
        try:
            from bot.runtime_store import sql_load_auth_revocations

            loaded = {str(sid): int(exp) for sid, exp in sql_load_auth_revocations().items()}
        except Exception:
            loaded = {}
    if not loaded:
        path = _revocation_path()
        if path.exists():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                raw = payload.get("revoked") if isinstance(payload, dict) else {}
                if isinstance(raw, dict):
                    loaded = {str(sid): int(exp) for sid, exp in raw.items()}
            except Exception:
                loaded = {}
    _REVOKED_SIDS = loaded
    _prune_locked()


_LOADED = False


def _ensure_loaded() -> None:
    global _LOADED
    if _LOADED:
        return
    with _LOCK:
        if _LOADED:
            return
        _load_locked()
        _LOADED = True


def reset_auth_sessions_for_tests() -> None:
    global _LOADED
    with _LOCK:
        _REVOKED_SIDS.clear()
        _LOADED = False
        path = _revocation_path()
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass


def new_session_id() -> str:
    return uuid.uuid4().hex


def revoke_session_family(session_id: str, *, retain_until: int | None = None) -> None:
    sid = str(session_id or "").strip()
    if not sid:
        return
    _ensure_loaded()
    until = int(retain_until if retain_until is not None else time.time() + _REVOCATION_RETENTION_SECONDS)
    with _LOCK:
        _prune_locked()
        current = int(_REVOKED_SIDS.get(sid) or 0)
        _REVOKED_SIDS[sid] = max(current, until)
        _persist_locked()


def is_session_revoked(session_id: str) -> bool:
    sid = str(session_id or "").strip()
    if not sid:
        return False
    _ensure_loaded()
    with _LOCK:
        _prune_locked()
        expires_at = int(_REVOKED_SIDS.get(sid) or 0)
        return expires_at > int(time.time())


def peek_session_id(token: str) -> str | None:
    parts = str(token or "").split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(_b64_decode(parts[1]).decode("utf-8"))
    except (binascii.Error, TypeError, ValueError, UnicodeDecodeError):
        return None
    sid = str(payload.get("sid") or "").strip()
    return sid or None


def revoke_token_family(token: str) -> str | None:
    sid = peek_session_id(token)
    if sid:
        revoke_session_family(sid)
    return sid


def _ticket_secret() -> str:
    return (
        (os.getenv("POMICH_REALTIME_TICKET_SECRET") or "").strip()
        or (os.getenv("POMICH_CUSTOMER_SESSION_SECRET") or "").strip()
        or "dev-realtime-ticket-secret"
    )


def issue_realtime_ticket(
    *,
    role: str,
    subject_id: str,
    scope: str,
    session_id: str = "",
    stream_expires_at: int | None = None,
    ttl_seconds: int = _DEFAULT_TICKET_TTL_SECONDS,
) -> dict[str, Any]:
    now = int(time.time())
    ticket_exp = now + max(30, min(int(ttl_seconds), 300))
    stream_exp = int(stream_expires_at or (now + _DEFAULT_STREAM_TTL_SECONDS))
    stream_exp = max(ticket_exp, min(stream_exp, now + _DEFAULT_STREAM_TTL_SECONDS))
    payload = {
        "role": str(role),
        "sub": str(subject_id),
        "scope": str(scope),
        "sid": str(session_id or ""),
        "iat": now,
        "exp": ticket_exp,
        "streamExp": stream_exp,
    }
    body = _b64_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _b64_encode(hmac.new(_ticket_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    return {
        "ticket": f"{_RT_PREFIX}.{body}.{signature}",
        "expiresAt": ticket_exp,
        "streamExpiresAt": stream_exp,
        "scope": payload["scope"],
    }


def verify_realtime_ticket(ticket: str, expected_scope: str) -> dict[str, Any]:
    parts = str(ticket or "").split(".")
    if len(parts) != 3 or parts[0] != _RT_PREFIX:
        raise HTTPException(status_code=401, detail="realtime_ticket_invalid")
    _, body, signature = parts
    expected = _b64_encode(hmac.new(_ticket_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="realtime_ticket_invalid")
    try:
        payload = json.loads(_b64_decode(body).decode("utf-8"))
        expires_at = int(payload.get("exp") or 0)
        stream_exp = int(payload.get("streamExp") or expires_at)
    except (binascii.Error, TypeError, ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=401, detail="realtime_ticket_invalid") from exc
    now = int(time.time())
    if expires_at <= now:
        raise HTTPException(status_code=401, detail="realtime_ticket_expired")
    if str(payload.get("scope") or "") != str(expected_scope):
        raise HTTPException(status_code=403, detail="realtime_scope_mismatch")
    sid = str(payload.get("sid") or "").strip()
    if sid and is_session_revoked(sid):
        raise HTTPException(status_code=401, detail="session_revoked")
    subject_id = str(payload.get("sub") or "").strip()
    role = str(payload.get("role") or "").strip()
    if not subject_id or not role:
        raise HTTPException(status_code=401, detail="realtime_ticket_invalid")
    return {
        "role": role,
        "subjectId": subject_id,
        "scope": str(payload.get("scope") or ""),
        "sessionId": sid,
        "streamExpiresAt": stream_exp,
    }
