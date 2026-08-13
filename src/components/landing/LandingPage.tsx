import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { type ProviderAvailability } from "../../api/client"
import LazyRouteMap from "../map/LazyRouteMap"
import { PomichMapBackground, useSuppressMapAtmosphere } from "../layout/PomichMapShell"
import { useDirectoryScope } from "../../hooks/useDirectoryScope"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { mediaQueries } from "../../lib/breakpoints"
import { ADMIN_LOGO_HOLD_MS } from "../../lib/adminAccess"
import { PICKUP, services, type Point, type Role } from "../../lib/constants"
import { calculatePrice } from "../../lib/pomichDomain"
import { UKRAINE_WIDE_LABEL } from "../../lib/ukraineCities"
import { getTelegramContext } from "../../telegram"
import { ThemeToggle } from "../ui/ThemeToggle"
import { usePomichTheme } from "../../context/PomichThemeProvider"
import { type PomichThemeColors, type PomichThemeMode } from "../../lib/theme"

const BRAND = "var(--pomich-brand)"
const DARK = "var(--pomich-text)"
const BG = "var(--pomich-bg)"
const BORDER = "var(--pomich-border)"
const MUTED = "var(--pomich-muted)"
const SUBTLE = "var(--pomich-subtle)"
const CARD = "var(--pomich-card-bg)"
const SURFACE_TONE = "var(--pomich-service-tone-default)"
const SELECTED = "var(--pomich-selected-bg)"
const GHOST = "var(--pomich-ghost-bg)"

const LANDING_MAP_CENTER: Point = PICKUP
const LANDING_DESTINATION: Point = { lat: 48.625, lng: 22.295 }

const landingHeroProviders: ProviderAvailability[] = [
  {
    id: "hero-oleksandr",
    name: "Олександр",
    status: "online",
    vehicle: "Volkswagen Transporter",
    rating: 4.9,
    etaMinutes: 12,
    location: { lat: 48.618, lng: 22.282 },
    specialties: ["tow", "fuel"],
  },
  {
    id: "hero-mykhailo",
    name: "Михайло",
    status: "busy",
    vehicle: "Renault Master",
    rating: 4.8,
    etaMinutes: 18,
    location: { lat: 48.628, lng: 22.301 },
    specialties: ["battery", "wheel"],
  },
]

function readLandingUserLocation(): Point | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.sessionStorage.getItem("pomichLandingGeo")
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { lat?: number; lng?: number }
    if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
      return { lat: parsed.lat, lng: parsed.lng }
    }
  } catch {
    return undefined
  }
  return undefined
}

const landingSteps = [
  ["1", "Оберіть проблему", "Евакуатор, акумулятор, колесо, пальне, замок або інша несправність."],
  ["2", "Де ви зараз?", "Перевірте маркер на карті — партнер приїде саме сюди."],
  ["3", "Перевірте заявку", "Перегляньте деталі та надішліть заявку — без ціни та ETA до прийняття."],
  ["4", "Стежте за допомогою", "Виконавець приймає заявку, їде до клієнта й оновлює статус роботи."],
] as const

type LandingTheme = {
  page: string
  section: string
  sectionAlt: string
  nav: string
  navBorder: string
  text: string
  muted: string
  subtle: string
  navText: string
  badgeBg: string
  badgeBorder: string
  badgeText: string
  cardBorder: string
  cardShadow: string
  ghostBg: string
  ghostBorder: string
  footer: string
  menu: string
  heroFadeBottom: string
  heroGradientText: string
  statValue: string
  mapOverlay: string
  heroBg: string
  heroPattern: string
}

