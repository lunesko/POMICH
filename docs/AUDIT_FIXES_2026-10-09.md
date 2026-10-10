# Audit follow-up — PR #94

Sources: UX/UI report dated 2026-10-08, project/code audit dated 2026-10-06,
and the three review findings on commit `da65664` in PR #94.

## Implemented in this follow-up

| Finding | Result |
| --- | --- |
| Remembered customer becomes a guest after reopening | CustomerFlow resolves the browser cookie before guest fallback; network failures preserve identity. |
| Open tabs retain expired bearer tokens | Shared API transport renews expiring customer/provider tokens, including polling and heartbeat. Concurrent renewal is shared; mutations are not replayed. Restore rejects a different account identity. |
| Partner remember-me is unreachable | Registration offers a reachable password login. Duplicate-phone recovery still opens phone OTP. |
| Registration precedes problem selection | The help CTA opens problem selection; contact and verification move to the review step and gate submission. |
| Draft is lost after role changes/reopen | Tab-scoped drafts retain service, answers, pickup, destination, comment and step for 12 hours; logout removes them. |
| Cached/default coordinates claim to be current | Cached positions no longer initialize a successful GPS state; the help point is labeled for verification, with source text on the home screen. |
| Partner city and position are conflated | Work-city copy is separate from GPS; radius uses the actual map point and is drawn as a circle. Going online requires a GPS fix inside the service area. |
| Destination search auto-confirms the point | Search/map selection creates a candidate. A separate confirmation is required; typing alone cannot confirm an old point. |
| Draft shows matching/arrival time | Details and review show draft status and omit the route/ETA badge. |
| Directory suggests available partners | Landing calls it a service directory, explains that listings are not online partners, and offers a searchable text list. Markers expose service names and addresses. |
| Price/consent are unclear | Landing, FAQ and review explain separate proposal/confirmation, tow distance example, and separately negotiated materials/fuel. On-site repair is a preference, not a guarantee. |
| New partner uses a fake name and default city | Placeholder names are not copied into registration; the city starts empty. Required fields and missing-data summary are visible. |
| Service answers do not cover uncertainty | Battery accepts unknown symptom/help; unknown fuel requires clarification; other mechanical issues require a description. Tow can include optional vehicle type and weight. |
| Inaccessible selected services | Partner registration/cabinet service buttons expose aria-pressed. |
| Landing map anchor returns to a persisted role | Public section hashes are excluded from role restoration on popstate. |
| GPS help names absent controls | Help uses instructions applicable to the actual screen; the explanatory button is named accordingly. |
| Overloaded plate hint | Short example and automatic Cyrillic conversion explanation replace the letter-pair list. |
| OTP needs a manual resend after transient transport failure | Background delivery retries once with the same code; an old delivery task cannot invalidate a newer OTP. This does not establish the cause of the reported production incident. |
| Async queues mutated from sync worker threads | Realtime subscribers retain their owning loop; delivery runs through call_soon_threadsafe, including bounded-queue eviction. |
| Network errors lose their cause | Shared API transport raises ApiRequestError retaining cause and abort/network classification. |

## Already present in the base branch

Stage-1 CORS headers, preservation of encrypted PII on decryption failure,
CSP at nginx, sanitized environment examples, ignored/untracked local secrets,
removed Flask and pnpm lockfile, test helpers/fixtures and Vitest E2E exclusion.
Two separate Telegram bots are intentional: customer and provider addresses are
defined by the dual-bot configuration; a customer link is not blindly replaced
with the partner bot handle.

## Follow-up polish (audit UX remaining)

| Finding | Result |
| --- | --- |
| Light theme surfaces hurt reading | Form/nav/card tokens use opaque sage surfaces (`#E8EEEB` / `#ECF1EE`) instead of translucent glass. |
| Hero copy contrast over the map | Stronger light-theme wash behind `.landing-hero-content`. |
| City selects invent Київ | Cabinets, customer profile and partner registration keep an empty «Оберіть місто» until the user picks; empty city fails validation. |
| Service name mismatch | Catalog labels aligned: Шиномонтаж / Відкрити авто / Механік на дорозі. |
| Default map point reads as live GPS | Home help-point copy distinguishes Telegram, live device, cached, and illustration-default centers. |

## Not closed by this commit

The architectural roadmap remains: full decomposition of flow/storage modules,
replacement of navigation/state management with a router/store, SQL/Redis OTP
persistence and multi-worker realtime, schema revision-based optimistic locking,
CSS/API/test modularization, external crash monitoring and broader application
rate limiting. These are not represented as completed bug fixes.

Secret revocation and historical Git cleanup are operational actions; this commit
does not rotate BotFather credentials or rewrite repository history.

Actual Telegram delivery, real GPS, the joint client/partner order lifecycle,
Android/iOS/WebView, offline recovery and full WCAG contrast measurement remain
to be checked on a controlled test deployment. Browser checks run in GitHub CI
and locally with official Chromium. The cookie notice is opaque and below
navigation; E2E covers navigating with the notice visible and dismissing it
before page snapshots. No production order was created during this work.

## Validation

Backend: 257 tests passed. Frontend: 387 Vitest tests, TypeScript check,
production build and git diff whitespace check. Regression coverage includes
cookie restore before guest creation, offline identity preservation, concurrent
bearer renewal, account mismatch, explicit logout, reachable partner login,
destination confirmation, draft restoration, OTP retry/races and thread-safe
realtime wake-up.

Playwright checks cover mobile and desktop landing, role selection and admin
login, viewport overflow and serious/critical axe violations. The desktop landing
baseline was reviewed and updated from CI for the directory and pricing copy.
