"""POMICH FastAPI application factory.

HTTP routes live in bot.routers.*; shared auth/config helpers live in bot.api_deps.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from bot.api_deps import (
    AuthPrincipal,
    get_cors_origins,
    is_production_runtime,
    runtime_config_errors,
    validate_runtime_config,
)
from bot.routers import admin, auth, customers, events, health, internal, orders, providers, telegram, telemetry, ws
from bot.security_headers import SecurityHeadersMiddleware
from bot.telegram_bot import notify_dispatch_offers, notify_order_accepted, notify_order_cancelled, notify_order_created
from bot.runtime_store import get_engine, sql_storage_enabled
from bot.telegram_outbound import ensure_telegram_workers

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = PROJECT_ROOT / "dist"
ASSETS_DIR = DIST_DIR / "assets"
_DIST_GEO_DIR = DIST_DIR / "geo"
_PUBLIC_GEO_DIR = PROJECT_ROOT / "public" / "geo"
GEO_DIR = _DIST_GEO_DIR if _DIST_GEO_DIR.is_dir() else _PUBLIC_GEO_DIR
DATA_GEO_DIR = PROJECT_ROOT / "data" / "geo"
_DIST_MAPS_DIR = DIST_DIR / "maps"
_PUBLIC_MAPS_DIR = PROJECT_ROOT / "public" / "maps"
MAPS_DIR = _DIST_MAPS_DIR if _DIST_MAPS_DIR.is_dir() else _PUBLIC_MAPS_DIR

# Backwards-compatible aliases used by tests and older imports.
_is_production_runtime = is_production_runtime
_runtime_config_errors = runtime_config_errors
_validate_runtime_config = validate_runtime_config
_get_cors_origins = get_cors_origins

validate_runtime_config()

class CachedStaticFiles(StaticFiles):
    def __init__(self, *args, cache_control: str = "public, max-age=31536000, immutable", **kwargs):
        super().__init__(*args, **kwargs)
        self.cache_control = cache_control

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers.setdefault("Cache-Control", self.cache_control)
        return response


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    from bot.realtime_broker import start, stop
    from bot import data_lifecycle
    ensure_telegram_workers()
    if sql_storage_enabled():
        get_engine()
    start()
    if is_production_runtime():
        data_lifecycle.start()
    try:
        yield
    finally:
        data_lifecycle.stop()
        stop()


app = FastAPI(title="POMICH MVP", version="0.1.0", lifespan=_lifespan)


app.add_middleware(GZipMiddleware, minimum_size=400)

_cors_origins = get_cors_origins()
_cors_kwargs: dict = {
    "allow_origins": _cors_origins,
    "allow_credentials": True,
    "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "allow_headers": [
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-Requested-With",
        "X-POMICH-Admin-Token",
        "X-POMICH-Provider-Token",
        "X-POMICH-Health-Token",
        "X-POMICH-Internal-Token",
        "X-Telegram-Init-Data",
        "X-POMICH-Telegram-Bot",
    ],
}
# Tunnel regex only outside production — production must list exact HTTPS origins.
if not is_production_runtime():
    _cors_kwargs["allow_origin_regex"] = r"https://.*\.trycloudflare\.com"

app.add_middleware(CORSMiddleware, **_cors_kwargs)
# Outer-most for response headers on every path (HTML + API).
app.add_middleware(SecurityHeadersMiddleware)

_API_ROUTERS = (
    health.router,
    telemetry.router,
    admin.router,
    auth.router,
    customers.router,
    providers.router,
    orders.router,
    telegram.router,
    events.router,
    ws.router,
)

# Single mount under /api — frontend always uses VITE_API_BASE_URL=/api.
for router in _API_ROUTERS:
    app.include_router(router, prefix="/api")

# Internal ops (nginx allowlist + optional token on metrics).
app.include_router(internal.router)

if ASSETS_DIR.exists():
    app.mount("/assets", CachedStaticFiles(directory=ASSETS_DIR), name="assets")

_FONTS_DIR = DIST_DIR / "fonts"
_PUBLIC_FONTS_DIR = PROJECT_ROOT / "public" / "fonts"
FONTS_DIR = _FONTS_DIR if _FONTS_DIR.is_dir() else _PUBLIC_FONTS_DIR
if FONTS_DIR.is_dir():
    app.mount(
        "/fonts",
        CachedStaticFiles(directory=FONTS_DIR, cache_control="public, max-age=31536000, immutable"),
        name="fonts",
    )

def _resolve_geo_file(filename: str) -> Path | None:
    for base in (GEO_DIR, DATA_GEO_DIR):
        candidate = base / filename
        if candidate.is_file():
            return candidate
    return None


def _resolve_maps_file(filename: str) -> Path | None:
    if not filename or filename.startswith(".") or ".." in filename.split("/"):
        return None
    for base in (MAPS_DIR, _PUBLIC_MAPS_DIR, _DIST_MAPS_DIR):
        candidate = (base / filename).resolve()
        try:
            candidate.relative_to(base.resolve())
        except ValueError:
            continue
        if not candidate.is_file():
            continue
        # Never serve Git LFS pointer stubs as images.
        try:
            head = candidate.read_bytes()[:64]
        except OSError:
            continue
        if head.startswith(b"version https://git-lfs.github.com/spec/v1"):
            continue
        return candidate
    return None


_GEO_CACHE_CONTROL = "public, max-age=3600"
_MAPS_CACHE_CONTROL = "public, max-age=86400"

if GEO_DIR.exists():
    app.mount("/geo", CachedStaticFiles(directory=GEO_DIR, cache_control=_GEO_CACHE_CONTROL), name="geo")
elif DATA_GEO_DIR.exists():
    app.mount("/geo", CachedStaticFiles(directory=DATA_GEO_DIR, cache_control=_GEO_CACHE_CONTROL), name="geo")

# Maps are served only via serve_frontend → _resolve_maps_file (not StaticFiles mount).
# A mount binds the directory at import time and breaks tests / can serve Git LFS pointers.

_INDEX_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Surrogate-Control": "no-store",
}


# Dotfiles and VCS/config paths must never fall through to SPA index.html (scanners get HTML 200).
_SENSITIVE_SPA_PREFIXES = (
    ".env",
    ".git",
    ".svn",
    ".hg",
    ".bzr",
    ".ds_store",
    ".aws",
    ".ssh",
    ".docker",
    ".npmrc",
    ".htaccess",
    ".htpasswd",
    "docker-compose",
    "compose.yaml",
    "compose.yml",
    "id_rsa",
    "id_ed25519",
    "credentials",
)


def _is_sensitive_spa_path(normalized: str) -> bool:
    lowered = normalized.lower().lstrip("/")
    if not lowered:
        return False
    if lowered.startswith(".") or "/." in lowered:
        return True
    return any(lowered == prefix or lowered.startswith(f"{prefix}/") or lowered.startswith(f"{prefix}.") for prefix in _SENSITIVE_SPA_PREFIXES)


def _resolve_dist_root_file(normalized: str) -> Path | None:
    """Serve Vite public/root artifacts (pomich-sw.js, favicon, etc.) before SPA fallback."""
    if not normalized or normalized.startswith("."):
        return None
    # Allow flat root files and one-level paths like cities/uzhhorod.html if present.
    if "/" in normalized and normalized.count("/") > 1:
        return None
    for base in (DIST_DIR, PROJECT_ROOT / "public"):
        candidate = (base / normalized).resolve()
        try:
            candidate.relative_to(base.resolve())
        except ValueError:
            continue
        if candidate.is_file():
            return candidate
    return None


_SEO_PUBLIC_PAGES: dict[str, dict[str, str]] = {
    "evakuator": {
        "title": "Евакуатор в Ужгороді та Україні — виклик через POMICH",
        "h1": "Евакуатор поруч",
        "lead": "Викликайте евакуатор через POMICH: підтвердіть місце — і ми знайдемо партнера поруч.",
    },
    "akumulyator": {
        "title": "Не заводиться авто / запуск АКБ — POMICH",
        "h1": "Не заводиться?",
        "lead": "Швидкий виклик допомоги з акумулятором поруч із вами.",
    },
    "zamina-kolesa": {
        "title": "Пробило колесо — допомога на дорозі POMICH",
        "h1": "Пробило колесо",
        "lead": "Заміна або ремонт колеса на місці через перевірених партнерів POMICH.",
    },
    "dostavka-palnogo": {
        "title": "Закінчилось пальне — доставка через POMICH",
        "h1": "Закінчилось пальне",
        "lead": "Доставка пального до вас без пошуку номерів і торгу по телефону.",
    },
    "partner": {
        "title": "Стати партнером POMICH — заявки поруч",
        "h1": "Стати партнером",
        "lead": "Приймайте реальні заявки поруч у Telegram. Безкоштовний вхід для пілоту в Ужгороді.",
    },
    "about": {
        "title": "Про POMICH — допомога автомобілістам на дорозі",
        "h1": "Про POMICH",
        "lead": "POMICH — платформа швидкої допомоги на дорозі: від проблеми до перевіреного виконавця поруч.",
    },
    "safety": {
        "title": "Безпека в POMICH",
        "h1": "Безпека",
        "lead": "POMICH не замінює екстрені служби 112. При ДТП з постраждалими спочатку викличте 112.",
    },
    "privacy": {
        "title": "Політика конфіденційності POMICH",
        "h1": "Політика конфіденційності",
        "lead": "Дата набрання чинності: 15 жовтня 2026 року. Ця Політика регулює збір, використання, обробку та захист інформації користувачів сервісу POMICH.",
        "body_html": """
    <p>POMICH — сервіс допомоги на дорозі (евакуатор, запуск АКБ, заміна колеса, доставка пального) через вебзастосунок і Telegram-ботів на домені <a href="https://pomich.help/">pomich.help</a>.</p>
    <p>Використовуючи POMICH, Користувач підтверджує, що ознайомився з цією Політикою конфіденційності та <a href="/terms">Угодою користувача</a> і приймає їх умови. При першому відкритті застосунку згода зберігається локально на пристрої (кнопка «Погоджуюсь»).</p>

    <h2>1. Загальні положення</h2>
    <p>1.1. Ця Політика конфіденційності (далі — «Політика») регулює порядок обробки та захисту інформації, яку ми отримуємо під час використання сервісу POMICH (далі — «Сервіс»).</p>
    <p>1.2. Використовуючи Сервіс, Користувач підтверджує згоду з умовами цієї Політики. Якщо Користувач не згоден, він має припинити використання Сервісу.</p>
    <p>1.3. Сервіс обробляє лише дані, необхідні для надання допомоги на дорозі, безпеки, зв’язку з Користувачем і стабільної роботи платформи.</p>
    <p>1.4. POMICH не замінює екстрені служби. При ДТП з постраждалими спочатку викличте 112 — див. також сторінку <a href="/safety">Безпека</a>.</p>

    <h2>2. Збір інформації</h2>
    <p>2.1. Під час використання Сервісу можуть оброблятися такі дані:</p>
    <ul>
      <li>ім’я, телефон, електронна пошта (якщо вказана) та місто профілю клієнта або партнера;</li>
      <li>Telegram ID / chat ID, username і дані Telegram WebApp, якщо ви відкриваєте Mini App через бота;</li>
      <li>геолокація місця поломки / подачі заявки (за згодою в браузері або Telegram);</li>
      <li>дані заявки: тип послуги, деталі, статус, історія повідомлень у межах Сервісу;</li>
      <li>дані профілю партнера: спеціалізації, статус онлайн, приблизне розташування на карті;</li>
      <li>технічні логи (IP, пристрій, помилки) для безпеки та стабільності.</li>
    </ul>
    <p>2.2. Сервіс не вимагає паспортних даних, документів, фотографій документів чи адреси проживання, якщо це прямо не потрібно для окремої функції перевірки в майбутньому.</p>
    <p>2.3. Точні координати та контакти клієнта передаються залученому партнеру лише в обсязі, потрібному для виконання заявки. На публічній карті розташування може відображатися з округленням для захисту приватності.</p>

    <h2>3. Використання інформації</h2>
    <p>3.1. Отримана інформація використовується виключно для:</p>
    <ul>
      <li>роботи POMICH і виконання заявок допомоги на дорозі;</li>
      <li>пошуку партнера поруч і зв’язку між клієнтом і виконавцем;</li>
      <li>підтвердження особи (OTP) і запобігання шахрайству;</li>
      <li>забезпечення стабільності та безпеки Сервісу;</li>
      <li>підтримки Користувача та покращення роботи Сервісу.</li>
    </ul>
    <p>3.2. Дані Користувачів не продаються і не передаються третім особам у рекламних цілях.</p>

    <h2>4. Передача інформації третім особам</h2>
    <p>4.1. Для окремих функцій інформація може передаватися стороннім постачальникам у обсязі, необхідному для відповідної операції.</p>
    <p>4.2. Зокрема, POMICH використовує:</p>
    <ul>
      <li>Telegram API — доставка повідомлень і робота Mini App / ботів;</li>
      <li>інфраструктуру хостингу та бази даних — зберігання й обробка облікових записів і заявок;</li>
      <li>OpenStreetMap / Nominatim — пошук і зворотне геокодування адрес (браузер надсилає запит безпосередньо);</li>
      <li>OSRM — побудова маршрутів;</li>
      <li>OpenStreetMap, CARTO або Esri — зображення карти (тайли); ці сервіси отримують IP-адресу та параметри запиту (текст пошуку, координати маршруту або область карти).</li>
    </ul>
    <p>4.3. Дані заявки передаємо залученому партнеру лише в обсязі, потрібному для виконання послуги. POMICH не передає стороннім сервісам більше інформації, ніж необхідно.</p>
    <p>4.4. Інформація також може бути надана третім особам, якщо це вимагає застосовне законодавство або здійснюється за згодою Користувача.</p>
    <p>4.5. Обробка даних сторонніми сервісами може додатково регулюватися їхніми власними політиками конфіденційності.</p>

    <h2>5. Cookies та локальне сховище</h2>
    <p>5.1. Для відновлення входу використовуємо захищені HttpOnly cookies. Без «Залишатися в системі» cookie діє до закриття браузера, а сесія — максимум 12 годин. Браузер із відновленням вкладок може зберегти сесійну cookie після перезапуску. З галочкою вхід зберігається на 30 днів від моменту входу. Вихід видаляє cookies входу з цього браузера.</p>
    <p>5.2. Локальне сховище зберігає налаштування інтерфейсу, міста та підтвердження згоди з цією Політикою (кнопка «Погоджуюсь» при першому відкритті). Для видалення цих даних скористайтеся налаштуваннями браузера.</p>

    <h2>6. Зберігання та захист даних</h2>
    <p>6.1. Дані Користувача зберігаються лише протягом строку, необхідного для роботи Сервісу та цілей цієї Політики.</p>
    <p>6.2. Завершені та скасовані заявки автоматично видаляються через 180 днів після останньої зміни. Активні заявки автоматична очистка не видаляє. Профіль зберігається, поки існує обліковий запис.</p>
    <p>6.3. Резервні копії можуть містити видалені дані до завершення строку зберігання відповідної копії; вони використовуються лише для відновлення після аварії.</p>
    <p>6.4. Адміністрація вживає розумних технічних і організаційних заходів для захисту даних від неправомірного доступу, зміни, розкриття або знищення (зокрема захищені cookies сесії, обмеження доступу до контактів до призначення партнера).</p>
    <p>6.5. Попри заходи захисту, Адміністрація не може гарантувати абсолютну безпеку інформації під час передачі через інтернет і використання сторонніх сервісів.</p>

    <h2>7. Платежі</h2>
    <p>7.1. На поточному етапі POMICH не приймає онлайн-платежі всередині Сервісу. Оплата послуги, якщо вона відбувається, узгоджується безпосередньо між клієнтом і партнером поза платіжною інфраструктурою POMICH.</p>
    <p>7.2. Якщо в майбутньому з’являться вбудовані платежі, умови обробки платіжних даних будуть окремо описані в оновленій редакції цієї Політики.</p>

    <h2>8. Права Користувача</h2>
    <p>8.1. У кабінеті клієнта можна завантажити копію профілю та заявок або видалити обліковий запис. Видалення недоступне, поки є активна заявка.</p>
    <p>8.2. Для пов’язаного профілю партнера та інших випадків, що потребують перевірки, зверніться до підтримки в Telegram <a href="https://t.me/pomich_ua_bot">@pomich_ua_bot</a>.</p>

    <h2>9. Відповідальність</h2>
    <p>9.1. Користувач розуміє, що передача інформації через інтернет і використання сторонніх сервісів завжди пов’язані з певними ризиками.</p>
    <p>9.2. Адміністрація не несе відповідальності за неправомірний доступ, втрату або розкриття інформації внаслідок дій третіх осіб, обставин поза розумним контролем Адміністрації чи дій самого Користувача.</p>
    <p>9.3. Партнери самостійно відповідають за якість наданих послуг на місці; POMICH є платформою з’єднання клієнта з виконавцем.</p>

    <h2>10. Зміна Політики</h2>
    <p>10.1. Адміністрація має право вносити зміни та доповнення до цієї Політики.</p>
    <p>10.2. Актуальна редакція публікується на сторінці <a href="https://pomich.help/privacy">pomich.help/privacy</a>.</p>
    <p>10.3. Продовження використання POMICH після набрання чинності змін означає прийняття Користувачем нової редакції. За потреби ми можемо знову показати запит згоди в застосунку.</p>

    <h2>11. Контактна інформація</h2>
    <p>З питань цієї Політики, обробки даних або роботи POMICH звертайтеся:</p>
    <p>Telegram: <a href="https://t.me/pomich_ua_bot">@pomich_ua_bot</a></p>
    <p class="meta">Оновлено: 15 жовтня 2026 · POMICH · Україна</p>
