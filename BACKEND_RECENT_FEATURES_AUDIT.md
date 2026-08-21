# Backend audit — recent features (history / auth / reclaim / partner)

**Scope:** FastAPI under `bot/` (plus dead Flask `bot/routes.py`), cross-checked against `src/api/client.ts` usage.  
**Focus:** client history empty / auth aliases / guest phone reclaim / partner→client rebind; owner auth; partner route/location; geo/city; OTP/Telegram.  
**Cap:** 12 items, P0–P2.

---

## P0

### 1. Guest can steal `tg-*` phone + rebind orders on role switch
**Files:** `bot/order_store.py` (`_claim_conflicting_guest_phone`, `_ensure_provider_phone_available`, `ensure_customer_client_from_linked_provider`)

**Bug:** Guard only blocks *tg→tg* theft:

```python
if other_id.startswith("tg-") and customer_id.startswith("tg-"):
    return False
```

A `guest-*` claimant clears any matching `tg-*` phone and rebinds those orders onto the guest. Combined with `_ensure_provider_phone_available` (provider uniqueness only — **does not** check registered customer phones), attacker flow:

1. Victim: `tg-{id}` client with phone X  
2. Attacker: guest session → register partner with phone X (allowed)  
3. Attacker: `PATCH /users/{guest}/account/role` → `customer` → reclaim clears victim phone + rebinds history  

**Fix:**
- In `_claim_conflicting_guest_phone`, only clear non-canonical rows (`guest-*`, `customer-web`); **never** clear `tg-*` unless `customer_id == other_id`. Prefer: `if other_id.startswith("tg-"): continue` (or abort).
- In `_ensure_provider_phone_available`, also call `find_registered_customer_by_phone` (exclude own linked customer) and raise `phone_already_registered`.
- Add regression test: guest partner with victim tg phone must not clear/rebind tg orders.

### 2. Orphan Flask API still exposes open order CRUD
**Files:** `bot/routes.py`, `bot/app.py`

**Bug:** Flask blueprint serves unauthenticated `GET/POST /orders` and an unprotected Telegram webhook. Production uses uvicorn/`bot.fastapi_app`, but importing/running `bot.app` still ships this surface.

**Fix:** Delete `bot/routes.py` + Flask wiring in `bot.app.py`, or make `bot.app` re-export FastAPI only. Fail CI if Flask routes are importable as a second app.

---

## P1

### 3. Order review ownership ignores phone aliases (history works, review fails)
**Files:** `bot/order_store.py` (`submit_order_review`), `bot/routers/orders.py` (`create_order_review`)

**Bug:** Cancel / confirm-price / SSE use `_customer_ids_for_order_history` aliases. Reviews only check `_order_belongs_to_customer(order, author_id)` (exact `customerId` / tg chat fields). After partner→client soft-patch (phoneless `tg-*`, orders still on `guest-*`), cabinet history shows the order but `POST /orders/{id}/reviews` returns `REVIEW_FORBIDDEN`.

**Fix:** Expand author check with the same alias set as `require_order_customer_owner`, or require rebind before soft-patch completes. Prefer shared helper `customer_owns_order(principal_id, order)`.

### 4. OTP confirm has no attempt lockout
**Files:** `bot/otp_verification.py` (`confirm_customer_verification_code`)

**Bug:** Invalid codes only return `code_invalid`; no `attempts` counter. 6-digit space + send rate limits still allow online guessing within TTL.

**Fix:** Persist `failedAttempts` on the OTP record; after N failures (e.g. 5) delete the code and return `code_locked` / 429 with cooldown.

### 5. Guest session minting accepts arbitrary `guest-*` IDs
**Files:** `bot/routers/auth.py` (`create_guest_customer_session`)

**Bug:** Client may request any `guest-*` / `customer-web` id and receive a full customer bearer for that subject (profile + history + create order). Leaked localStorage / shared device = account takeover of that guest row.

**Fix:** Ignore client-supplied ids in production (always `guest-{uuid}`), or require proof of prior possession (signed cookie). Keep allowlist only for deterministic test fixtures behind non-prod flag.

### 6. Provider phone uniqueness does not cover customer phones
**Files:** `bot/order_store.py` (`_ensure_provider_phone_available`)

**Bug:** Enables finding #1 and leaves duplicate phone rows that break login preference / history reclaim semantics.

**Fix:** Same as #1 — reject provider registration when a registered customer (non-alias) already holds the phone.

