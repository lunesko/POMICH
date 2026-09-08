# SEO Audit 2026 — POMICH (`pomich.help`)

**Дата аудиту:** 2026-09-08  
**Мета:** технічний SEO за стандартами 2026 (crawl → index → CWV → schema → AI retrieval).

## До / після (prod)

| Перевірка | Було | Стало (після деплою цієї гілки) |
|-----------|------|----------------------------------|
| `/robots.txt` | JSON `robots.txt not built` | `text/plain` Allow + Sitemap |
| `/sitemap.xml` | SPA HTML 200 | `application/xml` з canonical URL |
| Favicon / apple-touch | SPA HTML | PNG/ICO |
| `/manifest.webmanifest` | SPA HTML | Web App Manifest |
| OG image | немає | `/og-cover.jpg` |
| Meta description / OG | майже порожньо | через `site.json` + `index.html` |
| JSON-LD | немає | Organization + WebSite + Service |
| Публічні лендінги послуг | лише SPA shell | HTML з H1/canonical (`/evakuator` …) |
| `llms.txt` | немає | є (AI retrieval hint) |
| SSR/Next marketing | немає | **P1** (окремий шар) |

## Чеклист 2026

### Crawl & index
- [x] robots.txt на корені, не блокує CSS/JS/assets
- [x] Sitemap у robots.txt
- [x] Canonical на головній і SEO-лендінгах
- [x] HTTPS + редірект www (nginx)
- [ ] Search Console property + submit sitemap (ops)
- [ ] Bing Webmaster (ops)
- [ ] Окремі SSR сторінки міст/послуг без залежності від JS (**P1 Next.js**)

### Structured data & entities
- [x] Organization / WebSite / Service JSON-LD на головній
- [ ] FAQPage на лендінгах послуг
- [ ] LocalBusiness з NAP після появи телефону підтримки
- [ ] AggregateRating після ≥N реальних відгуків

### Page experience / CWV
- [x] theme-color, manifest, apple icons (PWA shell)
- [ ] Виміряти LCP/INP/CLS у CrUX / PSI на мобільному
- [ ] Preload LCP hero (після marketing SSR)
- [x] `noscript` fallback з лінками послуг

### AI / GEO (2026)
- [x] `llms.txt` з коротким описом сутності
- [x] Allow GPTBot / ClaudeBot / PerplexityBot у robots (цитування)
- [ ] BLUF-абзаци на SSR-сторінках послуг

### Не індексувати
- [x] `/api/` disallow
- [x] admin/provider token query params disallow
- [x] Sensitive paths `/.env` → 404 (не SPA)

## Обмеження поточного SPA

Google може рендерити JS, але **індексація маркетингу слабка**, поки контент послуг/міст не в першому HTML. Тому:
1. Зараз — thin SEO HTML для URL з sitemap (цей PR).
2. Далі — Next.js marketing шар (`docs/SEO_PUBLIC_LAYER.md`).

## Ops після деплою

1. Google Search Console → додати `https://pomich.help` → Sitemap `https://pomich.help/sitemap.xml`
2. URL Inspection на `/`, `/evakuator`, `/cities/uzhhorod`
3. Перевірити `site:pomich.help` через 1–2 тижні
