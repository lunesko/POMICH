"""ASGI middleware: site-wide security headers for HTML and API responses."""

from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Pragmatic CSP for SPA + Telegram WebApp + OSM/Carto tiles + Google Fonts.
# 'unsafe-inline' is required for Vite-injected styles and Telegram theme hooks.
_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'self' https://web.telegram.org https://telegram.org https://*.telegram.org; "
    "form-action 'self' https://t.me https://telegram.me; "
    "script-src 'self' 'unsafe-inline' https://telegram.org https://*.telegram.org; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: blob: https:; "
    "connect-src 'self' https: wss: blob:; "
    "worker-src 'self' blob:; "
    "manifest-src 'self'"
)

_PERMISSIONS = (
    "camera=(), microphone=(), payment=(), usb=(), "
    "geolocation=(self), accelerometer=(), gyroscope=(), magnetometer=()"
)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "SAMEORIGIN")
                headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                headers.setdefault("Permissions-Policy", _PERMISSIONS)
                headers.setdefault("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
                headers.setdefault("Content-Security-Policy", _CSP)
                # HSTS only meaningful on HTTPS; browsers ignore on plain HTTP.
                headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
            await send(message)

        await self.app(scope, receive, send_with_headers)
