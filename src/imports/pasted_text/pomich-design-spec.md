Create a complete high-fidelity UI/UX design for a Ukrainian roadside assistance startup called:

POMICH

Brand tagline:
“Допомога вже їде.”

Product concept:
POMICH is an on-demand roadside assistance marketplace for Ukraine.
Think “Bolt/Uklon for roadside assistance”.

A driver whose car has broken down opens POMICH, shares location, chooses the problem, sees an upfront estimated price and ETA, and requests help.

The nearest suitable service provider receives the request, accepts it, drives to the customer, and the customer tracks the provider on a live map.

POMICH is NOT:
- a directory of tow truck phone numbers;
- a car service marketplace;
- an automotive super-app;
- a classifieds platform.

POMICH solves ONE main problem:
“I have a problem with my car right now and I need someone to come to me.”

==================================================
1. PRODUCT PLATFORMS
==================================================

Design three connected interfaces:

1. POMICH Customer — Telegram Mini App / PWA
2. POMICH Partner — provider interface
3. POMICH Dispatch — lightweight dispatcher/admin dashboard

Primary focus:
CUSTOMER TELEGRAM MINI APP.

Mobile-first design.

Main customer frame:
390 x 844 px.

Also prepare responsive layouts for:
- 360 px mobile
- 430 px mobile
- Telegram Mini App
- mobile browser / PWA

Partner:
390 x 844 px

Dispatcher:
1440 x 1024 desktop.

==================================================
2. TARGET AUDIENCE
==================================================

Customers:
Ukrainian drivers, approximately 18–65 years old.

They may be:
- on a highway;
- at night;
- in bad weather;
- stressed;
- unfamiliar with car mechanics;
- using the service with one hand;
- using poor mobile internet.

Therefore UX must be extremely simple.

Never make the customer understand technical automotive terminology before requesting help.

Main UX principle:

LOCATION
→ PROBLEM
→ PRICE / ETA
→ REQUEST
→ TRACK HELP

Target:
request assistance in less than 30 seconds.

==================================================
3. VISUAL DIRECTION
==================================================

Create a modern Ukrainian mobility-tech brand.

Visual references:
- Bolt
- Uklon
- Uber
- Monobank
- Diia

Do NOT directly copy any of them.

Style:
- clean
- reliable
- technological
- calm
- premium but accessible
- safety-oriented
- minimal
- highly readable

Avoid:
- old-fashioned towing websites;
- excessive gradients;
- automotive clichés;
- racing aesthetics;
- carbon fiber;
- flames;
- aggressive red/black tuning style;
- crowded dashboards.

POMICH should look like a serious technology platform.

==================================================
4. BRAND
==================================================

Brand:

POMICH

Logo concept:
simple wordmark “POMICH”.

Optional symbol:
a minimal location pin / route / assistance signal integrated into the P or O.

Brand phrase:

POMICH
Допомога вже їде.

Primary interface language:
Ukrainian.

Use realistic Ukrainian UX copy.

==================================================
5. COLOR SYSTEM
==================================================

Create a professional accessible color system.

Main brand color:
deep modern green / emerald associated with:
- help;
- active provider;
- safety;
- “help is available”.

Suggested direction:
#16A36A or similar.

Dark:
#111315

Background:
#F6F7F8

Surface:
#FFFFFF

Secondary text:
neutral gray.

Emergency red:
only for:
- SOS;
- dangerous conditions;
- destructive actions;
- cancellation.

Amber:
warnings / high demand.

Green:
normal operation / provider online / order successful.

Ensure WCAG-friendly contrast.

Create Light Mode first.

Also create Dark Mode for:
- map tracking screen;
- nighttime usage.

==================================================
6. TYPOGRAPHY
==================================================

Use a clean modern sans-serif.

Examples:
Inter
Manrope
SF Pro style

Strong hierarchy.

Large critical buttons.

Minimum comfortable touch target:
44–48 px.

Avoid tiny text.

