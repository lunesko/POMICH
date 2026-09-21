# POMICH UI audit (2026-09-21)

Scope: React Mini App (`src/`) — duplicate panels/CTAs, entry/exit paths, dead code, broken handlers, hang risks.

## Fixed in this PR

| Severity | Issue | Fix |
|---|---|---|
| Critical | Desktop split `RideScreen` rendered peek **and** full sheet children | `filterSheetChildren(..., false, "expanded")` in split view |
| Critical | Duty toggle + «Піти з лінії» / «Вийти на лінію» duplicated | Removed leave-duty secondary; offline go-online stays on toggle + gate CTAs |
| High | Customer `PrimaryButton` always showed «Створюємо заявку…» when loading | Use `loadingLabel ?? label` |
| High | Call/Chat: `<button>` inside `<a>` (clicks often no-op) | `SecondaryButton` + `tel:` / `window.open` |
| High | Role switch left partner online (presence TTL ~60s) | `updateProviderPresence(offline)` before clearing tokens |
| High | Double `ThemeToggle` on partner form steps under AppShell | Removed local header toggle; deleted unused customer `Header` |
| High | Cabinet «На лінії» dropped offline without heartbeat | 12s presence heartbeat while online in cabinet |
| High | Sheet forced expanded for entire duty session | `expandedSheet` only from snap; set half/collapsed on duty change |
| Medium | SSE reconnect every 2–4s forever when API down | Exponential backoff (cap 30s) + pause when hidden/offline |

## Still open (next passes)

### High / medium
- Telegram `MainButton` + in-sheet `PrimaryButton` on destination/details/terminal (duplicate CTA)
- Telegram `BackButton` + sheet «← Назад» + AppShell «← Меню»
- Terminal «Вийти з акаунту» duplicates header logout
- Dual offer UI: `IncomingOfferStep` + `OrderRequestSheet` can stack
- Dual price state: `proposedPrice` / `sheetProposedPrice`
- Client «Кабінет» no-op when `account.profile` missing
- Partner password `AccountLoginStep` dead-end vs phone restore
- Landing `onHiddenAdmin` / logo hold imported but unwired
- Silent `.catch(() => undefined)` on map refresh / order poll
- Local `PrimaryButton`/`SecondaryButton` clones in mega-flows (prefer shared UI)

### Low / cleanup
- Unused CSS clusters (`pomich-sea-*`, orphan duty panel styles if unused on branch, etc.)
- Nested `PomichErrorBoundary` + `AppErrorBoundary`
- `Screen` union member `"profile"` unused
- `docs/UX_UI_CURRENT_SCENARIOS.md` out of date on DetailsStep
- Design-spec paste under `src/imports/` not used by app

## Screen tree (summary)

```
Landing → OnboardingGate → AppShell
  ├─ CustomerFlow (home → … → terminal)
  ├─ ProviderFlow (duty / offer / active job)
  └─ ClientCabinet | ProviderCabinet (replaces shell)
AdminFlow via ?role=admin / #admin
```

## Entry / exit notes

| Action | Behavior |
|---|---|
| ← Меню | Landing; session kept |
| Вийти | Full clear + hard reload — OK |
| Роль | Role picker; **now** also goes offline |
| Кабінет | Unmounts flow; partner remounts on back |
| Logout | Clears correctly |

## Test plan

- [ ] Desktop (≥tablet): home/duty side panel shows one sheet (full), not peek+full stacked
- [ ] Partner on duty: toggle only to leave line; no «Піти з лінії»
- [ ] Price confirm while loading shows «Підтверджуємо…» not «Створюємо заявку…»
- [ ] Call/Chat on assigned partner card works
- [ ] Switch role while online → partner goes offline on server
- [ ] Cabinet online stays online >60s (heartbeat)
- [ ] Kill API briefly → SSE reconnect backoff, no tight loop
