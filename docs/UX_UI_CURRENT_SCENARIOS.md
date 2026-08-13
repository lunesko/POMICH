# POMICH UX/UI current scenarios

Snapshot of what the current web/PWA product shows to each role: customer, partner, and admin.

## Shared Entry Points

### Public landing

Path: `/`

What the visitor sees:

- POMICH landing with full-screen map atmosphere.
- Header navigation: `Послуги`, `Як це працює`, `Карта`, `Контакти`.
- Theme switcher: light/dark.
- Primary CTA: `Потрібна допомога`.
- Partner CTA: `Надаю послуги`.
- Login/register actions.
- Services section with approximate pricing.
- Four-step explanation of the help flow.
- Public map/directory section with partners by city or all Ukraine.
- Contact block with Telegram link and client/partner entry buttons.

Current behavior:

- `Потрібна допомога` opens customer onboarding/flow.
- `Надаю послуги` opens partner onboarding/flow.
- `Увійти` starts customer login/session restore.
- `Зареєструватися` starts role selection.
- `/#admin` and `?role=admin` open admin mode (working).
- Long-press POMICH logo (~3s) is documented/intended but **not wired** in `LandingPage` (`onHiddenAdmin` / `ADMIN_LOGO_HOLD_MS` unused) — use URL/hash entry instead.

### Role selection

Path: app state after registration or direct role change.

What the visitor sees:

- POMICH role picker.
- Two cards:
  - `Я клієнт` - roadside help request.
  - `Я партнер` - provide roadside help.
- Theme switcher.
- Link to `@pomich_ua_bot`.
- Small stats: 24/7 request, approximate ETA, two roles.

Current behavior:

- User can switch role later from cabinet.
- Telegram Mini App can skip role picker when `?role=customer` or `?role=provider` is present.

## Customer UX

### 1. New Customer Registration

Entry:

- Landing `Потрібна допомога`.
- Role picker `Я клієнт`.
- Telegram Mini App customer entry.

What the customer sees:

- Registration screen with:
  - name
  - city
  - Ukrainian phone number
  - Telegram contact share button when opened inside Telegram
  - theme switcher
  - back button when possible

Validation:

- Name must be valid.
- City must be selected.
- Phone must be Ukrainian mobile format.

After profile is filled:

- Customer is asked to verify phone through OTP.
- OTP code is delivered through Telegram/email channel depending on backend availability.
- If customer is already registered by phone, UI shows login/restore path instead of duplicate registration.

### 2. Returning Customer Login

Entry:

- Landing `Увійти`.
- Reopening Telegram Mini App.
- Existing stored web session.

What the customer sees:

- Phone login screen.
- Button to send code.
- 6-digit OTP input after code is sent.
- Countdown and resend cooldown.
- Error state for rate limit, invalid code, or Telegram not linked.

Current behavior:

- Telegram Mini App prefers `initData` session and restores `tg-{telegram_user_id}` profile.
- Web login uses phone OTP.
- Existing active customer order can be restored after reload.

### 3. Customer Home / Service Selection

What the customer sees:

- Uber/Bolt-like map-first screen.
- Bottom/side sheet depending on viewport.
- Current city and map scope.
- Directory scope controls:
  - my city
  - all Ukraine
  - geolocation retry/recenter where available
- Nearby online providers and directory providers on map.
- Profile readiness/trust panel if profile is incomplete or unverified.
- Availability panel with nearby providers.
- Service list:
  - `Евакуатор`
  - `Акумулятор`
  - `Колесо`
  - `Пальне`
  - `Замок`
  - `Інше`
- Partner profile sheet when a provider/directory card is selected.

Current gating:

- Service buttons are disabled until customer profile is ready.
- If profile is complete but not verified, OTP panel is shown before ordering.

### 4. Customer Order Creation

Flow (as implemented):

1. Choose service.
2. Confirm pickup/current location on map.
3. Choose destination or on-site help, depending on service.
4. Review request (optional comment).
5. Submit order.

What the customer sees:

- Step badges on location/destination/review (home counts as step 1; review as step 4).
- Map stays visible during location/destination/review.
- Back button between steps.
- Price estimate/distance context where applicable.
- Review shows a default vehicle-state label (`Авто заводиться`); the dedicated `DetailsStep` UI exists in code but is **unreachable** (nothing sets `screen === "details"`).
- Submit button:
  - web: visible footer button.
  - Telegram: can be delegated to Telegram MainButton in supported contexts.