==================================================
7. CUSTOMER APP — INFORMATION ARCHITECTURE
==================================================

Bottom navigation should be extremely limited.

Suggested:

Головна
Замовлення
Профіль

Do NOT create 6–8 navigation sections.

Emergency request must always dominate the interface.

==================================================
8. CUSTOMER SCREEN 01 — TELEGRAM ENTRY
==================================================

Design POMICH as a Telegram Mini App.

Telegram bot flow:

User opens @pomich_bot.

Bot message:

“Вітаємо у POMICH 👋

Допоможемо, якщо щось сталося з автомобілем у дорозі.

Надішліть геолокацію або відкрийте сервіс.”

Buttons:

[ 🆘 Викликати допомогу ]
[ 📍 Надіслати геолокацію ]

Show how Telegram transitions into the Mini App.

==================================================
9. CUSTOMER SCREEN 02 — HOME / MAP
==================================================

This is the most important screen.

Full-screen map.

User location clearly shown.

Show several nearby provider markers:
- tow truck;
- mechanic;
- battery assistance.

Top:

POMICH logo

small status indicator:

● Допомога поруч

Location card:

Ваше місцезнаходження
вул. Собранецька, Ужгород

or highway location:

М06, Закарпатська область

Main bottom sheet:

“Що сталося?”

Large service buttons:

🚛 Евакуатор
🔋 Не заводиться
🛞 Проблема з колесом
⛽ Закінчилось пальне
🔑 Не можу відкрити авто
🔧 Інша несправність

Below:

“Допомога поруч: 10–20 хв”

Primary UI objective:
customer should instantly understand what to press.

==================================================
10. CUSTOMER SCREEN 03 — TOW TRUCK REQUEST
==================================================

After selecting:

🚛 Евакуатор

Ask only necessary questions.

Step 1:

“Де знаходиться авто?”

Map + current GPS.

Button:
[ Підтвердити місце ]

Step 2:

“Куди доставити авто?”

Options:

СТО
Дім
Інше місце

Address search.

Step 3:

“Що з автомобілем?”

Simple cards:

Авто заводиться
Авто не заводиться
Після ДТП
Заблоковані колеса
З’їхало з дороги
Інше

Optional:

Марка автомобіля
Volvo V60

License plate can be optional.

Never require VIN.

==================================================
11. CUSTOMER SCREEN 04 — PRICE
==================================================

Create a clean Bolt-like confirmation card.

Example:

Евакуатор

Подача
750 ₴

Маршрут
12.4 км

Перевезення
434 ₴

——————————

Разом
1 184 ₴

Estimated arrival:

~14 хв

Small text:

“Ціна зафіксована після підтвердження замовлення.”

Primary CTA:

[ Викликати за 1 184 ₴ ]

Secondary:

Змінити маршрут

==================================================
12. CUSTOMER SCREEN 05 — SEARCHING
==================================================

After order:

Use map.

Animated visual concept:

“Шукаємо допомогу поруч…”

Show searching radius around customer location.

Examples:

3 виконавці поруч

Expected:
10–15 секунд.

Give cancel option but make it secondary.

==================================================
13. CUSTOMER SCREEN 06 — PROVIDER FOUND
==================================================

Provider card:

“Допомогу знайдено”

Олександр
★★★★★ 4.96

827 замовлень

Mercedes Sprinter
AO 1234 XX

ETA:

8 хв

Show provider moving on map.

Buttons:

[ Написати ]
[ Зателефонувати ]

Order:

Евакуатор
1 184 ₴

Status timeline:

✓ Замовлення створено
✓ Виконавець знайдений
● Їде до вас
○ Виконує замовлення
○ Завершено

==================================================
14. CUSTOMER SCREEN 07 — LIVE TRACKING
==================================================

Map should dominate.

Customer:
large stationary marker.

Provider:
moving tow truck marker.

Route between provider and customer.

Large ETA:

“6 хв”

Text:

“Олександр їде до вас”

Show:

