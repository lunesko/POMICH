# POMICH interface icons

Use `Icon` for utility actions and `ServiceIcon` for the six assistance services.
Do not put emoji or Unicode pictograms in JSX, interface strings, CSS content,
service metadata, or bot message templates. Ordinary punctuation, copyright,
and user-provided content are not affected.

```tsx
<Icon name="phone" size={18} />
<ServiceIcon service="battery" size={24} />
<SecondaryButton label={<><Icon name="phone" size={18} /> Подзвонити</>} />
```

- Utility icons use the shared 24-unit SVG symbol sprite, inherit `currentColor`,
  and default to 20 px. Standard sizes are 16, 20, and 24 px.
- Service icons use the existing 40-unit service artwork and service accent
  palette. Unknown service keys fall back to the mechanic symbol.
- The sprites are imported through Vite with `?url&no-inline`. Do not remove
  `no-inline`: SVG `<use>` references must not point to inlined data URLs.
  Hashed assets follow the existing static serving, CSP, and cache configuration.
- Leaflet HTML must use `serviceMarkerMarkup` or `iconMarkup`. Never interpolate
  server-provided icon markup or a service key directly into HTML.
- SVGs are decorative (`aria-hidden`, `focusable=false`). Keep visible action
  text or an explicit accessible name on the parent button/link.
- Use `RatingStars` for read-only ratings. Its accessible label exposes the
  numeric rating; the review control keeps labelled radio buttons.
- Status meaning must have a text label. `StatusPill` differentiates draft,
  searching, active, completed, and cancelled states.
- Native Telegram messages cannot render SVG icons: keep these messages and
  keyboard labels text-only. The Mini App uses the same web SVG components.
- `npm run check:icons` checks application literals, JSX, CSS, and bot templates.
  Production builds run this check automatically.

Cookie notices have an explicit auto height and bounded scrollable height,
anchored below the application header rather than on top of bottom save actions.
The production legal-consent implementation differs from this repository's
CookieNotice. Verify the deployed commit/template before attributing the
production overlay bug to this exact implementation.
