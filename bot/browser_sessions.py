"""HttpOnly browser restore cookies; API authorization still uses short-lived bearer tokens."""

from __future__ import annotations

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


def set_browser_session(response: Response, session: dict) -> None:
    role = str(session["role"])
    response.set_cookie(
        _COOKIES[role],
        session["accessToken"],
        max_age=session_ttl_seconds(),
        path=COOKIE_PATH,
        httponly=True,
        secure=is_production_runtime(),
        samesite="lax",
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
    session = issue_role_session(role, principal.subject_id, _secret(role))
    if role == "customer":
        session["customerId"] = principal.subject_id
    elif role == "provider":
        session["providerId"] = principal.subject_id
    set_browser_session(response, session)
    return session


def clear_browser_sessions(response: Response) -> None:
    for cookie in _COOKIES.values():
        response.delete_cookie(cookie, path=COOKIE_PATH, secure=is_production_runtime(), samesite="lax")
