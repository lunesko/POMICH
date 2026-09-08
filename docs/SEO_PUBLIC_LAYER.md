# POMICH — SEO / публичный слой

**Проблема:** `pomich.help` — SPA. `site:pomich.help` пуст, crawler почти не видит контент.

## Решение (P0/P1)

Не переписывать React-приложение. Добавить **Marketing** слой на Next.js рядом с App.

```text
pomich.help
     │
 ┌───┴────┐
 │        │
 /        /app  (или Telegram Mini App)
 Next.js  Vite React
 SEO      Product UI
     │        │
     └── FastAPI ┘
```

## Страницы 1.0

| URL | H1 / смысл |
|-----|------------|
| `/` | POMICH — допомога на дорозі |
| `/evakuator` | Евакуатор |
| `/akumulyator` | Не заводиться / АКБ |
| `/zamina-kolesa` | Пробило колесо |
| `/dostavka-palnogo` | Закінчилось пальне |
| `/cities/uzhhorod` | Допомога в Ужгороді (пилот) |
| `/cities/lviv`, `/cities/kyiv` | позже |
| `/partner` | Стати партнером |
| `/about`, `/safety` | доверие |

Каждая страница: текст + FAQ + CTA «Викликати» → открывает App / `@pomich_ua_bot`.

## Технические must-have

- `robots.txt`, `sitemap.xml`, canonical
- Open Graph / Twitter cards
- JSON-LD `Service` / `LocalBusiness`
- favicon + PWA icons + `manifest.webmanifest`
- SSR/SSG для публичных URL (Next.js)

## Не смешивать

Google Maps SDK, KYC, payments — в App/API, не в marketing-страницах.
Подробный продуктовый контекст: [`POMICH_1_0_PRODUCTION.md`](./POMICH_1_0_PRODUCTION.md).