Current order payload includes:

- customer identity
- service
- pickup label and coordinates
- destination label and coordinates if needed
- comment + default `vehicleState`
- Telegram notification metadata when opened through Telegram

### 5. Customer Dispatch / Waiting

Status: `searching`

What the customer sees:

- Screen title: waiting for partner.
- Map with request/route context.
- Order number.
- Dispatch state:
  - how many offers were sent
  - first partner to confirm gets the order
  - no providers available state
- Actions:
  - retry dispatch when no providers are available
  - cancel order

### 6. Customer Price Confirmation

Status: `accepted`

What the customer sees:

- Partner card:
  - partner name
  - vehicle/plate
  - rating when available
  - verification pill
  - phone call action
  - Telegram chat action
  - distance/ETA when available
- Proposed partner price.
- Timeline.
- Actions:
  - confirm price
  - cancel order

Current behavior:

- Customer must confirm price before the partner can move into real navigation status.

### 7. Customer Tracking

Statuses:

- `price_confirmed`
- `en_route`
- `arrived`
- `in_progress`

What the customer sees:

- Assigned partner card.
- Map with route/provider context.
- Timeline:
  - search
  - price
  - confirmed
  - en route
  - arrived
  - work
  - done
- Status copy changes as partner updates state.
- Cancel action remains available until terminal states.

### 8. Customer Completion / Cancellation

Terminal statuses:

- `completed`
- `cancelled`

What the customer sees:

- Completion/cancellation screen.
- Order summary.
- Final price if known.
- Partner name.
- Review prompt after completion:
  - star rating
  - optional comment
  - skip/continue path
- `Нова заявка` action.
- Logout action when available.

Cancellation behavior:

- Cancelled screen auto-dismisses after countdown and returns to new request flow.

### 9. Customer Cabinet

Entry:

- App shell/cabinet action.
- Returning customer session.

What the customer sees:

- Profile card:
  - name
  - phone
  - email
  - city
  - vehicle
  - Telegram username
  - verification/profile status
- Profile edit mode:
  - name
  - phone
  - email
  - city
  - vehicle
  - Telegram
- OTP verification panel if not verified.
- Profile completion checklist.
- Order history:
  - service
  - status
  - date
  - own review
  - partner review
- Actions:
  - switch role
  - logout
  - back to active flow

## Partner UX

### 1. Partner Registration

Entry:

- Landing `Надаю послуги`.
- Role picker `Я партнер`.
- Provider Telegram bot entry (`@pomich_help_bot`; see [`docs/TELEGRAM_TWO_BOTS.md`](TELEGRAM_TWO_BOTS.md)).

What the partner sees:

- Partner registration form:
  - name
  - phone
  - city
  - vehicle make/model/custom make
  - license plate
  - service radius
  - services/specialties
- Services are selectable as cards.
- Submit button: register partner.
- Link: already have account/login.

Validation:

- Valid person name.
- Ukrainian mobile number.
- Valid city.
- Vehicle data must be complete.
- Ukrainian plate must be valid.
- At least one service must be selected.

If phone already exists:

- UI keeps form state and offers login/restore with that phone.

### 2. Partner Login / Session Restore

What the partner sees:

- Partner account login screen:
  - login
  - password
  - submit
  - register link

Current behavior:

- If customer identity is linked to a provider account, the app can mint a self-provider session.
- Otherwise partner uses provider account login.
- This is still not the final account model; it is a beta/bootstrap-style login layer.

### 3. Partner Phone Verification

What the partner sees:

- Phone verification screen.
- OTP panel.
- Phone can be saved/updated before OTP.

Current gating:

- Partner cannot go online until phone is verified.
- If trying to go online while unverified, UI redirects to verification.

### 4. Partner Duty Screen

Status: offline/online.

What the partner sees:

- Map-first partner screen.
- Provider location/pin.
- Request pins nearby when online.
- Duty toggle:
  - `На лінії`
  - `Поза лінією`
- Geolocation loading/error/retry.
- Sheet with:
  - shift status
  - number of map requests
  - number of active offers
  - refresh map/offers
  - go online/offline action

Current behavior:

- Online presence is sent to backend with provider location and ETA.
- While online, offers are polled and also refreshed through realtime provider events.
- Partner can leave line manually.