""",
    },
    "terms": {
        "title": "Угода користувача POMICH",
        "h1": "Угода користувача",
        "lead": "Дата набрання чинності: 15 жовтня 2026 року. Ця Угода регулює порядок використання сервісу POMICH.",
        "body_html": """
    <p>POMICH — сервіс допомоги на дорозі (евакуатор, запуск АКБ, заміна колеса, доставка пального) через вебзастосунок і Telegram-ботів на домені <a href="https://pomich.help/">pomich.help</a>.</p>
    <p>Використовуючи POMICH — зокрема відкриваючи застосунок, створюючи заявку, приймаючи заявку як партнер, реєструючи профіль або продовжуючи користування — Користувач підтверджує, що ознайомився з цією Угодою та приймає її умови. При першому відкритті застосунку згода зберігається локально на пристрої (кнопка «Погоджуюсь»).</p>

    <h2>1. Загальні положення</h2>
    <p>1.1. Ця Угода користувача (далі — «Угода») регулює порядок використання сервісу POMICH (далі — «Сервіс»), призначеного для з’єднання клієнтів, які потребують допомоги на дорозі, з перевіреними партнерами-виконавцями.</p>
    <p>1.2. Використовуючи Сервіс, Користувач підтверджує, що повністю ознайомився з умовами цієї Угоди та приймає їх. У разі незгоди Користувач зобов’язаний припинити використання Сервісу.</p>
    <p>1.3. Окремі функції Сервісу можуть надаватися безкоштовно або в межах пілотного / бета-режиму на умовах, зазначених у інтерфейсі.</p>
    <p>1.4. POMICH не замінює екстрені служби. При ДТП з постраждалими спочатку викличте 112 — див. також сторінку <a href="/safety">Безпека</a>.</p>

    <h2>2. Характер послуг</h2>
    <p>2.1. POMICH надає програмну платформу для створення заявок на допомогу на дорозі та пошуку партнерів поруч.</p>
    <p>2.2. Функціональні можливості Сервісу можуть включати:</p>
    <ul>
      <li>створення та відстеження заявок клієнтом (евакуатор, АКБ, колесо, пальне та інші доступні типи);</li>
      <li>показ карти, пошук адрес і маршрутів;</li>
      <li>пропозиції та прийняття заявок партнерами;</li>
      <li>профілі клієнта та партнера, підтвердження контактів (OTP);</li>
      <li>сповіщення через вебзастосунок і Telegram-ботів;</li>
      <li>інші функції, доступні в інтерфейсі POMICH.</li>
    </ul>
    <p>2.3. POMICH є посередницькою платформою: фактичну послугу на місці надає партнер, а не Адміністрація Сервісу.</p>
    <p>2.4. Адміністрація має право змінювати технології, постачальників інфраструктури (хостинг, карти, Telegram API тощо) за умови збереження основного призначення Сервісу.</p>

    <h2>3. Ролі Користувачів</h2>
    <p>3.1. <strong>Клієнт</strong> створює заявку, підтверджує місцеположення та контактні дані, очікує виконавця і самостійно узгоджує деталі виконання з партнером.</p>
    <p>3.2. <strong>Партнер</strong> приймає заявки в межах своїх спеціалізацій і зони роботи, відповідає за якість і законність наданих послуг, наявність необхідних дозволів і стан обладнання.</p>
    <p>3.3. Користувач несе відповідальність за достовірність даних у профілі та заявках.</p>

    <h2>4. Відмова від гарантій і обмеження відповідальності</h2>
    <p>4.1. Сервіс надається на умовах «AS IS» («як є»), зокрема в бета / пілотному режимі.</p>
    <p>4.2. Адміністрація не гарантує:</p>
    <ul>
      <li>миттєву наявність партнера поруч у будь-який момент;</li>
      <li>безперебійну та безпомилкову роботу Сервісу;</li>
      <li>постійну доступність усіх функцій;</li>
      <li>сумісність із усіма майбутніми змінами Telegram, браузерів чи сторонніх картографічних сервісів;</li>
      <li>результат або строк виконання послуги партнером.</li>
    </ul>
    <p>4.3. Адміністрація не несе відповідальності за якість, строки, шкоду чи інші наслідки послуг, наданих партнером на місці, у межах, що допускаються застосовним законодавством.</p>
    <p>4.4. Адміністрація не несе відповідальності за тимчасову недоступність або порушення роботи Сервісу, спричинені збоями Telegram, картографічних / мережевих сервісів, хостинг-провайдерів, технічними роботами або обставинами поза розумним контролем Адміністрації.</p>
    <p>4.5. POMICH не замінює власника транспортного засобу, страхову компанію чи екстрені служби.</p>

    <h2>5. Законність використання</h2>
    <p>5.1. Користувач зобов’язується використовувати POMICH виключно законним способом і дотримуватися застосовного законодавства, правил Telegram і умов сторонніх сервісів.</p>
    <p>5.2. Забороняється використовувати Сервіс для:</p>
    <ul>
      <li>протиправної діяльності;</li>
      <li>порушення прав і законних інтересів третіх осіб;</li>
      <li>отримання несанкціонованого доступу до чужих акаунтів, заявок або даних;</li>
      <li>навмисного порушення чи обходу технічних обмежень Сервісу;</li>
      <li>створення надмірного навантаження на інфраструктуру;</li>
      <li>втручання в роботу Сервісу або використання вразливостей на шкоду.</li>
    </ul>
    <p>5.3. Партнер несе відповідальність за законність надання послуг (ліцензії, допуски, страхування — якщо вимагаються законом) у своїй діяльності.</p>

    <h2>6. Обліковий запис і безпека</h2>
    <p>6.1. Ідентифікація Користувача може здійснюватися через телефон, електронну пошту, пароль і/або обліковий запис Telegram (Mini App).</p>
    <p>6.2. Користувач несе відповідальність за безпеку своїх засобів доступу до Сервісу.</p>
    <p>6.3. Дії, вчинені через обліковий запис Користувача, можуть вважатися вчиненими самим Користувачем, якщо немає достатніх підстав вважати інакше.</p>
    <p>6.4. При виявленні несанкціонованого доступу Користувач має якнайшвидше звернутися до підтримки: <a href="https://t.me/pomich_ua_bot">@pomich_ua_bot</a>.</p>

    <h2>7. Інтелектуальна власність</h2>
    <p>7.1. Програмне забезпечення, дизайн, елементи інтерфейсу, тексти, найменування POMICH та інші матеріали Сервісу є об’єктами інтелектуальної власності відповідних правовласників.</p>
    <p>7.2. Використання Сервісу не надає Користувачу виключних прав на програмне забезпечення чи матеріали POMICH.</p>
    <p>7.3. Забороняється без дозволу Адміністрації копіювати, модифікувати, поширювати, перепродувати або іншим чином використовувати матеріали POMICH поза способами, необхідними для звичайного користування Сервісом.</p>

    <h2>8. Обмеження доступу</h2>
    <p>8.1. Адміністрація має право тимчасово обмежити або припинити доступ Користувача до Сервісу у разі порушення цієї Угоди, зловживання можливостями Сервісу, спроб втручання, загрози безпеці, протиправної діяльності або вимог законодавства чи уповноважених сторін.</p>
    <p>8.2. У разі істотного або повторного порушення доступ може бути припинено без попереднього повідомлення, якщо інше не вимагається застосовним законодавством.</p>
    <p>8.3. Обмеження доступу не звільняє Користувача від зобов’язань, що виникли до моменту такого обмеження.</p>

    <h2>9. Оплата</h2>
    <p>9.1. На поточному етапі POMICH не приймає онлайн-платежі всередині Сервісу. Оплата послуги партнера, якщо вона відбувається, узгоджується безпосередньо між клієнтом і партнером.</p>
    <p>9.2. Якщо в майбутньому з’являться вбудовані тарифи чи платежі, їх вартість, умови та спосіб оплати будуть зазначені в інтерфейсі до підтвердження, а ця Угода буде оновлена.</p>

    <h2>10. Конфіденційність і обробка даних</h2>
    <p>10.1. Порядок збору, використання, зберігання та обробки інформації регулюється окремою <a href="/privacy">Політикою конфіденційності</a> POMICH.</p>
    <p>10.2. Використовуючи Сервіс, Користувач підтверджує, що ознайомився з Політикою конфіденційності.</p>

    <h2>11. Зміна та припинення роботи Сервісу</h2>
    <p>11.1. Адміністрація має право оновлювати, змінювати, додавати або видаляти окремі функції POMICH.</p>
    <p>11.2. Для технічних робіт доступ до Сервісу або окремих функцій може бути тимчасово обмежено.</p>
    <p>11.3. Адміністрація має право припинити надання Сервісу повністю або частково.</p>

    <h2>12. Зміна Угоди</h2>
    <p>12.1. Адміністрація має право вносити зміни та доповнення до цієї Угоди.</p>
    <p>12.2. Актуальна редакція публікується на сторінці <a href="https://pomich.help/terms">pomich.help/terms</a>.</p>
    <p>12.3. Продовження використання Сервісу після набрання чинності змін означає прийняття оновленої редакції в тій мірі, в якій це допускається застосовним законодавством. За потреби ми можемо знову показати запит згоди в застосунку.</p>

    <h2>13. Контактна інформація</h2>
    <p>З питань роботи POMICH або цієї Угоди звертайтеся:</p>
    <p>Telegram: <a href="https://t.me/pomich_ua_bot">@pomich_ua_bot</a></p>
    <p class="meta">Оновлено: 15 жовтня 2026 · POMICH · Україна</p>
    <p>Використовуючи POMICH, Користувач підтверджує, що ознайомився з цією Угодою та приймає її умови.</p>
