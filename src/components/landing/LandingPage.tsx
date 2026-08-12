import type React from "react"
import { useEffect, useState } from "react"

import type { ProviderAvailability } from "../../api/client"
import { BRAND, DARK, type Point, type Role } from "../../lib/constants"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import RouteMap from "../map/RouteMap"
import { ADMIN_LOGO_HOLD_MS } from "../../lib/adminAccess"

const LANDING_PICKUP: Point = { lat: 50.4501, lng: 30.5234 }
const LANDING_DESTINATION: Point = { lat: 50.4547, lng: 30.5038 }

const landingProviders: ProviderAvailability[] = [
  {
    id: "landing-oleksandr",
    name: "Олександр",
    status: "online",
    vehicle: "Volkswagen Transporter",
    rating: 4.9,
    etaMinutes: 12,
    location: { lat: 50.4448, lng: 30.5166 },
    specialties: ["tow", "fuel"],
  },
  {
    id: "landing-mykhailo",
    name: "Михайло",
    status: "busy",
    vehicle: "Renault Master",
    rating: 4.8,
    etaMinutes: 18,
    location: { lat: 50.4635, lng: 30.5179 },
    specialties: ["battery", "wheel"],
  },
]

const landingStats = [
  ["24/7", "Заявка з дороги"],
  ["12 хв", "Орієнтовний ETA"],
  ["2 ролі", "Клієнт і партнер"],
] as const

const landingFeatures = [
  ["🗺️", "Live-карта партнерів", "Клієнт одразу бачить доступність поруч, ETA та статус пошуку допомоги."],
  ["⚡", "Швидкий матчинг", "Заявка йде перевіреним виконавцям у радіусі, а перший підтверджений бере роботу."],
  ["₴", "Прозора оцінка ціни", "Перед викликом показуємо орієнтовну вартість з подачею, маршрутом і послугою."],
  ["🚛", "Кабінет партнера", "Партнер виходить на лінію, приймає заявку та оновлює статус прямо з телефону."],
  ["🧭", "Navigation Bridge", "Партнер може відкривати Google Maps або Waze, а POMICH тримає ETA і статус у клієнтському екрані."],
  ["🔌", "OpenRoadAid API", "Roadside-шар для інтеграцій: incident, matching, assignment, EN_ROUTE, ARRIVED, COMPLETED."],
] as const

const landingSteps = [
  ["1", "Оберіть проблему", "Евакуатор, акумулятор, колесо, пальне, замок або інша несправність."],
  ["2", "Де ви зараз?", "Перевірте маркер на карті — партнер приїде саме сюди."],
  ["3", "Отримайте ETA і ціну", "POMICH показує приблизний час прибуття та вартість до підтвердження."],
  ["4", "Стежте за допомогою", "Виконавець приймає заявку, їде до клієнта й оновлює статус роботи."],
] as const

type LandingThemeMode = "dark" | "light"

