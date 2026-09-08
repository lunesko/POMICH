# Security audit — POMICH (2026-09)

Code fixes in this branch address the highest-risk findings below. Remaining items need ops rotation or follow-up PRs.

## Fixed in this PR

| Finding | Change |
|---------|--------|
| Hardcoded `*-2026` secrets in `deploy.py` / `server_ops.py` | Generate `secrets.token_urlsafe` / Fernet keys; preserve existing remote values when safe |
| Known deploy defaults accepted by `is_configured_secret` | Reject `pomich-*-2026` and related fragments; require `POMICH_ENCRYPTION_KEY` in production |
| Guest session IDOR / profile overwrite | Never apply request body fields; never mint under client-chosen id; restore only if profile already persisted; reject `customer-web` |
| Shared bootstrap → any `providerId` | Documented as ops-only; prefer login/self-session. Token compare is now constant-time. **Rotate** if leaked. |
| Non-constant-time bootstrap token compare | `hmac.compare_digest` for admin/provider bootstrap headers |
| SPA catch-all returned `index.html` for `/.env`, `/.git` | Fast 404 for sensitive scanner paths |
| OTP codes printed when SMTP missing | Log target only, never the code |
| Phone-login user enumeration | Unknown phone returns masked success on send; confirm uses generic `login_failed` |

## Still open (ops / follow-up)

1. **Rotate production secrets** if the live `.env.production` still uses `pomich-*-secret-2026` / `pomich-db-pass-2026` / plaintext account passwords from older deploys.
2. **Shared `POMICH_PROVIDER_TOKEN`** still issues a session for any *existing* provider — treat as ops bootstrap only; prefer account login / self-session. Long-term: bind bootstrap to a single ops role or remove it.
3. **CORS** `allow_origin_regex` for `*.trycloudflare.com` + credentials remains broad for tunnels.
4. **Tokens in query strings** (`adminToken`, `providerToken`, `access_token`) — migrate fully to headers/storage.
5. **Password storage** — prefer `passwordHash=sha256:` (or better, salted) everywhere; add login rate limits.
6. **Public `/map/providers` phone/telegram** — product decision; redact if not needed for contact UX.
7. **Legacy Flask shim** (`bot/app.py`, `bot/routes.py`) — keep out of production entrypoints.
8. Dead backend routes still present (ukraine import, verification submit, legacy `/offers/{id}/accept`) — unused by FE after this PR but not removed from API yet.

## Dead code removed (frontend)

- Unused API wrappers: `getOrders`, `importUkraineProviders`, `submitCustomerVerification`, `submitProviderVerification`
- Unused helpers: `clearHiddenAdminHash`, `usePomichThemeOptional`, `isOpenRequestPin`

## Secrets / repo hygiene

- No live Fernet keys, bot tokens, or SSH passwords found committed.
- `.env*`, `.env.deploy` remain gitignored.
- Hardcoded production host IP in deploy scripts is operational convenience, not a credential — prefer env overrides (`POMICH_SSH_HOST`).
