# Security Policy

## Supported Versions

OpenRoadAid v0.1.x is the current development line.

## Reporting a Vulnerability

Please report suspected security issues privately by opening a security advisory or contacting the maintainers. Do not disclose details publicly until a fix is available.

## Security Considerations

This repository intentionally avoids storing real provider data, customer locations or production secrets. The reference implementation uses API keys or JWTs for server access and should be deployed behind standard authentication and rate limiting controls.