function buildLandingTheme(mode: PomichThemeMode, colors: PomichThemeColors): LandingTheme {
  const isDark = mode === "dark"
  return {
    page: colors.bg,
    section: colors.section,
    sectionAlt: colors.sectionAlt,
    nav: colors.nav,
    navBorder: colors.navBorder,
    text: colors.text,
    muted: colors.muted,
    subtle: colors.subtle,
    /* Header is always dark glass over the map — light slate vanishes on it. */
    navText: "#F8FAFC",
    badgeBg: isDark ? "rgba(22,163,106,0.12)" : "#EAFBF2",
    badgeBorder: isDark ? "rgba(22,163,106,0.38)" : "#A8EBC7",
    badgeText: colors.badgeText,
    cardBorder: colors.glassCardBorder,
    cardShadow: colors.cardShadow,
    ghostBg: colors.ghostBg,
    ghostBorder: colors.ghostBorder,
    footer: isDark ? "rgba(9, 11, 14, 0.78)" : "rgba(238, 244, 248, 0.82)",
    menu: isDark ? "rgba(24, 28, 36, 0.98)" : "rgba(255,255,255,0.98)",
    heroFadeBottom: colors.heroFadeBottom,
    heroGradientText: colors.heroGradientText,
    statValue: isDark ? "#FACC15" : colors.brand,
    mapOverlay: isDark
      ? "linear-gradient(180deg, rgba(9,11,14,0.06), rgba(9,11,14,0.28))"
      : "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.16))",
    heroBg: colors.heroBg,
    heroPattern: colors.heroPattern,
  }
}

function landingCardSurface(theme: LandingTheme): { border: string; background: string; boxShadow: string } {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: "var(--pomich-glass-card)",
    boxShadow: theme.cardShadow,
  }
}

function LandingButton({
  children,
  onClick,
  theme,
  variant = "primary",
  compact = false,
  surface = "default",
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  theme: LandingTheme
  variant?: "primary" | "secondary" | "ghost"
  compact?: boolean
  /** Header chrome is always dark glass over the map — ghost CTAs need light text in both themes. */
  surface?: "default" | "header"
  className?: string
}) {
  const isPrimary = variant === "primary"
  const isGhost = variant === "ghost"
  const onHeader = surface === "header"
  return (
    <button
      onClick={onClick}
      className={["landing-cta-btn", onHeader && isGhost ? "landing-header-ghost-btn" : null, className].filter(Boolean).join(" ")}
      style={{
        minHeight: compact ? 48 : 54,
        border: isGhost ? `1px solid ${onHeader ? "rgba(255,255,255,0.22)" : theme.ghostBorder}` : "none",
        borderRadius: compact ? 12 : 14,
        padding: compact ? "0 16px" : "0 22px",
        fontSize: compact ? 14 : 15,
        background: isPrimary
          ? "linear-gradient(135deg, #16A36A 0%, #1A8F6A 48%, #2F80ED 100%)"
          : isGhost
            ? onHeader
              ? "rgba(255,255,255,0.08)"
              : theme.ghostBg
            : "linear-gradient(135deg, #2F80ED 0%, #3B9AE8 55%, #C9A227 100%)",
        color: isGhost ? (onHeader ? theme.navText : theme.text) : "#fff",
        boxShadow: isGhost ? "none" : isPrimary ? "0 14px 32px rgba(22,163,106,0.28)" : "0 14px 32px rgba(47,128,237,0.22)",
        fontFamily: "inherit",
        fontWeight: 900,
        cursor: "pointer",
        width: onHeader ? "auto" : "100%",
        letterSpacing: "0.01em",
      }}
    >
      {children}
    </button>
  )
}

function LandingSectionTitle({ eyebrow, title, subtitle, theme, compact = false }: { eyebrow: string; title: string; subtitle: string; theme: LandingTheme; compact?: boolean }) {
  return (
    <div className="landing-section-title pomich-landing-inner" style={{ textAlign: "center", margin: compact ? "0 auto 14px" : "0 auto 34px" }}>
      <div style={{ display: "inline-flex", border: "1px solid rgba(47,128,237,0.42)", background: "rgba(47,128,237,0.14)", color: "#69A7FF", borderRadius: 999, padding: compact ? "5px 10px" : "7px 12px", fontWeight: 900, fontSize: compact ? 11 : 13 }}>{eyebrow}</div>
      <h2 style={{ margin: compact ? "10px 0 0" : "18px 0 0", color: theme.text, fontSize: compact ? 22 : "clamp(28px, 4vw, 42px)", lineHeight: 1.03, letterSpacing: 0, fontWeight: 950 }}>{title}</h2>
      <p style={{ margin: compact ? "8px auto 0" : "14px auto 0", color: theme.muted, fontSize: compact ? 13 : 17, lineHeight: compact ? 1.45 : 1.55, fontWeight: 700 }}>{subtitle}</p>
    </div>
  )
}