const landingThemes = {
  dark: {
    page: "#090B0E",
    section: "#090B0E",
    sectionAlt: "#0D1015",
    nav: "rgba(9,11,14,0.88)",
    navBorder: "rgba(255,255,255,0.08)",
    text: "#FFFFFF",
    muted: "#B9C2D0",
    subtle: "#AAB4C3",
    navText: "#9CA3AF",
    badgeBg: "rgba(22,163,106,0.12)",
    badgeBorder: "rgba(22,163,106,0.38)",
    badgeText: "#8EF0BE",
    card: "rgba(255,255,255,0.045)",
    cardStrong: "linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035))",
    cardBorder: "rgba(255,255,255,0.13)",
    cardShadow: "0 20px 70px rgba(0,0,0,0.26)",
    clientCard: "rgba(15,18,22,0.92)",
    clientItem: "rgba(255,255,255,0.06)",
    clientItemBorder: "rgba(255,255,255,0.1)",
    partnerCard: "rgba(255,255,255,0.92)",
    partnerText: DARK,
    partnerMuted: "#6B7280",
    ghostBg: "rgba(255,255,255,0.08)",
    ghostBorder: "rgba(255,255,255,0.16)",
    footer: "#090B0E",
    menu: "rgba(15,18,22,0.98)",
    heroBg: "linear-gradient(165deg, #0B1410 0%, #0f1a15 42%, #1a2e24 100%)",
    heroGlow: "radial-gradient(ellipse 90% 70% at 50% 0%, rgba(22,163,106,0.22), transparent 58%)",
    heroPattern: "radial-gradient(circle at center, rgba(22,163,106,0.07) 1px, transparent 1px)",
    heroFadeBottom: "linear-gradient(180deg, transparent, #090B0E)",
    heroGradientText: "linear-gradient(90deg, #8EF0BE 0%, #69A7FF 52%, #FACC15 100%)",
    statDivider: "rgba(255,255,255,0.14)",
    statValue: "#FACC15",
    mapOverlay: "linear-gradient(180deg, rgba(9,11,14,0.06), rgba(9,11,14,0.28))",
    toggleTrack: "rgba(255,255,255,0.08)",
    toggleBorder: "rgba(255,255,255,0.14)",
    toggleKnob: "#FFFFFF",
  },
  light: {
    page: "#F5F8FB",
    section: "#F5F8FB",
    sectionAlt: "#EAF2F7",
    nav: "rgba(255,255,255,0.9)",
    navBorder: "#DDE5EF",
    text: "#0F172A",
    muted: "#475569",
    subtle: "#64748B",
    navText: "#475569",
    badgeBg: "#EAFBF2",
    badgeBorder: "#A8EBC7",
    badgeText: "#0B7A4D",
    card: "#FFFFFF",
    cardStrong: "#FFFFFF",
    cardBorder: "#DDE5EF",
    cardShadow: "0 18px 44px rgba(15,23,42,0.08)",
    clientCard: "#FFFFFF",
    clientItem: "#F3F7FA",
    clientItemBorder: "#DDE5EF",
    partnerCard: "#FFFFFF",
    partnerText: "#0F172A",
    partnerMuted: "#64748B",
    ghostBg: "#FFFFFF",
    ghostBorder: "#DDE5EF",
    footer: "#EEF4F8",
    menu: "rgba(255,255,255,0.98)",
    heroBg: "linear-gradient(165deg, #FAFCFB 0%, #F0F7F3 48%, #E3EFE8 100%)",
    heroGlow: "radial-gradient(ellipse 90% 70% at 50% 0%, rgba(22,163,106,0.14), transparent 58%)",
    heroPattern: "radial-gradient(circle at center, rgba(22,163,106,0.09) 1px, transparent 1px)",
    heroFadeBottom: "linear-gradient(180deg, transparent, #F5F8FB)",
    heroGradientText: "linear-gradient(90deg, #0B7A4D 0%, #1D6FD4 52%, #B8860B 100%)",
    statDivider: "rgba(15,23,42,0.12)",
    statValue: "#16A36A",
    mapOverlay: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.16))",
    toggleTrack: "#E2E8F0",
    toggleBorder: "#CBD5E1",
    toggleKnob: "#FFFFFF",
  },
} as const

type LandingTheme = (typeof landingThemes)[LandingThemeMode]

