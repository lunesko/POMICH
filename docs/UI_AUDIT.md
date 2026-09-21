# POMICH UI audit (2026-09-21)

Scope: React Mini App (`src/`) — duplicate panels/CTAs, entry/exit paths, dead code, broken handlers, hang risks.

## Fixed in this PR

| Severity | Issue | Fix |
|---|---|---|
| Critical | Desktop split `RideScreen` rendered peek **and** full sheet children | `filterSheetChildren(..., false, "expanded")` in split view |
| Critical | Duty toggle + «Піти з лінії» duplicated | Removed leave-duty secondary; toggle + gate CTAs remain |
| High | Customer `PrimaryButton` always showed «Створюємо заявку…» when loading | Use `loadingLabel ?? label` |
| High | Call/Chat: `<button>` inside `<a>` | `SecondaryButton` + `tel:` / `window.open` |
| High | Role switch left partner online | `updateProviderPresence(offline)` before clearing tokens |
| High | Double `ThemeToggle` on partner form steps | Removed local header toggle |
| High | Cabinet «На лінії» dropped offline without heartbeat | 12s presence heartbeat while online |
| High | Sheet forced expanded for entire duty session | Snap-driven expand; half/collapsed on duty change |
| High | Telegram MainButton + in-sheet Primary on destination/details/terminal | Hide sheet primary/back when `isTelegram`; BackButton includes `details` |
| High | Terminal «Вийти з акаунту» duplicated AppShell logout | Stop passing `onLogout` into terminal sheet |
| High | Dual offer UI (`IncomingOfferStep` + sheet) | Offer step = IncomingOfferStep only; sheet only on duty |
| High | Dual price state | Single `proposedPrice` |
| High | Client «Кабінет» no-op without profile | Gate + profile prompt / enter flow |
| Medium | Partner password login dead-end | Prefer registration + phone restore when `onRestoreAccount` |
| Medium | Landing admin logo hold unwired | Long-press brand (~3s) → `onHiddenAdmin` |
| Medium | Silent map refresh failures | Surface `offerError` on offers/nearby refresh fail |
| Medium | SSE reconnect storm | Exponential backoff + pause when hidden/offline |
| Low | Unused `Screen` `"profile"` member | Removed from union |
| Low | Stale UX docs on DetailsStep / admin hold | Updated `docs/UX_UI_CURRENT_SCENARIOS.md` |
| Low | Unused design-spec paste | Deleted `src/imports/pasted_text/pomich-design-spec.md` |

## Still deferred (lower risk / larger refactors)

- Full replace of local `PrimaryButton`/`SecondaryButton` clones in mega-flows with shared `components/ui/*`
- Unused CSS cluster purge (`pomich-sea-*`, etc.) after dynamic-class audit
- Collapse nested `PomichErrorBoundary` + `AppErrorBoundary` into one
- Softer customer order-poll error banner (realtime is primary; silent catch remains for transient blips)
- AppShell «← Меню» vs Telegram Close crowding (header safe-area handled in separate PR)

## Screen tree (summary)

```
Landing → OnboardingGate → AppShell
  ├─ CustomerFlow (home → location → destination → details → review → … → terminal)
  ├─ ProviderFlow (duty / offer / active job)
  └─ ClientCabinet | ProviderCabinet (replaces shell)
AdminFlow via ?role=admin / #admin / logo long-press
```

## Entry / exit notes

| Action | Behavior |
|---|---|
| ← Меню | Landing; session kept |
| Вийти | Full clear + hard reload — OK |
| Роль | Role picker; also goes offline |
| Кабінет | Needs profile (client); otherwise profile prompt |
| Logout | Clears correctly |

## Test plan

- [x] Unit/integration suite (`pnpm test`)
- [ ] Desktop: one side panel (full), not peek+full stacked
- [ ] Partner online: no «Піти з лінії»; toggle leaves line
- [ ] Telegram: no duplicate Далі / terminal CTA with MainButton; Back covers details
- [ ] Offer step shows IncomingOfferStep only (no stacked sheet)
- [ ] Client Кабінет without profile → prompt, not dead end
- [ ] Landing brand long-press opens admin entry
- [ ] Switch role while online → partner offline on server
