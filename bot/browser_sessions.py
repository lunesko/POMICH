"""HttpOnly browser restore cookies; API authorization still uses short-lived bearer tokens."""

from __future__ import annotations

import time

from fastapi import HTTPException, Request, Response

from bot.api_deps import (
    configured_admin_secret,
    configured_customer_secret,
    configured_provider_secret,
    get_cors_origins,
    is_production_runtime,
    issue_role_session,
    session_ttl_seconds,
    verify_role_session,
)

COOKIE_PATH = "/api/auth/browser/"
_COOKIES = {
    "customer": "pomich_customer_session",
    "provider": "pomich_provider_session",
    "admin": "pomich_admin_session",
}


def _secret(role: str) -> str:
    return {
        "customer": configured_customer_secret,
        "provider": configured_provider_secret,
        "admin": configured_admin_secret,
    }[role]()


STANDARD_SESSION_SECONDS = 12 * 60 * 60
REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60


def issue_browser_login(role: str, subject_id: str, secret: str, *, remember_me: bool = False, deadline: int | None = None) -> dict:
    now = int(time.time())
    deadline = deadline if deadline is not None else now + (REMEMBERED_SESSION_SECONDS if remember_me else STANDARD_SESSION_SECONDS)
    if deadline <= now:
        raise HTTPException(status_code=401, detail=f"{role}_session_expired")
    # Bearer lifetime stays bounded; only the HttpOnly restore cookie lasts 30 days.
    return issue_role_session(role, subject_id, secret, ttl_seconds=min(session_ttl_seconds(), deadline - now),
                              browser_expires_at=deadline, remember_me=remember_me)


def set_browser_session(response: Response, session: dict) -> None:
    role = str(session["role"])
    now = int(time.time())
    deadline = int(session.get("sessionExpiresAt") or session["expiresAt"])
    remember_me = session.get("rememberMe") is True and role != "admin"
    cookie_session = issue_role_session(role, session["subjectId"], _secret(role),
                                       ttl_seconds=max(0, deadline - now),
                                       browser_expires_at=deadline, remember_me=remember_me)
    response.set_cookie(
        _COOKIES[role], cookie_session["accessToken"],
        max_age=max(0, deadline - now) if remember_me else None,
        path=COOKIE_PATH, httponly=True, secure=is_production_runtime(), samesite="lax",
    )


def require_same_origin(request: Request) -> None:
    """Cookies are only used on restore/logout; reject cross-origin POSTs."""
    origin = request.headers.get("origin", "").rstrip("/")
    if is_production_runtime():
        if not origin or origin not in get_cors_origins():
            raise HTTPException(status_code=403, detail="origin_forbidden")
    elif origin and origin != str(request.base_url).rstrip("/") and origin not in get_cors_origins():
        raise HTTPException(status_code=403, detail="origin_forbidden")


def restore_browser_session(request: Request, response: Response, role: str) -> dict:
    if role not in _COOKIES:
        raise HTTPException(status_code=400, detail="invalid_role")
    token = request.cookies.get(_COOKIES[role])
    if not token:
        raise HTTPException(status_code=401, detail="browser_session_required")
    principal = verify_role_session(token, role, _secret(role))
    session = issue_browser_login(role, principal.subject_id, _secret(role),
                                  remember_me=principal.remember_me, deadline=principal.browser_expires_at)
    if role == "customer":
        session["customerId"] = principal.subject_id
    elif role == "provider":
        session["providerId"] = principal.subject_id
    set_browser_session(response, session)
    return session


def clear_browser_sessions(response: Response) -> None:
    for cookie in _COOKIES.values():
        response.delete_cookie(cookie, path=COOKIE_PATH, secure=is_production_runtime(), samesite="lax")