function getInitialLandingTheme(): LandingThemeMode {
  if (typeof window === "undefined") return "dark"
  const stored = window.localStorage.getItem("pomichLandingTheme")
  if (stored === "light" || stored === "dark") return stored
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

function LandingBadge({ label, theme }: { label: string; theme: LandingTheme }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${theme.badgeBorder}`, background: theme.badgeBg, color: theme.badgeText, borderRadius: 999, padding: "8px 12px", fontWeight: 900, fontSize: 13 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "#22C55E", boxShadow: "0 0 18px rgba(34,197,94,0.85)" }} />
      {label}
    </span>
  )
}

function LandingButton({ children, onClick, theme, variant = "primary" }: { children: React.ReactNode; onClick?: () => void; theme: LandingTheme; variant?: "primary" | "secondary" | "ghost" }) {
  const isPrimary = variant === "primary"
  const isGhost = variant === "ghost"
  return (
    <button
      onClick={onClick}
      style={{
        minHeight: 50,
        border: isGhost ? `1px solid ${theme.ghostBorder}` : "none",
        borderRadius: 12,
        padding: "0 18px",
        background: isPrimary ? "linear-gradient(135deg, #16A36A 0%, #2F80ED 100%)" : isGhost ? theme.ghostBg : "linear-gradient(135deg, #2F80ED 0%, #D6B400 100%)",
        color: isGhost ? theme.text : "#fff",
        boxShadow: isGhost ? "none" : "0 16px 38px rgba(22,163,106,0.22)",
        fontFamily: "inherit",
        fontWeight: 950,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  )
}

function LandingSectionTitle({ eyebrow, title, subtitle, theme }: { eyebrow: string; title: string; subtitle: string; theme: LandingTheme }) {
  return (
    <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto 34px" }}>
      <div style={{ display: "inline-flex", border: "1px solid rgba(47,128,237,0.42)", background: "rgba(47,128,237,0.14)", color: "#69A7FF", borderRadius: 999, padding: "7px 12px", fontWeight: 900, fontSize: 13 }}>{eyebrow}</div>
      <h2 style={{ margin: "18px 0 0", color: theme.text, fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1.03, letterSpacing: 0, fontWeight: 950 }}>{title}</h2>
      <p style={{ margin: "14px auto 0", color: theme.muted, fontSize: 17, lineHeight: 1.55, fontWeight: 700 }}>{subtitle}</p>
    </div>
  )
}

function LandingHeroBackground({ theme, themeMode }: { theme: LandingTheme; themeMode: LandingThemeMode }) {
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: theme.heroBg }} />
      <div style={{ position: "absolute", inset: 0, background: theme.heroGlow, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: theme.heroPattern, backgroundSize: "28px 28px", opacity: themeMode === "dark" ? 0.55 : 0.45, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, transparent 40%, rgba(47,128,237,0.04) 100%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 140, background: theme.heroFadeBottom, pointerEvents: "none" }} />
    </>
  )
}

function LandingThemeToggle({ mode, theme, compact, onToggle }: { mode: LandingThemeMode; theme: LandingTheme; compact: boolean; onToggle: () => void }) {
  const isLight = mode === "light"
  const width = compact ? 92 : 132
  const knobWidth = compact ? 42 : 62

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!isLight}
      aria-label="Перемкнути тему лендингу"
      onClick={onToggle}
      style={{ width, height: 42, border: `1px solid ${theme.toggleBorder}`, borderRadius: 999, background: theme.toggleTrack, color: theme.text, position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "center", padding: 4, fontFamily: "inherit", fontSize: compact ? 11 : 12, fontWeight: 950, cursor: "pointer", boxShadow: mode === "light" ? "0 8px 24px rgba(15,23,42,0.08)" : "none" }}
    >
      <span style={{ position: "absolute", top: 4, bottom: 4, left: isLight ? 4 : width - knobWidth - 4, width: knobWidth, borderRadius: 999, background: theme.toggleKnob, boxShadow: "0 6px 18px rgba(0,0,0,0.18)", transition: "left 0.2s ease" }} />
      <span style={{ position: "relative", zIndex: 1, color: isLight ? DARK : theme.navText }}>{compact ? "Світ" : "Світла"}</span>
      <span style={{ position: "relative", zIndex: 1, color: isLight ? theme.navText : DARK }}>{compact ? "Тем" : "Темна"}</span>
    </button>
  )
}

function LandingInterfacePreview({ compact, theme }: { compact: boolean; theme: LandingTheme }) {
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gridTemplateColumns: compact ? "1fr" : "300px minmax(0, 1fr) 300px", gap: compact ? 16 : 22, alignItems: "stretch" }}>
      <div style={{ order: compact ? 2 : 1, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: theme.clientCard, boxShadow: theme.cardShadow, padding: 16, color: theme.text, alignSelf: "center" }}>
        <div style={{ color: theme.badgeText, fontWeight: 950, fontSize: 13 }}>Клієнтський сценарій</div>
        <div style={{ marginTop: 8, fontSize: 23, lineHeight: 1.08, fontWeight: 950, color: theme.text }}>Потрібна допомога на дорозі?</div>
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          {["Поточне місце", "Евакуатор", "Орієнтовно 12 хв"].map((item, index) => (
            <div key={item} style={{ display: "grid", gridTemplateColumns: "32px 1fr", alignItems: "center", gap: 10, border: `1px solid ${theme.clientItemBorder}`, borderRadius: 8, padding: "9px 10px", background: theme.clientItem }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: index === 0 ? "rgba(22,163,106,0.22)" : "rgba(47,128,237,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>{index === 0 ? "●" : index === 1 ? "🚛" : "⚡"}</span>
              <span style={{ fontWeight: 900, fontSize: 13 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ order: compact ? 1 : 2, position: "relative", height: compact ? 360 : 500, borderRadius: 24, overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 28px 90px rgba(0,0,0,0.38)", background: "#14181D", minWidth: 0 }}>
        <RouteMap pickup={LANDING_PICKUP} destination={LANDING_DESTINATION} providers={landingProviders} subtitle="Київ · live dispatch" full />
        <div style={{ position: "absolute", inset: 0, background: theme.mapOverlay, pointerEvents: "none", zIndex: 1150 }} />
      </div>

      <div style={{ order: 3, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: theme.partnerCard, color: theme.partnerText, boxShadow: theme.cardShadow, padding: 16, alignSelf: "center" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 950 }}>Партнер POMICH</div>
            <div style={{ color: theme.partnerMuted, fontSize: 12, fontWeight: 800, marginTop: 3 }}>На лінії · 1.7 км</div>
          </div>
          <div style={{ color: BRAND, background: "#E8F8F1", borderRadius: 999, padding: "7px 10px", fontWeight: 950, fontSize: 12 }}>~12 хв</div>
        </div>
        <div style={{ marginTop: 14, height: 8, borderRadius: 999, background: "#E5E7EB" }}>
          <div style={{ width: "68%", height: "100%", borderRadius: 999, background: BRAND }} />
        </div>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ borderRadius: 8, background: "#F3F4F6", padding: 10, fontSize: 12, fontWeight: 900 }}>Прийнято</div>
          <div style={{ borderRadius: 8, background: "#111315", color: "#fff", padding: 10, fontSize: 12, fontWeight: 900 }}>У дорозі</div>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage({ onSelect, onHiddenAdmin }: { onSelect: (role: Role) => void; onHiddenAdmin?: () => void }) {
  const compact = useMediaQuery("(max-width: 760px)")
  const [menuOpen, setMenuOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<LandingThemeMode>(getInitialLandingTheme)
  const [logoHoldProgress, setLogoHoldProgress] = useState(0)
  const theme = landingThemes[themeMode]
  const navItems = [
    ["#home", "Головна"],
    ["#interface", "Інтерфейс"],
    ["#features", "Функції"],
    ["#steps", "Як це працює"],
    ["#contacts", "Контакти"],
  ] as const

  useEffect(() => {
    window.localStorage.setItem("pomichLandingTheme", themeMode)
  }, [themeMode])

  const beginLogoHold = () => {
    if (!onHiddenAdmin) return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / ADMIN_LOGO_HOLD_MS)
      setLogoHoldProgress(progress)
      if (progress >= 1) {
        window.clearInterval(timer)
        setLogoHoldProgress(0)
        onHiddenAdmin()
      }
    }, 50)
    const stop = () => {
      window.clearInterval(timer)
      setLogoHoldProgress(0)
      window.removeEventListener("mouseup", stop)
      window.removeEventListener("mouseleave", stop)
      window.removeEventListener("touchend", stop)
      window.removeEventListener("touchcancel", stop)
    }
    window.addEventListener("mouseup", stop)
    window.addEventListener("mouseleave", stop)
    window.addEventListener("touchend", stop)
    window.addEventListener("touchcancel", stop)
  }

  return (
    <div style={{ minHeight: "100vh", background: theme.page, color: theme.text, overflowX: "hidden", transition: "background 0.2s ease, color 0.2s ease" }}>
      <header className="pomich-landing-header" style={{ height: 66, borderBottom: `1px solid ${theme.navBorder}`, background: theme.nav, padding: compact ? "0 16px" : "0 28px" }}>
        <div style={{ width: "100%", maxWidth: 1070, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
          <a
            href="#home"
            onMouseDown={beginLogoHold}
            onTouchStart={beginLogoHold}
            style={{ display: "inline-flex", alignItems: "center", gap: 12, color: theme.text, textDecoration: "none", fontWeight: 950, position: "relative" }}
          >
            <span style={{ width: 42, height: 42, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", boxShadow: "0 12px 32px rgba(22,163,106,0.28)", fontSize: 20, overflow: "hidden", position: "relative" }}>
              P
              {logoHoldProgress > 0 ? (
                <span style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, rgba(255,255,255,0.28) ${logoHoldProgress * 100}%, transparent ${logoHoldProgress * 100}%)` }} />
              ) : null}
            </span>
            <span style={{ fontSize: 20 }}>POMICH</span>
          </a>
          {compact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LandingThemeToggle mode={themeMode} theme={theme} compact={compact} onToggle={() => setThemeMode((mode) => mode === "dark" ? "light" : "dark")} />
              <button aria-label="Меню" onClick={() => setMenuOpen((value) => !value)} style={{ width: 44, height: 44, border: `1px solid ${theme.ghostBorder}`, borderRadius: 10, background: theme.ghostBg, color: theme.text, fontSize: 24, fontWeight: 900, cursor: "pointer" }}>☰</button>
            </div>
          ) : (
            <nav style={{ display: "flex", alignItems: "center", gap: 26 }}>
              {navItems.map(([href, label]) => (
                <a key={href} href={href} style={{ color: theme.navText, textDecoration: "none", fontWeight: 850, fontSize: 14 }}>{label}</a>
              ))}
            </nav>
          )}
          {!compact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <LandingThemeToggle mode={themeMode} theme={theme} compact={compact} onToggle={() => setThemeMode((mode) => mode === "dark" ? "light" : "dark")} />
              <LandingButton theme={theme} onClick={() => onSelect("customer")}>Відкрити Web</LandingButton>
            </div>
          ) : null}
        </div>
        {compact && menuOpen ? (
          <div style={{ position: "absolute", top: 66, left: 12, right: 12, border: `1px solid ${theme.ghostBorder}`, borderRadius: 8, background: theme.menu, padding: 12, display: "grid", gap: 4, boxShadow: "0 24px 60px rgba(0,0,0,0.32)" }}>
            {navItems.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} style={{ color: theme.text, textDecoration: "none", fontWeight: 900, padding: "12px 10px", borderRadius: 6 }}>{label}</a>
            ))}
          </div>
        ) : null}
      </header>

      <main>
        <section id="home" style={{ position: "relative", minHeight: compact ? "600px" : "680px", display: "flex", alignItems: "center", justifyContent: "center", padding: compact ? "40px 18px 24px" : "72px 24px 48px", overflow: "hidden" }}>
          <LandingHeroBackground theme={theme} themeMode={themeMode} />
          <div style={{ position: "relative", zIndex: 2, width: "100%", maxWidth: 960, textAlign: "center" }}>
            <LandingBadge label="Український roadside assistance marketplace" theme={theme} />
            <h1 style={{ margin: compact ? "18px 0 0" : "28px 0 0", fontSize: compact ? 40 : "clamp(42px, 7.4vw, 84px)", lineHeight: 0.98, letterSpacing: 0, fontWeight: 950, color: theme.text }}>
              POMICH —<br />
              <span className="pomich-brand-gradient-text">допомога поруч</span>
            </h1>
            <p style={{ margin: compact ? "18px auto 0" : "24px auto 0", maxWidth: 720, color: theme.muted, fontSize: compact ? 16 : 21, lineHeight: compact ? 1.46 : 1.55, fontWeight: 700 }}>
              Викликайте евакуатор, запуск акумулятора, колесо, пальне або механіка так само швидко, як поїздку: точка на карті, ETA, ціна і перевірений партнер.
            </p>
            <div style={{ margin: compact ? "22px auto 0" : "30px auto 0", color: theme.badgeText, fontSize: 13, fontWeight: 950 }}>Оберіть вашу роль</div>
            <div style={{ margin: "12px auto 0", display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(3, minmax(180px, 1fr))", gap: compact ? 10 : 12, maxWidth: 760 }}>
              <LandingButton theme={theme} onClick={() => onSelect("customer")}>Викликати допомогу</LandingButton>
              <LandingButton theme={theme} variant="secondary" onClick={() => onSelect("provider")}>Прийняти заявку</LandingButton>
              <a href="#interface" style={{ textDecoration: "none" }}><LandingButton theme={theme} variant="ghost">Подивитися інтерфейс</LandingButton></a>
            </div>
            <div style={{ margin: compact ? "24px auto 0" : "46px auto 0", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: compact ? 10 : 28, maxWidth: 680 }}>
              {landingStats.map(([value, label]) => (
                <div key={value} style={{ borderLeft: compact ? "none" : `1px solid ${theme.statDivider}`, padding: compact ? "0 4px" : "0 24px" }}>
                  <div style={{ color: theme.statValue, fontSize: compact ? 26 : 38, fontWeight: 950 }}>{value}</div>
                  <div style={{ marginTop: 6, color: theme.subtle, fontSize: compact ? 11 : 13, fontWeight: 800 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="interface" style={{ padding: compact ? "54px 16px 72px" : "76px 24px 96px", background: theme.section }}>
          <LandingSectionTitle eyebrow="Інтерфейс" title="Як виглядає POMICH" subtitle="Карта, заявка і статуси залишаються на одному екрані: клієнт бачить допомогу, партнер бачить роботу, диспетчер бачить процес." theme={theme} />
          <LandingInterfacePreview compact={compact} theme={theme} />
        </section>

        <section id="features" style={{ padding: compact ? "48px 16px 64px" : "74px 24px 90px", background: theme.sectionAlt }}>
          <LandingSectionTitle eyebrow="Функції" title="Все, що потрібно для допомоги на дорозі" subtitle="POMICH зшиває клієнта, виконавця і диспетчера в один короткий, зрозумілий процес." theme={theme} />
          <div style={{ maxWidth: 1070, margin: "0 auto", display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(3, 1fr)", gap: 24 }}>
            {landingFeatures.map(([icon, title, text], index) => (
              <div key={title} style={{ minHeight: 218, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: index < 2 ? theme.cardStrong : theme.card, padding: 28, boxShadow: themeMode === "light" ? "0 12px 32px rgba(15,23,42,0.05)" : "none" }}>
                {index < 3 ? <div style={{ float: "right", borderRadius: 999, padding: "7px 11px", background: "#FACC15", color: "#111315", fontSize: 12, fontWeight: 950 }}>Нове</div> : null}
                <div style={{ fontSize: 28 }}>{icon}</div>
                <h3 style={{ margin: "24px 0 0", color: theme.text, fontSize: 20, lineHeight: 1.18, fontWeight: 950 }}>{title}</h3>
                <p style={{ margin: "12px 0 0", color: theme.muted, fontSize: 15, lineHeight: 1.55, fontWeight: 700 }}>{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="steps" style={{ padding: compact ? "56px 16px 70px" : "80px 24px 100px", background: theme.section }}>
          <LandingSectionTitle eyebrow="Як це працює" title="Чотири кроки до допомоги" subtitle="Короткий сценарій для стресової ситуації: без зайвих форм і без телефонних списків." theme={theme} />
          <div style={{ maxWidth: 700, margin: "0 auto", display: "grid", gap: 0 }}>
            {landingSteps.map(([number, title, text], index) => (
              <div key={number} style={{ display: "grid", gridTemplateColumns: compact ? "54px 1fr" : "74px 1fr", gap: compact ? 16 : 24, position: "relative", paddingBottom: index === landingSteps.length - 1 ? 0 : 34 }}>
                {index < landingSteps.length - 1 ? <div style={{ position: "absolute", left: compact ? 26 : 36, top: 54, bottom: 0, width: 2, background: theme.cardBorder }} /> : null}
                <div style={{ width: compact ? 54 : 62, height: compact ? 54 : 62, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", fontWeight: 950, boxShadow: "0 0 0 6px rgba(47,128,237,0.16)", zIndex: 1 }}>{number}</div>
                <div style={{ paddingTop: 4 }}>
                  <h3 style={{ margin: 0, color: theme.text, fontSize: compact ? 19 : 22, fontWeight: 950 }}>{title}</h3>
                  <p style={{ margin: "10px 0 0", color: theme.muted, fontSize: 16, lineHeight: 1.55, fontWeight: 700 }}>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="contacts" style={{ padding: compact ? "56px 16px 72px" : "82px 24px 96px", background: `radial-gradient(circle at 50% 0%, rgba(22,163,106,0.18), transparent 34%), ${theme.sectionAlt}`, textAlign: "center" }}>
          <LandingSectionTitle eyebrow="Спільнота" title="Підключаємо водіїв і партнерів по Україні" subtitle="Клієнти отримують швидку допомогу, партнери отримують прозорі заявки, диспетчер має контроль над якістю." theme={theme} />
          <div style={{ maxWidth: 820, margin: "0 auto", display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(2, 1fr)", gap: 14 }}>
            <button onClick={() => onSelect("customer")} style={{ minHeight: 74, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: theme.card, color: theme.text, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: "14px 18px", fontWeight: 950, boxShadow: themeMode === "light" ? "0 12px 32px rgba(15,23,42,0.05)" : "none" }}>
              <span style={{ display: "block", color: "#8EF0BE", fontSize: 13 }}>Водіям</span>
              <span style={{ display: "block", marginTop: 4, fontSize: 18 }}>Відкрити клієнтський Web</span>
            </button>
            <button onClick={() => onSelect("provider")} style={{ minHeight: 74, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: theme.card, color: theme.text, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: "14px 18px", fontWeight: 950, boxShadow: themeMode === "light" ? "0 12px 32px rgba(15,23,42,0.05)" : "none" }}>
              <span style={{ display: "block", color: "#69A7FF", fontSize: 13 }}>Партнерам</span>
              <span style={{ display: "block", marginTop: 4, fontSize: 18 }}>Вийти на лінію</span>
            </button>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: `1px solid ${theme.navBorder}`, background: theme.footer, padding: compact ? "22px 16px" : "28px 24px" }}>
        <div style={{ maxWidth: 1070, margin: "0 auto", display: "flex", flexDirection: compact ? "column" : "row", justifyContent: "space-between", gap: 16, color: theme.navText, fontSize: 13, fontWeight: 800 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", fontWeight: 950 }}>P</span>
            <span>POMICH для України</span>
          </div>
          <div>© 2026. Roadside assistance, built around fast verified help.</div>
        </div>
      </footer>
    </div>
  )
}
