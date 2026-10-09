# Browser login policy

Client phone OTP and partner password login accept `rememberMe: boolean` (default false).

| Choice | Browser cookie | Absolute session deadline |
| --- | --- | --- |
| Unchecked | Session cookie (no Max-Age/Expires) | 12 hours from authentication |
| Checked | Persistent HttpOnly cookie | 30 days from authentication |

The checked state defaults to false and is sent only after successful authentication.
Browser restore never moves the absolute deadline. Bearer tokens remain bounded by
`POMICH_AUTH_SESSION_TTL_SECONDS` (default 24 hours) and by the session deadline.
The persistent credential is only in an HttpOnly cookie; JavaScript does not persist bearer tokens.
Customer-to-partner role switching inherits the authenticated customer's deadline and preference.
Admin, guest and Telegram bootstrap sessions use the unchecked policy.
Existing cookies expire at their previously signed deadline and restore without persistence.

Cookies use `/api/auth/browser/`, SameSite=Lax, and Secure in production.
Restore/logout reject cross-origin requests. Logout deletes all role cookies on this browser.
Browsers that restore tabs can preserve session cookies across restart; the 12-hour server
limit still applies. Browser logout does not revoke a separately copied stateless bearer token.

The cookie notice is informational and links `/privacy`; acknowledging it is stored in
localStorage. This is not an optional analytics consent mechanism.

OTP lifetime remains 10 minutes; resend cooldown remains 45 seconds.

Protected browser API requests inspect bearer expiry and restore it before sending,
including history polling and partner heartbeat. Concurrent requests share one restore;
mutations are never replayed automatically. A cookie for another account cannot replace
the identity embedded in the original request. Transport failures during customer restore
keep the existing identity instead of silently creating a guest. Drafts live only in the
current tab's sessionStorage for up to 12 hours and are removed on logout.
