# Browser login policy

Client phone OTP and partner password login accept `rememberMe: boolean` (default false).

| Choice | Browser cookie | Absolute session deadline |
| --- | --- | --- |
| Unchecked | Session cookie (no Max-Age/Expires) | 12 hours from authentication |
| Checked | Persistent HttpOnly cookie | 30 days from authentication |

The checked state defaults to false and is sent only after successful authentication.
Browser restore never moves the absolute deadline. Bearer tokens remain bounded by
`POMICH_AUTH_SESSION_TTL_SECONDS` (default and maximum 15 minutes) and by the session deadline.
The persistent credential is only in an HttpOnly cookie; JavaScript does not persist bearer tokens.
Customer-to-partner role switching inherits the authenticated customer's deadline and preference.
Admin, guest and Telegram bootstrap sessions use the unchecked policy.
Tokens issued before the session-registry migration are rejected; users must sign in again once.

Cookies use `/api/auth/browser/`, SameSite=Lax, and Secure in production.
Restore/logout reject cross-origin requests. Logout revokes the session families represented
by this browser's role cookies, then deletes those cookies. Copied cookies and access tokens
in the same families are rejected, including tokens obtained by earlier restores.
Browsers that restore tabs can preserve session cookies across restart; the 12-hour server
limit still applies. Registry state is stored in PostgreSQL (local JSON mode uses a separate
SQLite file). Restore credentials have a distinct purpose and cannot authorize API requests.
Every successful restore rotates its signed generation. A ten-second overlap allows an already
concurrent request to finish; use of an older generation after that window revokes the entire
session family. Disabling or deleting a customer/provider account revokes its active families.

Realtime URLs contain only single-use, channel-scoped tickets valid for at most 30 seconds.
Streams check session expiry/revocation before delivery and at least once per second while idle.

The cookie notice is informational and links `/privacy`; acknowledging it is stored in
localStorage. This is not an optional analytics consent mechanism.

OTP lifetime remains 10 minutes; resend cooldown remains 45 seconds.

Protected browser API requests inspect bearer expiry and restore it before sending,
including history polling and partner heartbeat. Concurrent requests share one restore;
mutations are never replayed automatically. A cookie for another account cannot replace
the identity embedded in the original request. Transport failures during customer restore
keep the existing identity instead of silently creating a guest. Drafts live only in the
current tab's sessionStorage for up to 12 hours and are removed on logout.