### 5. Incoming Offer

Status: active dispatch offer.

What the partner sees:

- New order screen or map request sheet.
- Countdown timer.
- Distance to customer.
- Approximate ETA.
- Service type.
- Customer approximate location.
- Vehicle state/comment when present.
- Required price input in UAH.
- Optional price note.
- Actions:
  - accept with price
  - decline/skip
  - close sheet

Validation:

- Accept is blocked if offer expired.
- Accept is blocked until a numeric price is entered.

Conflict states:

- If another partner accepts first, UI dismisses the offer and returns to duty with conflict/lost messaging.
- Expired/missing offers are removed locally.

### 6. Partner Waits For Price Confirmation

Status: `accepted`

What the partner sees:

- Screen: waiting for customer.
- Proposed price that was sent.
- Timeline at accepted step.
- Action: return to map/duty.

Current behavior:

- Partner cannot proceed until customer confirms the price.
- App polls active order and moves forward when status becomes `price_confirmed` or `en_route`.

### 7. Partner Navigation / Work

Statuses:

- `price_confirmed`
- `en_route`
- `arrived`
- `in_progress`

What the partner sees:

- Route map to customer.
- Own GPS position if available.
- Customer pickup label.
- Status CTA:
  - `Їду до клієнта`
  - `Я на місці`
  - `Почати роботу`
  - `Завершити`
- Timeline/status pill.

Current behavior:

- Each CTA updates backend order status.
- Customer sees the same lifecycle updates.

### 8. Partner Completion

Status: `completed`

What the partner sees:

- Completion screen.
- Order summary.
- Partner revenue/price if known.
- Customer name if known.
- Review prompt for customer:
  - star rating
  - optional comment
  - skip/continue
- Action: return to duty queue.

### 9. Partner Cabinet

Entry:

- App shell/cabinet action.
- Returning partner role.

What the partner sees:

- Profile card:
  - name
  - phone
  - city
  - vehicle
  - services
  - verification status
  - line status
- Edit mode:
  - name
  - phone
  - city
  - vehicle
  - services
  - service radius
- OTP verification panel if phone is not verified.
- Duty online/offline action.
- Incoming offers list.
- Order history with reviews.
- Actions:
  - switch role
  - logout
  - back

## Admin UX

### 1. Admin Entry / Login

Entry:

- `?role=admin`
- `/#admin`
- legacy `?role=admin&adminToken=...`
- long-press logo on landing — **not implemented** (prop/constant present, no hold handlers)

What admin sees:

- Protected admin login panel.
- Login/password form.
- POMICH OPS branding.
- Error state for failed login.

Current behavior:

- If bootstrap/admin token is present, app creates admin session.
- Otherwise admin account login is required.

### 2. Admin Dashboard

Section: `Дашборд`

What admin sees:

- Totals:
  - clients
  - partners
  - active orders
  - completed orders
  - online providers
  - busy providers
  - verified providers
  - pending verification
- Recent activity feed with order status pills.
- Auto-refresh every 15 seconds.

### 3. Admin Clients

Section: `Клієнти`

What admin sees:

- Search/filter input.
- Toggle to show guest sessions.
- Button to purge stale guest clients.
- Client list.
- Selected client editor:
  - name
  - phone
  - email
  - city
  - verification status
  - account status
- Empty states and load errors.

Admin actions:

- Update client profile.
- Change verification status.
- Change account status.
- Purge guest sessions older than configured days.

### 4. Admin Partners

Section: `Партнери`

What admin sees:

- Search/filter input.
- Provider list with:
  - name
  - phone
  - online/busy/offline status
  - services
  - verification status
- Selected provider editor:
  - name
  - phone
  - city
  - vehicle
  - status
  - service radius
  - verification status

Admin actions:

- Save provider changes.
- Mark provider verified/rejected.
- Delete provider.

### 5. Admin Verification Queue

Section: `Перевірка`

What admin sees:

- Only providers with `pending` verification status.
- Badge in nav with pending count.
- Same provider detail editor, focused on verification decision.

Admin actions:

- Verify provider.
- Reject provider.
- Delete provider if needed.

### 6. Admin Orders

Section: `Заявки`

What admin sees:

- Order filters:
  - all
  - searching
  - accepted
  - price confirmed
  - assigned
  - en route
  - in progress
  - completed