function LandingHeroBackground({
  theme,
}: {
  theme: LandingTheme
  isDark: boolean
}) {
  return (
    <PomichMapBackground
      providers={landingHeroProviders}
      variant="hero"
      fixed
      fadeBottom={theme.heroFadeBottom}
    />
  )
}

export default function LandingPage({
  onSelect,
  onRegister,
  onLogin,
  onHiddenAdmin,
}: {
  onSelect: (role: Role) => void
  onRegister: () => void
  onLogin: () => void
  onHiddenAdmin?: () => void
}) {
  /* Landing hero owns its own decorative map — avoid stacking the global shell map. */
  useSuppressMapAtmosphere()
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTelegram = telegramContext.isTelegram
  const layoutCompact = isTelegram || isMobile
  const [menuOpen, setMenuOpen] = useState(false)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [mapSectionVisible, setMapSectionVisible] = useState(false)
  const mapSectionRef = useRef<HTMLElement | null>(null)
  const {
    scope: directoryScope,
    setScope: setDirectoryScope,
    resolvedCity: directoryScopeCity,
    cityCenter: directoryScopeCityCenter,
    providers: mapProviders,
    loading: mapProvidersLoading,
    recenterTrigger: directoryScopeRecenterTrigger,
    geoError: directoryScopeGeoError,
    geoLoading: directoryScopeGeoLoading,
    retryGeo: retryDirectoryGeo,
  } = useDirectoryScope({ enabled: mapSectionVisible })
  const [mapUserLocation, setMapUserLocation] = useState<Point | undefined>(() => readLandingUserLocation())
  const [mapGeoStatus, setMapGeoStatus] = useState<"idle" | "requesting" | "success" | "error">(() => (readLandingUserLocation() ? "success" : "idle"))
  const landingRootRef = useRef<HTMLDivElement | null>(null)
  const [heroMapReady, setHeroMapReady] = useState(false)
  const { mode, colors, isDark } = usePomichTheme()
  const theme = buildLandingTheme(mode, colors)
  const heroRegionLabel =
    directoryScope === "my-city" && directoryScopeCity ? directoryScopeCity : UKRAINE_WIDE_LABEL
  const navItems = [
    ["#home", "Головна"],
    ["#services", "Послуги"],
    ["#steps", "Як це працює"],
    ["#map", "Карта"],
    ["#contacts", "Контакти"],
  ] as const

  useEffect(() => {
    if (typeof window === "undefined") return
    const start = () => setHeroMapReady(true)
    if ("requestIdleCallback" in (window as any)) {
      const id = (window as any).requestIdleCallback(start, { timeout: 1800 })
      return () => (window as any).cancelIdleCallback(id)
    }
    const id = window.setTimeout(start, 900)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    const root = landingRootRef.current
    const readScrollTop = () => {
      const fromRoot = root?.scrollTop ?? 0
      const fromWindow = window.scrollY || document.documentElement.scrollTop || 0
      return Math.max(fromRoot, fromWindow)
    }
    const onScroll = () => setHeaderScrolled(readScrollTop() > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    root?.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      root?.removeEventListener("scroll", onScroll)
    }
  }, [])

  useEffect(() => {
    const section = mapSectionRef.current
    if (!section || typeof IntersectionObserver === "undefined") {
      setMapSectionVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setMapSectionVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "240px 0px" },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  const requestMapGeo = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setMapGeoStatus("error")
      return
    }
    setMapGeoStatus("requesting")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        window.sessionStorage.setItem("pomichLandingGeo", JSON.stringify(point))
        setMapUserLocation(point)
        setMapGeoStatus("success")
      },
      () => setMapGeoStatus("error"),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const mapProviderCount = mapProviders.length

  const headerH = layoutCompact ? 52 : 66

  return (
    <div
      ref={landingRootRef}
      className={isTelegram ? "tg-compact pomich-landing" : "pomich-landing"}
      style={{
        minHeight: "100dvh",
        background: "transparent",
        color: theme.text,
        ["--landing-header-h" as string]: `${headerH}px`,
      }}
    >
      {/* One fixed decorative map for the whole landing (website + Telegram WebApp). */}
      {/* Decorative hero map loads after first paint to keep landing fast. */}
      {heroMapReady ? (
        <LandingHeroBackground theme={theme} isDark={isDark} />
      ) : (
        <div
          className="pomich-map-shell__bg pomich-map-shell__bg--fixed"
          aria-hidden="true"
          style={{ background: theme.heroBg }}
        />
      )}
      <header
        className={`pomich-landing-header${headerScrolled ? " is-scrolled" : ""}`}
        style={{ height: headerH, padding: layoutCompact ? "0 12px" : "0 28px" }}
      >
        <div className="pomich-landing-header__inner">
          <a href="#home" className="pomich-landing-header__brand" style={{ gap: layoutCompact ? 8 : 12 }}>
            <span className="pomich-landing-header__mark" style={{ width: layoutCompact ? 34 : 42, height: layoutCompact ? 34 : 42, fontSize: layoutCompact ? 16 : 20 }}>P</span>
            <span style={{ fontSize: layoutCompact ? 16 : 20 }}>POMICH</span>
          </a>
          {layoutCompact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ThemeToggle compact={layoutCompact} />
              <button aria-label="Меню" onClick={() => setMenuOpen((value) => !value)} style={{ width: 44, height: 44, border: `1px solid ${theme.ghostBorder}`, borderRadius: 10, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)", color: theme.text, fontSize: 22, fontWeight: 900, cursor: "pointer", backdropFilter: "blur(8px)" }}>☰</button>
            </div>
          ) : (
            <nav style={{ display: "flex", alignItems: "center", gap: 26 }}>
              {navItems.map(([href, label]) => (
                <a key={href} href={href} className="pomich-landing-nav-link">{label}</a>
              ))}
            </nav>
          )}
          {!layoutCompact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ThemeToggle compact={layoutCompact} />
              <LandingButton theme={theme} variant="ghost" surface="header" onClick={onLogin}>Увійти</LandingButton>
              <LandingButton theme={theme} onClick={onRegister}>Зареєструватися</LandingButton>
            </div>
          ) : null}
        </div>
        {layoutCompact && menuOpen ? (
          <div className="pomich-landing-header__menu" style={{ top: headerH, border: `1px solid ${theme.ghostBorder}`, padding: 12, display: "grid", gap: 4 }}>
            {navItems.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} style={{ color: theme.text, textDecoration: "none", fontWeight: 900, padding: "10px 10px", borderRadius: 6, fontSize: 14 }}>{label}</a>
            ))}
            <button type="button" onClick={() => { setMenuOpen(false); onLogin() }} style={{ marginTop: 6, minHeight: 44, border: `1px solid ${theme.ghostBorder}`, borderRadius: 8, background: theme.ghostBg, color: theme.text, fontFamily: "inherit", fontWeight: 900, cursor: "pointer" }}>Увійти</button>
            <button type="button" onClick={() => { setMenuOpen(false); onRegister() }} style={{ minHeight: 44, border: "none", borderRadius: 8, background: "linear-gradient(135deg, #16A36A 0%, #2F80ED 100%)", color: "#fff", fontFamily: "inherit", fontWeight: 900, cursor: "pointer" }}>Зареєструватися</button>
          </div>
        ) : null}
      </header>

      <main>
        <section
          id="home"
          className="landing-hero"
          style={{
            position: "relative",
            minHeight: layoutCompact ? "min(100dvh, 640px)" : "min(100dvh, 780px)",
            display: "flex",
            alignItems: layoutCompact ? "center" : "flex-end",
            justifyContent: layoutCompact ? "center" : "flex-start",
            paddingTop: headerH + (layoutCompact ? 28 : 36),
            paddingRight: layoutCompact ? 18 : 48,
            paddingBottom: layoutCompact ? 40 : 72,
            paddingLeft: layoutCompact ? 18 : 48,
            overflow: "visible",
          }}
        >
          <div
            className="landing-hero-content"
            style={{
              position: "relative",
              zIndex: 3,
              width: "100%",
              maxWidth: layoutCompact ? 420 : 560,
              textAlign: layoutCompact ? "center" : "left",
              margin: layoutCompact ? "0 auto" : "0",
            }}
          >
            <p className="landing-hero-eyebrow" style={{ margin: 0, color: isDark ? "rgba(185,220,200,0.92)" : "rgba(15,70,50,0.78)", fontSize: layoutCompact ? 12 : 13, fontWeight: 750, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              <span className="landing-hero-live-dot" aria-hidden />
              {heroRegionLabel === UKRAINE_WIDE_LABEL ? "УКРАЇНА · ROADSIDE" : `${heroRegionLabel} · ROADSIDE`}
            </p>
            <h1
              className="landing-hero-brand"
              style={{
                margin: layoutCompact ? "14px 0 0" : "18px 0 0",
                fontFamily: "var(--font-sans)",
                /* Narrow phones: size from viewport so "POMICH" never clips (html overflow-x:hidden). */
                fontSize: layoutCompact
                  ? "clamp(44px, calc((100vw - 40px) / 5.4), 80px)"
                  : "clamp(92px, 11vw, 132px)",
                lineHeight: 0.92,
                fontWeight: 800,
                letterSpacing: layoutCompact ? "-0.045em" : "-0.03em",
                maxWidth: "100%",
                overflow: "visible",
              }}
            >
              <span className="landing-hero-brand-word">
                {"POMICH".split("").map((letter, index) => (
                  <span
                    key={`${letter}-${index}`}
                    className="landing-hero-brand-letter"
                    style={{ animationDelay: `${0.08 + index * 0.06}s` }}
                  >
                    {letter}
                  </span>
                ))}
              </span>
              <span className="landing-hero-brand-sheen" aria-hidden />
              <span className="landing-hero-brand-underline" aria-hidden />
            </h1>
            <p
              className="landing-hero-title"
              style={{
                margin: layoutCompact ? "16px 0 0" : "20px 0 0",
                fontSize: layoutCompact ? 20 : "clamp(22px, 2.4vw, 28px)",
                lineHeight: 1.2,
                letterSpacing: "-0.01em",
                fontWeight: 800,
                maxWidth: layoutCompact ? "100%" : 440,
              }}
            >
              Допомога на дорозі — поруч
            </p>
            <p
              className="landing-hero-support"
              style={{
                margin: layoutCompact ? "10px auto 0" : "12px 0 0",
                maxWidth: layoutCompact ? 340 : 400,
                fontSize: layoutCompact ? 14 : 16,
                lineHeight: 1.5,
                fontWeight: 600,
              }}
            >
              Евакуатор, акумулятор, колесо чи механік по всій Україні — від Києва до Ужгорода.
            </p>
            <div
              className="landing-hero-ctas"
              style={{
                margin: layoutCompact ? "22px auto 0" : "28px 0 0",
                display: "grid",
                gridTemplateColumns: layoutCompact ? "1fr" : "1fr 1fr",
                gap: 10,
                maxWidth: layoutCompact ? 320 : 420,
              }}
            >
              <LandingButton theme={theme} compact={layoutCompact} className="landing-hero-cta-primary" onClick={() => onSelect("customer")}>Потрібна допомога</LandingButton>
              <LandingButton theme={theme} compact={layoutCompact} variant="secondary" className="landing-hero-cta-secondary" onClick={() => onSelect("provider")}>Надаю послуги</LandingButton>
            </div>
          </div>
        </section>

        <section id="services" className="pomich-landing-section" style={{ padding: layoutCompact ? "24px 12px" : "76px 24px 96px" }}>
          <LandingSectionTitle theme={theme} eyebrow="Послуги" title="Що можна викликати через POMICH" subtitle="Орієнтовна базова вартість без реєстрації. Точна ціна залежить від відстані та ситуації на дорозі." compact={layoutCompact} />
          <div className="landing-services-grid pomich-landing-inner" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: layoutCompact ? 10 : 12 }}>
            {services.map((service) => {
              const basePrice = calculatePrice(service.key, 0).price
              const cardSurface = landingCardSurface(theme)
              return (
                <div key={service.key} style={{ ...cardSurface, borderRadius: layoutCompact ? 10 : 16, padding: layoutCompact ? 12 : 16, color: theme.text }}>
                  <div style={{ fontSize: layoutCompact ? 24 : 28 }}>{service.emoji}</div>
                  <h3 style={{ margin: layoutCompact ? "8px 0 0" : "10px 0 0", fontSize: layoutCompact ? 14 : 16, fontWeight: 950 }}>{service.label}</h3>
                  <p style={{ margin: "4px 0 0", color: theme.muted, fontSize: layoutCompact ? 12 : 13, fontWeight: 700 }}>від {basePrice} ₴ · +90 ₴/км</p>
                </div>
              )
            })}
          </div>
          <p className="pomich-landing-inner" style={{ margin: layoutCompact ? "16px auto 0" : "24px auto 0", textAlign: "center", color: theme.subtle, fontSize: layoutCompact ? 12 : 14, fontWeight: 700 }}>
            Щоб створити заявку, потрібна реєстрація — це займе хвилину.
          </p>
        </section>

        <section id="steps" className="pomich-landing-section-alt" style={{ padding: layoutCompact ? "24px 12px" : "64px 24px 80px" }}>
          <LandingSectionTitle theme={theme} eyebrow="Як це працює" title="Чотири кроки до допомоги" subtitle="Короткий сценарій для стресової ситуації: без зайвих форм і без телефонних списків." compact={layoutCompact} />
          <div className="landing-steps-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: layoutCompact ? 10 : 12 }}>
            {landingSteps.map(([number, title, text]) => {
              const cardSurface = landingCardSurface(theme)
              return (
                <div key={number} style={{ ...cardSurface, borderRadius: 10, padding: layoutCompact ? 12 : 14, color: theme.text }}>
                  <div className="landing-step-circle" style={{ width: 40, height: 40, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", fontWeight: 950, fontSize: 15, boxShadow: "0 0 0 4px rgba(47,128,237,0.14)", marginBottom: 8 }}>{number}</div>
                  <h3 style={{ margin: 0, fontSize: layoutCompact ? 14 : 15, fontWeight: 950, lineHeight: 1.2 }}>{title}</h3>
                  <p style={{ margin: "4px 0 0", color: theme.muted, fontSize: layoutCompact ? 12 : 13, lineHeight: 1.4, fontWeight: 700 }}>{text}</p>
                </div>
              )
            })}
          </div>
        </section>

        <section id="map" ref={mapSectionRef} className="pomich-landing-section" style={{ padding: layoutCompact ? "24px 12px" : "76px 24px 96px" }}>
          <LandingSectionTitle
            theme={theme}
            eyebrow="Карта"
            title={directoryScope === "all-ukraine" ? "Партнери по Україні" : `Партнери в ${directoryScopeCity ?? heroRegionLabel}`}
            subtitle={mapProvidersLoading ? "Завантажуємо довідник…" : `${mapProviderCount} сервісів на карті · перегляд без реєстрації`}
            compact={layoutCompact}
          />
          <div className="landing-map-frame">
            {mapSectionVisible ? (
            <LazyRouteMap
              pickup={LANDING_MAP_CENTER}
              providers={mapProviders}
              subtitle={directoryScope === "all-ukraine" ? "Україна · довідник сервісів" : `${directoryScopeCity ?? heroRegionLabel} · довідник сервісів`}
              full
              directoryOnly
              mapTileTheme="light"
              showLocateControl={false}
              userLocation={mapUserLocation}
              directoryScope={directoryScope}
              onDirectoryScopeChange={setDirectoryScope}
              directoryScopeCity={directoryScopeCity ?? undefined}
              directoryScopeGeoLoading={directoryScopeGeoLoading}
              directoryScopeGeoError={directoryScopeGeoError}
              onDirectoryScopeGeoRetry={retryDirectoryGeo}
              directoryScopeRecenterTrigger={directoryScopeRecenterTrigger}
              directoryScopeCityCenter={directoryScopeCityCenter ?? undefined}
              mapZoom={directoryScope === "all-ukraine" ? 6 : undefined}
              ukraineMapFitCountry={directoryScope === "all-ukraine"}
              onUserLocationChange={(point) => {
                window.sessionStorage.setItem("pomichLandingGeo", JSON.stringify(point))
                setMapUserLocation(point)
                setMapGeoStatus("success")
              }}
            />
            ) : (
              <div
                className="pomich-route-map pomich-route-map--full pomich-route-map--loading"
                style={{ minHeight: layoutCompact ? 280 : 420, background: "var(--pomich-subtle, #e8edf2)" }}
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              className="landing-map-geo-btn"
              onClick={requestMapGeo}
              disabled={mapGeoStatus === "requesting"}
              style={{
                color: theme.text,
                fontSize: layoutCompact ? 11 : 12,
                cursor: mapGeoStatus === "requesting" ? "wait" : "pointer",
              }}
            >
              {mapGeoStatus === "requesting" ? "Визначаємо…" : mapGeoStatus === "success" ? "Моє місце ✓" : "📍 Моє місце"}
            </button>
          </div>
          <p className="pomich-landing-inner" style={{ margin: layoutCompact ? "12px auto 0" : "18px auto 0", textAlign: "center", color: theme.subtle, fontSize: layoutCompact ? 12 : 13, fontWeight: 700 }}>
            Карта лише для перегляду. Щоб викликати допомогу — зареєструйтесь як клієнт.
            {mapGeoStatus === "error" ? " · Не вдалося визначити місце — спробуйте ще раз." : null}
          </p>
        </section>

        <section id="contacts" className="pomich-landing-section-alt" style={{ padding: layoutCompact ? "24px 12px 32px" : "64px 24px 80px", background: "radial-gradient(circle at 50% 0%, rgba(22,163,106,0.18), transparent 34%)", textAlign: "center" }}>
          <LandingSectionTitle theme={theme} eyebrow="Контакти" title="Зв'яжіться з POMICH" subtitle="Telegram-бот, реєстрація клієнта або партнера — оберіть зручний спосіб." compact={layoutCompact} />
          <div className="pomich-landing-inner" style={{ display: "grid", gap: layoutCompact ? 10 : 12 }}>
            <a href="https://t.me/pomich_ua_bot" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              <div style={{ minHeight: layoutCompact ? 56 : 64, borderRadius: layoutCompact ? 10 : 12, color: theme.text, textAlign: "left", padding: layoutCompact ? "12px 14px" : "14px 16px", fontWeight: 950, ...landingCardSurface(theme) }}>
                <span style={{ display: "block", color: isDark ? "#69A7FF" : colors.accentBlue, fontSize: layoutCompact ? 11 : 13 }}>Telegram</span>
                <span style={{ display: "block", marginTop: 4, fontSize: layoutCompact ? 15 : 17 }}>@pomich_ua_bot</span>
              </div>
            </a>
            <button type="button" onClick={() => onSelect("customer")} style={{ minHeight: layoutCompact ? 56 : 64, borderRadius: layoutCompact ? 10 : 12, color: theme.text, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: layoutCompact ? "12px 14px" : "14px 16px", fontWeight: 950, ...landingCardSurface(theme) }}>
              <span style={{ display: "block", color: isDark ? "#8EF0BE" : colors.accent, fontSize: layoutCompact ? 11 : 13 }}>Водіям</span>
              <span style={{ display: "block", marginTop: 4, fontSize: layoutCompact ? 15 : 17 }}>Потрібна допомога</span>
            </button>
            <button type="button" onClick={() => onSelect("provider")} style={{ minHeight: layoutCompact ? 56 : 64, borderRadius: layoutCompact ? 10 : 12, color: theme.text, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: layoutCompact ? "12px 14px" : "14px 16px", fontWeight: 950, ...landingCardSurface(theme) }}>
              <span style={{ display: "block", color: isDark ? "#69A7FF" : colors.accentBlue, fontSize: layoutCompact ? 11 : 13 }}>Партнерам</span>
              <span style={{ display: "block", marginTop: 4, fontSize: layoutCompact ? 15 : 17 }}>Надаю послуги</span>
            </button>
          </div>
        </section>
      </main>

      <footer className="pomich-landing-footer" style={{ borderTop: `1px solid ${theme.navBorder}`, background: theme.footer, padding: layoutCompact ? "16px 12px" : "28px 24px" }}>
        <div style={{ maxWidth: 1070, margin: "0 auto", display: "flex", flexDirection: layoutCompact ? "column" : "row", justifyContent: "space-between", gap: layoutCompact ? 10 : 16, color: "var(--pomich-nav-text)", fontSize: layoutCompact ? 12 : 13, fontWeight: 800 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", fontWeight: 950 }}>P</span>
            <span>POMICH · Україна</span>
          </div>
          <div>© 2026 · @pomich_ua_bot</div>
        </div>
      </footer>
    </div>
  )
}
