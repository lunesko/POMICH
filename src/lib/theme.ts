import { telegramSupportsVersion } from "../telegram"

export type PomichThemeMode = "light" | "dark"

export const POMICH_THEME_STORAGE_KEY = "pomichLandingTheme"

export const pomichThemeColors = {
  light: {
    bg: "rgba(226, 233, 230, 0.82)",
    surface: "rgba(232, 238, 235, 0.90)",
    text: "#1A2332",
    border: "rgba(28, 42, 36, 0.12)",
    brand: "#16A36A",
    muted: "#4A5A68",
    label: "#2F3F4F",
    subtle: "#5F7385",
    accent: "#0B7A4D",
    accentBlue: "#1D6FD4",
    badgeText: "#0B7A4D",
    ghostBg: "rgba(28, 42, 36, 0.05)",
    ghostBorder: "rgba(28, 42, 36, 0.12)",
    cardShadow: "0 8px 24px rgba(28, 42, 36, 0.06), 0 1px 2px rgba(0, 0, 0, 0.03)",
    errorBg: "rgba(254, 226, 226, 0.88)",
    errorText: "#991B1B",
    errorBorder: "rgba(239, 68, 68, 0.28)",
    inputBg: "rgba(226, 233, 230, 0.95)",
    inputDisabledBg: "rgba(220, 228, 224, 0.85)",
    prefixBg: "rgba(220, 230, 226, 0.92)",
    footerBg: "rgba(232, 238, 235, 0.94)",
    nav: "rgba(232, 238, 235, 0.94)",
    navBorder: "rgba(28, 42, 36, 0.10)",
    heroBg:
      "radial-gradient(ellipse 120% 80% at 20% 0%, rgba(22, 163, 106, 0.12), transparent 55%), radial-gradient(ellipse 90% 70% at 85% 15%, rgba(47, 128, 237, 0.08), transparent 50%), linear-gradient(165deg, rgba(236,241,238,0.9) 0%, rgba(226,234,230,0.9) 48%, rgba(214,224,219,0.9) 100%)",
    heroPattern: "radial-gradient(circle at center, rgba(22, 163, 106, 0.08) 1px, transparent 1px)",
    heroGradientText: "linear-gradient(90deg, #0B7A4D 0%, #1D6FD4 52%, #B8860B 100%)",
    heroFadeBottom: "linear-gradient(180deg, transparent 55%, rgba(226,234,230,0.22) 100%)",
    section: "rgba(226, 234, 230, 0.72)",
    sectionAlt: "rgba(216, 226, 221, 0.78)",
    toggleTrack: "rgba(210, 219, 215, 0.70)",
    toggleBorder: "rgba(120, 140, 150, 0.45)",
    toggleKnob: "#F4F7F6",
    glassCard: "rgba(236, 241, 238, 0.82)",
    glassCardBorder: "rgba(28, 42, 36, 0.12)",
    roleCardBg: "rgba(236, 241, 238, 0.88)",
    roleCardBorder: "rgba(28, 42, 36, 0.12)",
    roleCardText: "#1A2332",
    roleCardMuted: "#4A5A68",
  },
  dark: {
    bg: "rgba(9, 11, 14, 0.65)",
    surface: "rgba(15, 23, 42, 0.68)",
    text: "#FFFFFF",
    border: "rgba(255, 255, 255, 0.16)",
    brand: "#16A36A",
    muted: "#CBD5E1",
    label: "#E2E8F0",
    subtle: "#94A3B8",
    accent: "#8EF0BE",
    accentBlue: "#69A7FF",
    badgeText: "#8EF0BE",
    ghostBg: "rgba(255, 255, 255, 0.08)",
    ghostBorder: "rgba(255, 255, 255, 0.16)",
    cardShadow: "0 20px 70px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.15)",
    errorBg: "rgba(190, 18, 60, 0.22)",
    errorText: "#FDA4AF",
    errorBorder: "rgba(253, 164, 175, 0.3)",
    inputBg: "rgba(30, 41, 59, 0.60)",
    inputDisabledBg: "rgba(15, 23, 42, 0.50)",
    prefixBg: "rgba(30, 41, 59, 0.70)",
    footerBg: "rgba(15, 23, 42, 0.68)",
    nav: "rgba(15, 23, 42, 0.68)",
    navBorder: "rgba(255, 255, 255, 0.14)",
    heroBg:
      "radial-gradient(circle at 50% 26%, rgba(22, 163, 106, 0.18), rgba(9, 11, 14, 0.18) 34%, rgba(9, 11, 14, 0.68) 78%), linear-gradient(180deg, rgba(9, 11, 14, 0.58), rgba(9, 11, 14, 0.88))",
    heroPattern: "radial-gradient(circle at center, rgba(22, 163, 106, 0.07) 1px, transparent 1px)",
    heroGradientText: "linear-gradient(90deg, #8EF0BE 0%, #69A7FF 52%, #FACC15 100%)",
    heroFadeBottom: "linear-gradient(180deg, transparent 55%, rgba(8,12,14,0.22) 100%)",
    section: "rgba(9, 11, 14, 0.50)",
    sectionAlt: "rgba(13, 16, 21, 0.55)",
    toggleTrack: "rgba(255, 255, 255, 0.10)",
    toggleBorder: "rgba(255, 255, 255, 0.18)",
    toggleKnob: "#FFFFFF",
    glassCard: "rgba(30, 41, 59, 0.65)",
    glassCardBorder: "rgba(255, 255, 255, 0.16)",
    roleCardBg: "rgba(30, 41, 59, 0.65)",
    roleCardBorder: "rgba(255, 255, 255, 0.16)",
    roleCardText: "#FFFFFF",
    roleCardMuted: "#CBD5E1",
  },
} as const

