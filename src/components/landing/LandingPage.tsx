import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { type ProviderAvailability } from "../../api/client"
import LazyRouteMap from "../map/LazyRouteMap"
import { PomichMapBackground, useSuppressMapAtmosphere } from "../layout/PomichMapShell"
import { useDirectoryScope } from "../../hooks/useDirectoryScope"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { mediaQueries } from "../../lib/breakpoints"
import { ADMIN_LOGO_HOLD_MS } from "../../lib/adminAccess"
import { PICKUP, services, type Point, type Role } from "../../lib/constants"
import { readCachedGeoPosition, requestCurrentPosition } from "../../lib/mapGeo"
import { calculatePrice } from "../../lib/pomichDomain"
import { UKRAINE_WIDE_LABEL } from "../../lib/ukraineCities"
import { getTelegramContext } from "../../telegram"
import { ThemeToggle } from "../ui/ThemeToggle"
import ServiceIcon from "../ui/ServiceIcon"
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
  return readCachedGeoPosition() ?? undefined
}

const landingSteps = [
  ["1", "Оберіть проблему", "Евакуатор, АКБ, колесо, пальне чи інша несправність."],
  ["2", "Підтвердіть місце", "Маркер на карті — партнер їде саме туди."],
  ["3", "Надішліть заявку", "Без торгу по телефону — деталі в чаті."],
  ["4", "Стежте за статусом", "Прийнято → в дорозі → на місці → готово."],
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
          ? "linear-gradient(135deg, #16A36A 0%, #1A8F6A 55%, #15803D 100%)"
          : isGhost
            ? onHeader
              ? "rgba(255,255,255,0.08)"
              : theme.ghostBg
            : "linear-gradient(135deg, #1D6FD4 0%, #2F80ED 55%, #3B9AE8 100%)",
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
  const adminHoldTimerRef = useRef<number | null>(null)
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
    return () => {
      if (adminHoldTimerRef.current) {
        window.clearTimeout(adminHoldTimerRef.current)
        adminHoldTimerRef.current = null
      }
    }
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

  /* Landing map: if «моє місто» failed to resolve, fall back to all-Ukraine so the section is never empty. */
  useEffect(() => {
    if (!mapSectionVisible || mapProvidersLoading) return
    if (mapProviders.length > 0) return
    if (directoryScope === "all-ukraine") return
    setDirectoryScope("all-ukraine")
  }, [mapSectionVisible, mapProvidersLoading, mapProviders.length, directoryScope, setDirectoryScope])

  useEffect(() => {
    if (!menuOpen || !layoutCompact) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }
    window.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [menuOpen, layoutCompact])

  const requestMapGeo = () => {
    setMapGeoStatus("requesting")
    requestCurrentPosition(
      (point) => {
        window.sessionStorage.setItem("pomichLandingGeo", JSON.stringify(point))
        setMapUserLocation(point)
        setMapGeoStatus("success")
      },
      () => setMapGeoStatus("error"),
      { mode: "explicit" },
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
          <a
            href="#home"
            className="pomich-landing-header__brand"
            style={{ gap: layoutCompact ? 8 : 12 }}
            onPointerDown={() => {
              if (!onHiddenAdmin) return
              if (adminHoldTimerRef.current) window.clearTimeout(adminHoldTimerRef.current)
              adminHoldTimerRef.current = window.setTimeout(() => {
                adminHoldTimerRef.current = null
                onHiddenAdmin()
              }, ADMIN_LOGO_HOLD_MS)
            }}
            onPointerUp={() => {
              if (adminHoldTimerRef.current) {
                window.clearTimeout(adminHoldTimerRef.current)
                adminHoldTimerRef.current = null
              }
            }}
            onPointerLeave={() => {
              if (adminHoldTimerRef.current) {
                window.clearTimeout(adminHoldTimerRef.current)
                adminHoldTimerRef.current = null
              }
            }}
            onContextMenu={(event) => {
              if (onHiddenAdmin) event.preventDefault()
            }}
          >
            <span className="pomich-landing-header__mark" style={{ width: layoutCompact ? 34 : 42, height: layoutCompact ? 34 : 42, fontSize: layoutCompact ? 16 : 20 }}>P</span>
            <span style={{ fontSize: layoutCompact ? 16 : 20 }}>POMICH</span>
          </a>
          {layoutCompact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ThemeToggle compact={layoutCompact} />
              <button
                type="button"
                aria-label={menuOpen ? "Закрити меню" : "Меню"}
                aria-expanded={menuOpen}
                aria-controls="pomich-landing-mobile-menu"
                onClick={() => setMenuOpen((value) => !value)}
                className="pomich-landing-header__menu-toggle"
                style={{ width: 44, height: 44, border: "1px solid rgba(255,255,255,0.22)", borderRadius: 10, background: "rgba(255,255,255,0.1)", color: "#F8FAFC", fontSize: 22, fontWeight: 900, cursor: "pointer" }}
              >
                {menuOpen ? "✕" : "☰"}
              </button>
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
          <>
            <button
              type="button"
              className="pomich-landing-header__menu-backdrop"
              aria-label="Закрити меню"
              onClick={() => setMenuOpen(false)}
            />
            <div
              id="pomich-landing-mobile-menu"
              className="pomich-landing-header__menu"
              role="dialog"
              aria-modal="true"
              style={{ top: headerH }}
            >
              {navItems.map(([href, label]) => (
                <a key={href} href={href} onClick={() => setMenuOpen(false)} className="pomich-landing-header__menu-link">{label}</a>
              ))}
              <button type="button" className="pomich-landing-header__menu-login" onClick={() => { setMenuOpen(false); onLogin() }}>Увійти</button>
              <button type="button" className="pomich-landing-header__menu-register" onClick={() => { setMenuOpen(false); onRegister() }}>Зареєструватися</button>
            </div>
          </>
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
            <h1
              className="landing-hero-brand"
              style={{
                margin: 0,
                fontFamily: "var(--font-display, var(--font-sans))",
                fontSize: layoutCompact
                  ? "clamp(48px, calc((100vw - 40px) / 5.2), 84px)"
                  : "clamp(96px, 12vw, 140px)",
                lineHeight: 0.9,
                fontWeight: 800,
                letterSpacing: layoutCompact ? "-0.05em" : "-0.035em",
                maxWidth: "100%",
                overflow: "visible",
              }}
            >
              <span className="landing-hero-brand-word">
                {"POMICH".split("").map((letter, index) => (
                  <span
                    key={`${letter}-${index}`}
                    className="landing-hero-brand-letter"
                    style={{ animationDelay: `${0.06 + index * 0.05}s` }}
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
                margin: layoutCompact ? "14px 0 0" : "18px 0 0",
                fontSize: layoutCompact ? 18 : "clamp(20px, 2.2vw, 26px)",
                lineHeight: 1.2,
                letterSpacing: "-0.02em",
                fontWeight: 750,
                maxWidth: layoutCompact ? "100%" : 440,
              }}
            >
              Допомога на дорозі — коли вона потрібна
            </p>
            <p
              className="landing-hero-support"
              style={{
                margin: layoutCompact ? "8px auto 0" : "10px 0 0",
                maxWidth: layoutCompact ? 320 : 380,
                fontSize: layoutCompact ? 13 : 15,
                lineHeight: 1.45,
                fontWeight: 600,
              }}
            >
              Евакуатор, АКБ, колесо чи пальне — партнери поруч по всій Україні.
            </p>
            <div
              className="landing-hero-ctas"
              style={{
                margin: layoutCompact ? "18px auto 0" : "24px 0 0",
                display: "grid",
                gridTemplateColumns: layoutCompact ? "1fr" : "1fr 1fr",
                gap: 8,
                maxWidth: layoutCompact ? 300 : 400,
              }}
            >
              <LandingButton theme={theme} compact={layoutCompact} className="landing-hero-cta-primary" onClick={() => onSelect("customer")}>Потрібна допомога</LandingButton>
              <LandingButton theme={theme} compact={layoutCompact} variant="secondary" className="landing-hero-cta-secondary" onClick={() => onSelect("provider")}>Надаю послуги</LandingButton>
            </div>
          </div>
        </section>

        <section id="services" className="pomich-landing-section" style={{ padding: layoutCompact ? "20px 12px" : "56px 24px 72px" }}>
          <LandingSectionTitle theme={theme} eyebrow="Послуги" title="Що викликаємо" subtitle="Орієнтовна база без реєстрації. Точна ціна — після прийняття заявки." compact={layoutCompact} />
          <div className="landing-services-list pomich-landing-inner" style={{ display: "grid", gap: layoutCompact ? 6 : 8 }}>
            {services.map((service) => {
              const basePrice = calculatePrice(service.key, 0).price
              return (
                <button
                  key={service.key}
                  type="button"
                  className="landing-service-row"
                  onClick={() => onSelect("customer")}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    minHeight: layoutCompact ? 48 : 52,
                    padding: layoutCompact ? "8px 10px" : "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${theme.cardBorder}`,
                    background: "color-mix(in srgb, var(--pomich-card-bg) 88%, transparent)",
                    color: theme.text,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <span className="landing-service-card__icon" style={{ background: service.tone, width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center" }}>
                    <ServiceIcon service={service.key} size={20} />
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: layoutCompact ? 14 : 15, fontWeight: 900, lineHeight: 1.15 }}>{service.label}</span>
                    <span style={{ display: "block", marginTop: 2, color: theme.muted, fontSize: 12, fontWeight: 700 }}>від {basePrice} ₴ · +90 ₴/км</span>
                  </span>
                  <span aria-hidden style={{ color: theme.subtle, fontWeight: 900, fontSize: 18 }}>›</span>
                </button>
              )
            })}
          </div>
        </section>

        <section id="steps" className="pomich-landing-section-alt" style={{ padding: layoutCompact ? "20px 12px" : "48px 24px 64px" }}>
          <LandingSectionTitle theme={theme} eyebrow="Як це працює" title="Чотири кроки" subtitle="Короткий сценарій без зайвих форм." compact={layoutCompact} />
          <ol className="landing-steps-list pomich-landing-inner" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: layoutCompact ? 8 : 10 }}>
            {landingSteps.map(([number, title, text]) => (
              <li
                key={number}
                className="landing-step-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "2rem 1fr",
                  gap: 10,
                  alignItems: "start",
                  padding: layoutCompact ? "8px 0" : "10px 0",
                  borderBottom: `1px solid ${theme.cardBorder}`,
                  color: theme.text,
                }}
              >
                <span
                  className="landing-step-circle"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg, #16A36A, #0B7A4D)",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                >
                  {number}
                </span>
                <span>
                  <span style={{ display: "block", fontSize: layoutCompact ? 14 : 15, fontWeight: 900, lineHeight: 1.2 }}>{title}</span>
                  <span style={{ display: "block", marginTop: 2, color: theme.muted, fontSize: layoutCompact ? 12 : 13, lineHeight: 1.4, fontWeight: 650 }}>{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section id="map" ref={mapSectionRef} className="pomich-landing-section" style={{ padding: layoutCompact ? "24px 12px" : "76px 24px 96px" }}>
          <LandingSectionTitle
            theme={theme}
            eyebrow="Карта"
            title={
              directoryScope === "my-city" && directoryScopeCity
                ? `Партнери в місті ${directoryScopeCity}`
                : "Партнери по Україні"
            }
            subtitle={
              mapProvidersLoading || (directoryScope === "my-city" && !directoryScopeCity)
                ? "Завантажуємо довідник…"
                : mapProviderCount > 0
                  ? `${mapProviderCount} сервісів на карті · перегляд без реєстрації`
                  : "Довідник тимчасово недоступний · спробуйте оновити сторінку"
            }
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

        <section id="contacts" className="pomich-landing-section-alt" style={{ padding: layoutCompact ? "20px 12px 28px" : "48px 24px 64px", textAlign: "center" }}>
          <LandingSectionTitle theme={theme} eyebrow="Контакти" title="Зв'язок з POMICH" subtitle="Telegram або реєстрація в застосунку." compact={layoutCompact} />
          <div className="pomich-landing-inner" style={{ display: "grid", gap: 8, maxWidth: 420, margin: "0 auto" }}>
            <a
              href="https://t.me/pomich_ua_bot"
              target="_blank"
              rel="noreferrer"
              style={{
                display: "block",
                minHeight: 44,
                borderRadius: 12,
                padding: "10px 14px",
                textDecoration: "none",
                color: theme.text,
                fontWeight: 850,
                border: `1px solid ${theme.cardBorder}`,
                background: "color-mix(in srgb, var(--pomich-card-bg) 88%, transparent)",
              }}
            >
              Telegram · @pomich_ua_bot
            </a>
            <div style={{ display: "grid", gridTemplateColumns: layoutCompact ? "1fr" : "1fr 1fr", gap: 8 }}>
              <LandingButton theme={theme} compact={layoutCompact} onClick={() => onSelect("customer")}>Потрібна допомога</LandingButton>
              <LandingButton theme={theme} compact={layoutCompact} variant="secondary" onClick={() => onSelect("provider")}>Надаю послуги</LandingButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="pomich-landing-footer" style={{ borderTop: `1px solid ${theme.navBorder}`, background: theme.footer, padding: layoutCompact ? "14px 12px 20px" : "24px 24px 28px" }}>
        <div style={{ maxWidth: 1070, margin: "0 auto", display: "grid", gap: layoutCompact ? 10 : 14, color: "var(--pomich-nav-text)", fontSize: layoutCompact ? 12 : 13, fontWeight: 750 }}>
          <div style={{ display: "flex", flexDirection: layoutCompact ? "column" : "row", justifyContent: "space-between", gap: 10, alignItems: layoutCompact ? "flex-start" : "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #0B7A4D)", color: "#fff", fontWeight: 950 }}>P</span>
              <span>POMICH · допомога на дорозі</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
              <a href="/privacy" style={{ color: "inherit", textDecoration: "none", opacity: 0.88 }}>Конфіденційність</a>
              <a href="/safety" style={{ color: "inherit", textDecoration: "none", opacity: 0.88 }}>Безпека</a>
              <a href="/about" style={{ color: "inherit", textDecoration: "none", opacity: 0.88 }}>Про нас</a>
              <a href="/partner" style={{ color: "inherit", textDecoration: "none", opacity: 0.88 }}>Партнерам</a>
            </div>
          </div>
          <div style={{ opacity: 0.72, fontWeight: 650 }}>© 2026 POMICH · <a href="https://t.me/pomich_ua_bot" style={{ color: "inherit" }}>@pomich_ua_bot</a></div>
        </div>
      </footer>
    </div>
  )
}