""",
    },
    "cities/uzhhorod": {
        "title": "Допомога на дорозі в Ужгороді — POMICH",
        "h1": "Допомога в Ужгороді",
        "lead": "Пілот POMICH: евакуатор, АКБ, колесо, пальне — виклик за хвилини.",
    },
}


_LEGAL_SEO_SLUGS = frozenset({"privacy", "terms"})


def _seo_page_html(slug: str, page: dict[str, str]) -> str:
    if slug in _LEGAL_SEO_SLUGS:
        return _seo_legal_html(slug, page)
    return _seo_landing_html(slug, page)


def _seo_landing_html(slug: str, page: dict[str, str]) -> str:
    title = page["title"]
    h1 = page["h1"]
    lead = page["lead"]
    extra = page.get("body_html", "")
    canonical = f"https://pomich.help/{slug}"
    return f"""<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{title}</title>
  <meta name="description" content="{lead}" />
  <link rel="canonical" href="{canonical}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{lead}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://pomich.help/og-cover-v2.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1730" />
  <meta property="og:image:height" content="909" />
  <meta property="og:image:alt" content="Pomich — допомога на дорозі: евакуатор, АКБ, колесо, пальне." />
  <meta property="og:locale" content="uk_UA" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{lead}" />
  <meta name="twitter:image" content="https://pomich.help/og-cover-v2.png" />
  <meta name="twitter:image:alt" content="Pomich — допомога на дорозі: евакуатор, АКБ, колесо, пальне." />
  <meta name="robots" content="index,follow" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800&family=Sora:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    body{{margin:0;font-family:Sora,system-ui,sans-serif;background:#0B1220;color:#F1F5F9;line-height:1.55}}
    main{{max-width:40rem;margin:0 auto;padding:2rem 1.25rem 4rem}}
    h1{{font-family:Outfit,Sora,sans-serif;font-size:clamp(1.75rem,4vw,2.25rem);letter-spacing:-.03em;margin:0 0 .75rem}}
    h2{{font-size:1.05rem;margin:1.5rem 0 .5rem;letter-spacing:-.02em}}
    a{{color:#4ade80}}
    .cta{{display:inline-block;margin-top:1.25rem;padding:.75rem 1.1rem;border-radius:12px;background:linear-gradient(135deg,#16A36A,#0B7A4D);color:#fff;font-weight:800;text-decoration:none}}
    ul{{padding-left:1.1rem}}
    .meta{{color:#94A3B8;font-size:.9rem}}
  </style>
</head>
<body>
  <main>
    <p><a href="/">POMICH</a></p>
    <h1>{h1}</h1>
    <p>{lead}</p>
    {extra}
    <p><a class="cta" href="/?utm_source=seo&amp;utm_campaign={slug}">Відкрити застосунок</a></p>
    <p class="meta">Telegram: <a href="https://t.me/pomich_ua_bot">@pomich_ua_bot</a></p>
    <h2>Послуги</h2>
    <ul>
      <li><a href="/evakuator">Евакуатор</a></li>
      <li><a href="/akumulyator">Не заводиться</a></li>
      <li><a href="/zamina-kolesa">Пробило колесо</a></li>
      <li><a href="/dostavka-palnogo">Закінчилось пальне</a></li>
      <li><a href="/cities/uzhhorod">Ужгород</a></li>
      <li><a href="/partner">Партнерам</a></li>
      <li><a href="/privacy">Конфіденційність</a></li>
      <li><a href="/terms">Угода користувача</a></li>
      <li><a href="/safety">Безпека</a></li>
    </ul>
  </main>
</body>
</html>
"""


def _seo_legal_html(slug: str, page: dict[str, str]) -> str:
    """Landing-styled legal pages (/privacy, /terms) with back-home and scroll-to-top."""
    title = page["title"]
    h1 = page["h1"]
    lead = page["lead"]
    extra = page.get("body_html", "")
    canonical = f"https://pomich.help/{slug}"
    sibling_href = "/terms" if slug == "privacy" else "/privacy"
    sibling_label = "Угода користувача" if slug == "privacy" else "Конфіденційність"
    return f"""<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{title}</title>
  <meta name="description" content="{lead}" />
  <link rel="canonical" href="{canonical}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{lead}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://pomich.help/og-cover-v2.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1730" />
  <meta property="og:image:height" content="909" />
  <meta property="og:image:alt" content="Pomich — допомога на дорозі: евакуатор, АКБ, колесо, пальне." />
  <meta property="og:locale" content="uk_UA" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{lead}" />
  <meta name="twitter:image" content="https://pomich.help/og-cover-v2.png" />
  <meta name="twitter:image:alt" content="Pomich — допомога на дорозі: евакуатор, АКБ, колесо, пальне." />
  <meta name="robots" content="index,follow" />
  <meta name="theme-color" content="#E2E9E6" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800;900&family=Sora:wght@600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {{
      --text:#1A2332; --muted:#4A5A68; --brand:#16A36A; --accent:#0B7A4D;
      --border:rgba(28,42,36,.12); --card:rgba(236,241,238,.92);
      --nav:rgba(232,238,235,.94); --footer:rgba(238,244,248,.92);
    }}
    * {{ box-sizing:border-box }}
    html {{ scroll-behavior:smooth }}
    body {{
      margin:0; font-family:Sora,system-ui,sans-serif; color:var(--text); line-height:1.55;
      background:
        radial-gradient(ellipse 120% 80% at 20% 0%, rgba(22,163,106,.12), transparent 55%),
        radial-gradient(ellipse 90% 70% at 85% 15%, rgba(47,128,237,.08), transparent 50%),
        linear-gradient(165deg, #ecf1ee 0%, #e2eae6 48%, #d6e0db 100%);
      min-height:100vh;
    }}
    a {{ color:var(--accent); font-weight:700 }}
    a:hover {{ color:var(--brand) }}
    .legal-header {{
      position:sticky; top:0; z-index:40;
      background:var(--nav); backdrop-filter:blur(14px);
      border-bottom:1px solid var(--border);
    }}
    .legal-header__inner {{
      max-width:720px; margin:0 auto; padding:12px 16px;
      display:flex; align-items:center; justify-content:space-between; gap:12px;
    }}
    .legal-brand {{
      display:inline-flex; align-items:center; gap:10px; text-decoration:none; color:var(--text);
      font-family:Outfit,Sora,sans-serif; font-weight:900; font-size:1.15rem; letter-spacing:-.02em;
    }}
    .legal-brand img {{ width:36px; height:36px; border-radius:10px; object-fit:cover }}
    .legal-back {{
      display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:0 14px;
      border-radius:12px; border:1px solid var(--border); background:rgba(28,42,36,.05);
      color:var(--text); text-decoration:none; font-weight:800; font-size:.9rem;
    }}
    .legal-back:hover {{ background:rgba(22,163,106,.12); color:var(--accent); border-color:rgba(22,163,106,.28) }}
    .legal-main {{ max-width:720px; margin:0 auto; padding:28px 16px 96px }}
    .legal-card {{
      background:var(--card); border:1px solid var(--border); border-radius:20px;
      box-shadow:0 8px 24px rgba(28,42,36,.06), 0 1px 2px rgba(0,0,0,.03);
      padding:clamp(1.25rem,3vw,2rem);
    }}
    .legal-eyebrow {{
      display:inline-flex; border:1px solid rgba(47,128,237,.42); background:rgba(47,128,237,.14);
      color:#1D6FD4; border-radius:999px; padding:6px 12px; font-weight:900; font-size:12px; margin:0 0 14px;
    }}
    h1 {{
      font-family:Outfit,Sora,sans-serif; font-size:clamp(1.75rem,4vw,2.35rem);
      letter-spacing:-.03em; margin:0 0 .75rem; line-height:1.1; font-weight:900;
      background:linear-gradient(90deg,#0B7A4D 0%,#1D6FD4 52%,#B8860B 100%);
      -webkit-background-clip:text; background-clip:text; color:transparent;
    }}
    .legal-lead {{ margin:0 0 1.25rem; color:var(--muted); font-weight:700; font-size:1.02rem }}
    .legal-body h2 {{
      font-size:1.05rem; margin:1.6rem 0 .55rem; letter-spacing:-.02em; font-weight:900; color:var(--text);
    }}
    .legal-body p {{ margin:.55rem 0 }}
    .legal-body ul {{ padding-left:1.15rem; margin:.5rem 0 }}
    .legal-body li {{ margin:.3rem 0 }}
    .legal-body .meta {{ color:var(--muted); font-size:.9rem; font-weight:650 }}
    .legal-actions {{
      display:flex; flex-wrap:wrap; gap:10px; margin-top:1.75rem; align-items:center;
    }}
    .cta {{
      display:inline-flex; align-items:center; justify-content:center; min-height:48px;
      padding:.75rem 1.15rem; border-radius:12px;
      background:linear-gradient(135deg,#16A36A,#0B7A4D); color:#fff !important;
      font-weight:900; text-decoration:none; border:none;
    }}
    .cta:hover {{ filter:brightness(1.05); color:#fff !important }}
    .ghost {{
      display:inline-flex; align-items:center; justify-content:center; min-height:48px;
      padding:.75rem 1.1rem; border-radius:12px; border:1px solid var(--border);
      background:rgba(28,42,36,.04); color:var(--text) !important; font-weight:800; text-decoration:none;
    }}
    .legal-footer {{
      border-top:1px solid var(--border); background:var(--footer);
      padding:20px 16px 28px; color:var(--muted); font-size:13px; font-weight:700;
    }}
    .legal-footer__inner {{ max-width:720px; margin:0 auto; display:grid; gap:12px }}
    .legal-footer__links {{ display:flex; flex-wrap:wrap; gap:8px 14px }}
    .legal-footer a {{ color:inherit; text-decoration:none; opacity:.9 }}
    .legal-footer a:hover {{ color:var(--accent); opacity:1 }}
    #to-top {{
      position:fixed; right:max(16px, env(safe-area-inset-right));
      bottom:max(16px, env(safe-area-inset-bottom));
      width:48px; height:48px; border-radius:14px; border:1px solid var(--border);
      background:linear-gradient(135deg,#16A36A,#0B7A4D); color:#fff;
      box-shadow:0 10px 28px rgba(11,122,77,.28); cursor:pointer;
      display:none; align-items:center; justify-content:center; z-index:50;
      font-size:1.25rem; font-weight:900; line-height:1;
    }}
    #to-top.is-visible {{ display:inline-flex }}
    #to-top:hover {{ filter:brightness(1.06) }}
    @media (max-width:520px) {{
      .legal-back span.label {{ display:none }}
      .legal-header__inner {{ padding:10px 12px }}
    }}
  </style>
</head>
<body>
  <header class="legal-header">
    <div class="legal-header__inner">
      <a class="legal-brand" href="/" aria-label="POMICH — на головну">
        <img src="/pomich-logo.png" alt="" width="36" height="36" />
        <span>POMICH</span>
      </a>
      <a class="legal-back" href="/">
        <span aria-hidden="true">←</span>
        <span class="label">На головну</span>
      </a>
    </div>
  </header>
  <main class="legal-main" id="top">
    <article class="legal-card">
      <div class="legal-eyebrow">Права та умови</div>
      <h1>{h1}</h1>
      <p class="legal-lead">{lead}</p>
      <div class="legal-body">
        {extra}
      </div>
      <div class="legal-actions">
        <a class="cta" href="/?utm_source=seo&amp;utm_campaign={slug}">Відкрити застосунок</a>
        <a class="ghost" href="/">← На головну</a>
        <a class="ghost" href="{sibling_href}">{sibling_label}</a>
      </div>
    </article>
  </main>
  <footer class="legal-footer">
    <div class="legal-footer__inner">
      <div class="legal-footer__links">
        <a href="/">Головна</a>
        <a href="/privacy">Конфіденційність</a>
        <a href="/terms">Угода</a>
        <a href="/safety">Безпека</a>
        <a href="/about">Про нас</a>
        <a href="/partner">Партнерам</a>
        <a href="https://t.me/pomich_ua_bot">@pomich_ua_bot</a>
      </div>
      <div>© 2026 POMICH · допомога на дорозі</div>
    </div>
  </footer>
  <button type="button" id="to-top" aria-label="Піднятись вгору">↑</button>
  <script src="/legal-nav.js" defer></script>
</body>
</html>
"""


def _not_found_html() -> str:
    return """<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Сторінку не знайдено — POMICH</title>
  <meta name="description" content="Цієї сторінки немає. Поверніться на головну або викличте допомогу через POMICH." />
  <link rel="canonical" href="https://pomich.help/" />
  <style>
    body{margin:0;font-family:system-ui,sans-serif;background:#0F172A;color:#F8FAFC;line-height:1.5}
    main{max-width:28rem;margin:0 auto;padding:3rem 1.25rem;text-align:center}
    a{color:#4ade80}
    .cta{display:inline-block;margin:.5rem .35rem 0;padding:.85rem 1.15rem;border-radius:999px;background:#22c55e;color:#052e16;font-weight:800;text-decoration:none}
    .ghost{background:transparent;color:#F8FAFC;border:1px solid rgba(248,250,252,.28)}
  </style>
</head>
<body>
  <main>
    <p><a href="/">POMICH</a></p>
    <h1>Сторінку не знайдено</h1>
    <p>Можливо, посилання застаріле або адресу введено з помилкою.</p>
    <p>
      <a class="cta" href="/">На головну</a>
      <a class="cta ghost" href="/?utm_source=404&amp;utm_campaign=call-help">Викликати допомогу</a>
    </p>
  </main>
</body>
</html>
"""


def _media_type_for_root_file(path: Path) -> str | None:
    suffix = path.suffix.lower()
    return {
        ".txt": "text/plain; charset=utf-8",
        ".xml": "application/xml",
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
        ".js": "text/javascript",
        ".ico": "image/x-icon",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
    }.get(suffix)


@app.get("/robots.txt")
def robots_txt():
    for candidate in (DIST_DIR / "robots.txt", PROJECT_ROOT / "public" / "robots.txt"):
        if candidate.is_file():
            return FileResponse(candidate, media_type="text/plain; charset=utf-8")
    raise HTTPException(status_code=404, detail="robots.txt not found")


@app.get("/sitemap.xml")
def sitemap_xml():
    for candidate in (DIST_DIR / "sitemap.xml", PROJECT_ROOT / "public" / "sitemap.xml"):
        if candidate.is_file():
            return FileResponse(candidate, media_type="application/xml")
    raise HTTPException(status_code=404, detail="sitemap.xml not found")


@app.get("/")
@app.get("/{full_path:path}")
def serve_frontend(full_path: str = ""):
    normalized = str(full_path or "").lstrip("/")
    if _is_sensitive_spa_path(normalized):
        raise HTTPException(status_code=404, detail="Not found")
    if normalized.startswith("geo/"):
        geo_name = normalized.removeprefix("geo/")
        geo_path = _resolve_geo_file(geo_name)
        if geo_path is not None:
            return FileResponse(
                geo_path,
                media_type="application/geo+json",
                headers={"Cache-Control": _GEO_CACHE_CONTROL},
            )
        raise HTTPException(status_code=404, detail="GeoJSON file not found")
    if normalized.startswith("assets/"):
        raise HTTPException(status_code=404, detail="Asset not found")
    if normalized.startswith("maps/"):
        maps_name = normalized.removeprefix("maps/")
        maps_path = _resolve_maps_file(maps_name)
        if maps_path is not None:
            media = "image/webp" if maps_path.suffix.lower() == ".webp" else None
            return FileResponse(
                maps_path,
                media_type=media,
                headers={"Cache-Control": _MAPS_CACHE_CONTROL},
            )
        raise HTTPException(status_code=404, detail="Map asset not found")

    seo_page = _SEO_PUBLIC_PAGES.get(normalized.rstrip("/"))
    if seo_page is not None:
        return HTMLResponse(
            _seo_page_html(normalized.rstrip("/"), seo_page),
            headers={"Cache-Control": "public, max-age=300"},
        )

    root_file = _resolve_dist_root_file(normalized)
    if root_file is not None:
        if root_file.name in {"pomich-sw.js", "telegram-bootstrap.js", "boot-recovery.js"}:
            headers = {
                "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
            }
        else:
            headers = {"Cache-Control": "public, max-age=86400"}
        media = _media_type_for_root_file(root_file)
        return FileResponse(root_file, media_type=media, headers=headers)

    # App shell is only at "/". Unknown paths must be real 404s (no soft-404 SPA HTML).
    if not normalized:
        index_path = DIST_DIR / "index.html"
        if index_path.exists():
            # HTMLResponse (not FileResponse) — avoid ETag/304 so Telegram WebView
            # cannot keep a stale shell that points at deleted Vite chunks.
            return HTMLResponse(
                index_path.read_text(encoding="utf-8"),
                headers=_INDEX_NO_CACHE_HEADERS,
            )
        return {"detail": "Frontend build is missing. Run npm run build first."}

    return HTMLResponse(_not_found_html(), status_code=404, headers={"Cache-Control": "no-store"})


__all__ = [
    "AuthPrincipal",
    "app",
    "notify_order_accepted",
    "notify_order_cancelled",
    "notify_order_created",
    "_get_cors_origins",
    "_is_production_runtime",
    "_runtime_config_errors",
    "_validate_runtime_config",
]