vehicle
license plate
rating
profile photo / avatar

Safety option:

“Поділитися замовленням”

This creates a Telegram share link so family or friends can see:
- provider;
- ETA;
- order status.

==================================================
15. CUSTOMER SCREEN 08 — PROVIDER ARRIVED
==================================================

Status:

“Виконавець прибув”

CTA:

[ Виконавець уже зі мною ]

Show time and order information.

==================================================
16. CUSTOMER SCREEN 09 — JOB IN PROGRESS
==================================================

Status:

“Допомога надається”

For towing:

“Автомобіль завантажено”

Route to destination.

Show destination.

Support button:

“Потрібна підтримка?”

==================================================
17. CUSTOMER SCREEN 10 — COMPLETED
==================================================

Large success state.

“Готово ✅”

“Замовлення виконано”

Final cost:

1 184 ₴

Provider:

Олександр
Mercedes Sprinter

Rating:

“Як усе пройшло?”

★★★★★

Tags:

Швидко
Ввічливо
Обережно
Все добре

Optional comment.

CTA:

[ Готово ]

Secondary:

“Отримати квитанцію”

==================================================
18. OTHER CUSTOMER SERVICES
==================================================

Create request flows for:

BATTERY

🔋 Не заводиться

Questions:
- стартер крутить?
- потрібен запуск від бустера?
- легковий / SUV / бус?

Do NOT overwhelm user.

WHEEL

🛞 Проблема з колесом

Options:
- пробите колесо;
- є запаска;
- немає запаски;
- пошкоджений диск.

FUEL

⛽ Закінчилось пальне

Choose:
- Бензин
- Дизель

Liters:
5 / 10 / інше

LOCKOUT

🔑 Не можу відкрити авто

Disclaimer:
provider performs legal vehicle opening after ownership verification.

MECHANIC

🔧 Інша несправність

Options:

Не заводиться
Перегрів
Дим
Сторонній звук
Електрика
Інше

Allow:
- text description;
- photo upload.

==================================================
19. SOS MODE
==================================================

Create an emergency accessibility mode.

Button:

🆘 SOS

When selected:

“Ви у безпеці?”

Options:

Так, потрібна допомога з авто.

Ні, сталася ДТП / є постраждалі.

For emergencies involving people:
show recommendation to contact official emergency services.

POMICH itself is roadside automotive assistance, not emergency medical service.

==================================================
20. NO PROVIDER AVAILABLE
==================================================

Important edge case.

Do not show a dead end.

Screen:

“Поруч немає вільного виконавця”

Then:

“Розширюємо зону пошуку…”

Options:

[ Продовжити пошук ]

[ Зателефонувати диспетчеру ]

Also show estimated wait time if possible.

==================================================
21. POOR INTERNET STATE
==================================================

Design degraded UX.

Display:

“Слабкий інтернет”

Keep customer location cached.

Provide direct button:

“Зателефонувати POMICH”

Keep critical order information locally visible.

==================================================
22. CUSTOMER ORDER HISTORY
==================================================

Simple list:

Мої замовлення

Today
Евакуатор
Volvo V60
1 184 ₴
Завершено

18 липня
Запуск АКБ
650 ₴
Завершено

Click opens receipt/order detail.

==================================================
23. CUSTOMER PROFILE
==================================================

Keep minimal.

Profile:
Roman

Phone

Vehicles:

Volvo V60
AA 1234 AA

Add vehicle

Payment methods

Telegram

Support

Privacy

Terms

==================================================
24. POMICH PARTNER
==================================================

Create separate provider UX.

Possible providers:

- tow truck driver;
- mobile mechanic;
- battery assistance;
- tire assistance;
- fuel delivery;
- lockout specialist.

Main Partner screen:

POMICH Partner

large state toggle:

🟢 НА ЛІНІЇ

or

⚪ НЕ НА ЛІНІЇ

Map.

Current location.

Today card:

Замовлень: 4
Зароблено: 3 840 ₴
Онлайн: 5 год 21 хв