---

## P2

### 7. Dead / unused FastAPI routes vs frontend
| Route | File | Frontend |
|-------|------|----------|
| `POST /offers/{id}/accept\|decline` | `bot/routers/providers.py` | Unused (uses `/providers/{id}/offers/...`) |
| `POST /users/{id}/account/role` | `bot/routers/customers.py` | Only `PATCH` via `src/api/client.ts` |
| `GET /events/customers/{id}`, `WS /ws/customers/{id}` | `bot/routers/events.py`, `ws.py` | No callers in `src/` |
| `POST .../customers/.../verification/submit` | `bot/routers/customers.py` | Only exported in client, never called from UI |
| `POST .../providers/.../verification/submit` | `bot/routers/providers.py` | Same |

**Fix:** Remove legacy offer routes and unused customer SSE/WS, or mark deprecated; drop document-verification submit endpoints if product is OTP-only.

### 8. `getProviders()` fallback is dead after admin lock
**Files:** `src/api/client.ts` (`getProviders` → `GET /providers`), `src/components/provider/ProviderFlow.tsx` (`loadCurrentProvider`), `bot/routers/providers.py`

**Bug:** `GET /providers` requires admin session. ProviderFlow still falls back to `getProviders()` when `providerAuthToken` is missing → always 401. Dead path / confusing auth errors.

**Fix:** Remove `getProviders` fallback; require self-session / provider session only. Keep admin list admin-only.

### 9. `rebind_customer_orders(..., store_path=None)` hard-coded
**Files:** `bot/order_store.py` (`_claim_conflicting_guest_phone` → `rebind_customer_orders`)

**Bug:** Phone clear respects `store_path`; order rebind always uses default order store. Split test/env paths can clear phones without moving orders (history still “empty” after reclaim).

**Fix:** Pass the companion order store path (or `None` only when both defaults are used): `rebind_customer_orders(..., store_path=order_store_for(customer_store_path))`.

### 10. Auth alias helper inconsistency
**Files:** `bot/api_deps.py` (`require_customer_auth` vs `require_customer_auth_linked` vs `require_order_customer_owner`)

**Bug:** History allows linked URL ids; profile / events / WS customers require exact subject match. Cabinet already prefers token subject (`resolveCabinetHistoryCustomerId`), so linked auth is mostly unused — but any caller passing a guest alias id to profile gets 403 while history would 200.

**Fix:** Document single rule: URL id must equal session subject; resolve aliases only inside store listing/ownership. Or apply `require_customer_auth_linked` consistently to profile reads used by cabinet.

### 11. Partner history map location is accept-time snapshot only
**Files:** `bot/order_store.py` (`accept_offer` sets `assignedProvider.location`; `enrich_order_for_client`; presence updates provider row only)

**Bug:** Live GPS via `PATCH .../presence` does not refresh `order.assignedProvider.location`. Terminal history correctly prefers stored snapshot, but that snapshot is accept-time — not last approach point — so partner→client route on history can be wrong if partner moved a lot before `en_route`/`arrived`.

**Fix:** On status transitions `en_route` / `arrived`, copy current provider `location` into `order.assignedProvider.location` (and optionally keep `approachLocation` separate).

### 12. Phone-login user enumeration + soft Telegram session dual path
**Files:** `bot/routers/auth.py` (`customer_phone_login_send` → 404 `customer_not_found`); `bot/routers/telegram.py` (`GET /telegram/session/{chat_id}`) vs `POST /auth/customer/telegram/session`

**Bug:** Login send distinguishes unknown vs known numbers. `/telegram/session/{chat_id}` overlaps telegram session issuance (still used from `CustomerFlow`).

**Fix:** Always return generic `{ok:true, cooldown}` for login send; prefer one telegram session endpoint and deprecate the other once FE migrates fully to `/auth/customer/telegram/session`.

---

## Out of scope / already healthy (notes)

- Occupied geo reject on `POST /orders` and `/map/settlements/nearest` — present server-side.
- City sync is mostly client (`syncProfileCityFromGeo`); server stores `city` on profile/presence only — no extra dead city API beyond settlements.
- Order read / nearby / webhooks hardening appears present on current `main` (participant auth, provider nearby, webhook secret).
- History alias expansion via linked provider phone (`_customer_ids_for_order_history`) is the right direction for empty-cabinet after partner→client soft-patch — keep it, but close #1/#3/#9 so reclaim is safe and complete.