- Order list with status pills.
- Selected order detail:
  - order id
  - customer
  - provider/assigned provider
  - service
  - price
  - timeline
  - dispatch offers

Admin actions:

- Move order to next allowed status.
- Cancel order.
- Retry dispatch for selected order.

### 7. Admin Map / Directory

Section: `Карта`

What admin sees:

- Map provider statistics:
  - total pins
  - dispatch providers
  - directory providers
- Up to first 40 providers/pins in list.
- Import status messages.

Admin actions:

- Import providers from OSM/preferred source.
- Seed providers.

Current limitation:

- This admin section is more of an ops list/stat panel than a full visual dispatch map.

### 8. Admin Settings

Section: `Налаштування`

What admin sees:

- Runtime mode.
- `WEB_APP_URL`.
- PII encryption enabled/disabled.
- Database configured vs JSON store.
- Telegram configured yes/no.
- CORS origins.
- Admin accounts configured yes/no.
- Session TTL.
- HTTP pilot flag.

## Cross-role UX/UI Notes

### What is already strong

- Map-first mental model is close to Uber/Bolt.
- Customer and partner flows share the same order lifecycle.
- Partner offer mechanics already include first-accept-wins conflict handling.
- Customer and partner both have profile/cabinet/history/review surfaces.
- Admin panel covers real operational needs, not just demo stats.
- Theme switching is visible on landing/role/onboarding/app surfaces.
- Telegram Mini App identity exists for customer and provider bots (two-bot runtime; see [`docs/TELEGRAM_TWO_BOTS.md`](TELEGRAM_TWO_BOTS.md)).

### Current UX gaps before beta

- Two-bot Telegram runtime is already implemented on main (commit `2c94aa3`; see [`docs/TELEGRAM_TWO_BOTS.md`](TELEGRAM_TWO_BOTS.md) for dual tokens, webhooks, and initData). Remaining gap is production DNS/tokens/BotFather config for `pomich.help`, not missing application code. Historical design notes remain in [`TELEGRAM_TWO_BOTS_SPEC.md`](TELEGRAM_TWO_BOTS_SPEC.md).
- Partner/admin account model is still transitional; final provider/admin auth needs dedicated account management.
- Desktop app mode is intentionally app-like, but some screens still feel mobile-first instead of polished desktop side-panel UX.
- Admin map is not yet a true live visual dispatch cockpit.
- Customer cannot explicitly choose among multiple live offers; dispatch is automatic first-accept-wins.
- Price negotiation is one proposal plus customer confirmation, not a full chat/negotiation loop.
- Payments are not part of current UX.
- Bot notifications are already routed by bot kind in code (customer events → `@pomich_ua_bot`, partner offers → `@pomich_help_bot`; see [`docs/TELEGRAM_TWO_BOTS.md`](TELEGRAM_TWO_BOTS.md)). Remaining gap is production webhook setup (`scripts/ops/telegram_set_webhooks.py` + live HTTPS origin), not missing routing logic.
- Hidden admin long-press on landing is not wired (`?role=admin` / `#admin` only).
- Customer vehicle `DetailsStep` is dead code; order create skips it.
- `POST /orders/{id}/dispatch/retry` is unauthenticated (client sends no bearer) — usable from UI but a security/ops risk.
- Customer cancel is optimistic (local cancelled UI even if API fails silently).

## Recommended Next UX Tasks

1. Finish production Telegram two-bot rollout (runtime already shipped; see [`docs/TELEGRAM_TWO_BOTS.md`](TELEGRAM_TWO_BOTS.md)):
   - configure DNS/tokens/BotFather Web App URLs for `pomich.help`
   - set customer + provider webhooks
   - verify customer bot lands in customer flow and partner bot in partner flow on the shared frontend/backend
2. Polish desktop app layout:
   - customer side sheet on desktop
   - partner duty side panel on desktop
   - keep bottom sheet for mobile/Telegram
3. Add provider verification progress UI:
   - profile complete
   - phone verified
   - admin review pending
   - approved/rejected with reason
4. Add admin live map view:
   - active orders
   - online partners
   - offer race state
   - order lifecycle timeline
5. Add release-gate UX script:
   - customer creates order
   - two partners receive offers
   - one accepts with price
   - customer confirms
   - partner completes lifecycle
   - both leave reviews