==================================================
25. PARTNER — NEW ORDER
==================================================

Create a Bolt/Uklon style incoming order card.

Big alert:

“Нове замовлення”

Service:

🚛 Евакуація

Customer:
Volvo V60

Distance to customer:
4.8 км

ETA:
9 хв

Trip:
12.4 км

Customer price:
1 184 ₴

Partner earnings:
1 006 ₴

Platform commission:
178 ₴

Countdown:
15 sec

Buttons:

[ ПРИЙНЯТИ ]

[ Пропустити ]

The accept action must be visually dominant.

==================================================
26. PARTNER — NAVIGATION TO CUSTOMER
==================================================

Map.

Route.

Customer marker.

ETA.

Customer details limited to necessary information.

Buttons:

Написати клієнту
Зателефонувати

Large CTA:

[ Я на місці ]

==================================================
27. PARTNER — SERVICE FLOW
==================================================

Status progression:

Прийнято
↓
Їду до клієнта
↓
Прибув
↓
Виконую
↓
Завершено

For tow:

[ Авто завантажено ]

then route to final destination.

Final:

[ Завершити замовлення ]

==================================================
28. PARTNER — EARNINGS
==================================================

Design simple financial dashboard.

Today:
3 840 ₴

Week:
18 420 ₴

Orders:
21

Platform commission:
2 760 ₴

Available:
15 660 ₴

CTA:
Вивести кошти

Show transaction list.

==================================================
29. PARTNER PROFILE / VERIFICATION
==================================================

Include:

Name

Phone

Photo

Rating

Vehicle:
Mercedes Sprinter

License plate

Services:

✓ Евакуатор
✓ Лебідка
✓ Заблоковані колеса

Documents:

Driver license
Vehicle documents
Business information

Verification state:

✓ Перевірено POMICH

==================================================
30. DISPATCHER DASHBOARD
==================================================

Desktop dashboard.

Think modern mobility operations center.

Left sidebar:

Overview
Orders
Live Map
Partners
Customers
Payments
Support

Main dashboard:

Online providers
Active orders
Searching
En route
Completed today
Cancelled
Average ETA
GMV
POMICH revenue

Large live Ukraine / regional map.

Markers:

Customer
Provider
Active order

==================================================
31. DISPATCH ORDER PAGE
==================================================

Order:

#PM-12084

Status:
Їде до клієнта

Customer:
Roman
Volvo V60

Location

Provider:
Олександр
Mercedes Sprinter

Route

ETA

Price

Timeline

Buttons:

Call customer
Call partner
Reassign partner
Cancel
Issue refund

==================================================
32. EMPTY / ERROR / EDGE STATES
==================================================

Create all important states:

- GPS permission denied;
- no GPS;
- weak internet;
- payment failed;
- partner cancelled;
- customer cancelled;
- no provider available;
- provider delayed;
- provider arrived;
- order completed;
- Telegram session expired;
- unsupported region.

==================================================
33. DESIGN SYSTEM
==================================================

Create a dedicated Figma page:

POMICH Design System

Include:

Colors
Typography
Spacing
Grid
Radius
Shadows
Icons
Map markers

Components:

Primary Button
Secondary Button
Danger Button
Icon Button
Service Card
Provider Card
Vehicle Card
Price Card
Order Card
Status Chip
Bottom Sheet
Modal
Toast
Snackbar
Input
Phone Input
Address Search
Map Pin
Provider Marker
Customer Marker
ETA Badge
Rating
Timeline
Bottom Navigation
Telegram WebApp Header

Use Auto Layout everywhere.

Use reusable variants.

Use clear component naming.

Example:

Button / Primary / Default
Button / Primary / Pressed
Button / Primary / Disabled

Order / Status / Searching
Order / Status / Accepted
Order / Status / Arrived
Order / Status / Completed

==================================================
34. PROTOTYPE
==================================================

Create clickable prototypes for TWO main flows.

CUSTOMER:

Telegram
→ Open POMICH
→ Share location
→ Select Tow Truck
→ Destination
→ Price
→ Confirm
→ Searching
→ Provider Found
→ Live Tracking
→ Arrived
→ Completed
→ Rating

PARTNER:

Offline
→ Go Online
→ Incoming Request
→ Accept
→ Navigate
→ Arrived
→ Start
→ Complete
→ Earnings

Prototype should feel like a real production mobile app.

==================================================
35. UX RULES
==================================================

Critical:

Do not require registration before requesting help.

Telegram identity / phone can be used automatically.

Do not require:
- email;
- password;
- VIN;
- full vehicle profile;
before creating an order.

Use progressive disclosure.

Ask only information needed for the selected service.

Never show long forms.

Never expose the user to a list of dozens of providers.

POMICH chooses the optimal provider automatically.

Primary value proposition:

“Не шукай, кому дзвонити.
POMICH знайде допомогу поруч.”

==================================================
36. BRAND MESSAGING
==================================================

Use these phrases naturally throughout the UI:

POMICH

“Допомога вже їде.”

“Допомога поруч.”

“Знайдемо найближчого виконавця.”

“Без десятків дзвінків.”

“Ціна відома до виклику.”

“Відстежуйте допомогу на карті.”

“Допомога на дорозі 24/7.”

==================================================
37. LANDING PAGE
==================================================

Additionally design a responsive marketing landing page.

Hero:

POMICH

“Допомога вже їде.”

Subtitle:

“Евакуатор, запуск АКБ, колесо, пальне та мобільна допомога — найближчий перевірений виконавець без десятків дзвінків.”

Primary CTA:

[ Викликати допомогу ]

Secondary:

[ Стати партнером ]

Show smartphone mockup with live map.

Sections:

How it works

1. Вкажіть проблему
2. Підтвердіть геолокацію
3. Отримайте ціну
4. Допомога їде до вас

Services

Live tracking

Transparent pricing

Verified providers

For Partners

Telegram Bot

FAQ

Footer

==================================================
38. TELEGRAM AS A KEY PRODUCT CHANNEL
==================================================

Telegram integration must be a visible product advantage.

Show:

Telegram bot
@pomich_bot

User can:

- start a request;
- share Telegram location;
- open Mini App;
- receive order status notifications;
- receive provider information;
- see ETA;
- contact provider;
- cancel;
- receive receipt;
- rate service.

Example Telegram notification:

🚛 Виконавець знайдений

Олександр
⭐ 4.96

Mercedes Sprinter
AO 1234 XX

Буде приблизно через 8 хв.

[ Відкрити карту ]

Another:

📍 Виконавець прибув.

Another:

✅ Замовлення виконано.

Як усе пройшло?

[ ⭐ Оцінити ]

==================================================
39. FINAL FIGMA STRUCTURE
==================================================

Organize Figma file into pages:

00 — Cover
01 — Brand
02 — Design System
03 — Customer App
04 — Customer Prototype
05 — Telegram Bot
06 — Partner App
07 — Partner Prototype
08 — Dispatcher
09 — Landing
10 — UX Flows
11 — Edge Cases

Name frames consistently.

Example:

Customer / 01 Home
Customer / 02 Service
Customer / 03 Location
Customer / 04 Destination
Customer / 05 Price
Customer / 06 Searching
Customer / 07 Assigned
Customer / 08 Tracking
Customer / 09 Arrived
Customer / 10 Complete

==================================================
40. FINAL RESULT
==================================================

The final design should make POMICH look like a venture-backed Ukrainian mobility startup ready for production and investor presentation.

It must visually communicate:

SPEED
TRUST
SAFETY
TRANSPARENCY
REAL-TIME HELP

The experience should feel as simple as ordering a taxi.

Core concept:

“Bolt drives the passenger.
POMICH drives help to the car.”

But do not place this English comparison directly in the consumer UI.

Final consumer promise:

POMICH
Допомога вже їде.