export type PomichThemeColors = (typeof pomichThemeColors)[PomichThemeMode]

export function readStoredPomichTheme(): PomichThemeMode | null {
  if (typeof window === "undefined") return null
  const stored = window.localStorage.getItem(POMICH_THEME_STORAGE_KEY)
  if (stored === "light" || stored === "dark") return stored
  return null
}

export function resolveInitialPomichTheme(options?: {
  telegramColorScheme?: "light" | "dark"
}): PomichThemeMode {
  const stored = readStoredPomichTheme()
  if (stored) return stored
  if (options?.telegramColorScheme) return options.telegramColorScheme
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark"
  }
  return "light"
}

export const POMICH_TG_THEME_CSS_VARS = [
  "--tg-theme-bg-color",
  "--tg-theme-text-color",
  "--tg-theme-hint-color",
  "--tg-theme-link-color",
  "--tg-theme-button-color",
  "--tg-theme-button-text-color",
  "--tg-theme-secondary-bg-color",
  "--tg-theme-header-bg-color",
  "--tg-theme-accent-text-color",
  "--tg-theme-section-bg-color",
  "--tg-theme-section-header-text-color",
  "--tg-theme-subtitle-text-color",
  "--tg-theme-destructive-text-color",
] as const

export function clearPomichTelegramThemeOverrides() {
  if (typeof document === "undefined") return
  const root = document.documentElement
  for (const cssVar of POMICH_TG_THEME_CSS_VARS) {
    root.style.removeProperty(cssVar)
  }
}

export function syncPomichThemeToTelegramWebApp(mode: PomichThemeMode) {
  if (typeof window === "undefined") return
  const webApp = window.Telegram?.WebApp
  // setHeaderColor / setBackgroundColor: Bot API 6.1+ (CSS theme still applies without these)
  if (!webApp || !telegramSupportsVersion(webApp, "6.1")) return
  const colors = pomichThemeColors[mode]
  webApp?.setHeaderColor?.(mode === "dark" ? "#090B0E" : "#E4EBE7")
  webApp?.setBackgroundColor?.(colors.bg)
}

export function applyPomichThemeToDocument(mode: PomichThemeMode) {
  if (typeof document === "undefined") return
  document.documentElement.dataset.pomichTheme = mode
  clearPomichTelegramThemeOverrides()
  syncPomichThemeToTelegramWebApp(mode)
}

/** Readable basemaps — Carto dark_all is verified working (dark_matter path 404s). */
export const MAP_TILE_URLS = {
  light: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  darkInApp: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  /** Esri World Imagery — free for non-commercial use with attribution. */
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
} as const

export const MAP_TILE_ATTRIBUTIONS = {
  osm: "&copy; OpenStreetMap contributors",
  carto: "&copy; OpenStreetMap &copy; CARTO",
  satellite:
    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
} as const

export type MapTileConfig = {
  url: string
  attribution: string
  subdomains?: string
}

/** OSM / Carto for all maps — city ride maps and Ukraine-wide directory views. */
export function resolveMapTileConfig(options: {
  ukraineMask?: boolean
  mapTileTheme?: MapTileTheme
  isDark?: boolean
}): MapTileConfig {
  const dark = resolveMapUsesDarkTiles({
    mapTileTheme: options.mapTileTheme,
    isDark: options.isDark,
  })
  if (dark) {
    return {
      url: MAP_TILE_URLS.darkInApp,
      attribution: MAP_TILE_ATTRIBUTIONS.carto,
      subdomains: "abcd",
    }
  }
  return {
    url: MAP_TILE_URLS.light,
    attribution: MAP_TILE_ATTRIBUTIONS.osm,
    subdomains: "abc",
  }
}

export type MapTileTheme = "light" | "dark" | "auto"

export function readActivePomichTheme(): PomichThemeMode {
  if (typeof document === "undefined") return "light"
  const fromDom = document.documentElement.dataset.pomichTheme
  if (fromDom === "light" || fromDom === "dark") return fromDom
  return readStoredPomichTheme() ?? "light"
}

/** Landing hero uses mapTileTheme="light"; in-app maps follow active UI theme. */
export function resolveMapUsesDarkTiles(options: {
  decorative?: boolean
  mapTileTheme?: MapTileTheme
  isDark?: boolean
}): boolean {
  if (options.mapTileTheme === "light") return false
  if (options.mapTileTheme === "dark") return true
  const dark = options.isDark ?? readActivePomichTheme() === "dark"
  return dark
}
