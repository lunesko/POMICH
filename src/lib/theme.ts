export type PomichThemeMode = "light" | "dark"

export const POMICH_THEME_STORAGE_KEY = "pomichLandingTheme"

export const pomichThemeColors = {
  light: {
    bg: "#F4F9F7",
    surface: "#FFFFFF",
    text: "#0F172A",
    border: "#D8E6E0",
    brand: "#16A36A",
    muted: "#64748B",
    label: "#475569",
    subtle: "#94A3B8",
    accent: "#0B7A4D",
    accentBlue: "#1D6FD4",
    badgeText: "#0B7A4D",
    ghostBg: "#FFFFFF",
    ghostBorder: "#D8E6E0",
    cardShadow: "0 18px 44px rgba(15, 23, 42, 0.08)",
    errorBg: "#FFF1F2",
    errorText: "#BE123C",
    errorBorder: "#FECDD3",
    inputBg: "#FFFFFF",
    inputDisabledBg: "#F1F5F9",
    prefixBg: "#EEF4F1",
    footerBg: "#FFFFFF",
    nav: "rgba(255, 255, 255, 0.92)",
    navBorder: "#D8E6E0",
    heroBg:
      "radial-gradient(ellipse 120% 80% at 20% 0%, rgba(22, 163, 106, 0.14), transparent 55%), radial-gradient(ellipse 90% 70% at 85% 15%, rgba(47, 128, 237, 0.1), transparent 50%), linear-gradient(165deg, #FAFCFB 0%, #F0F7F3 48%, #E3EFE8 100%)",
    heroPattern: "radial-gradient(circle at center, rgba(22, 163, 106, 0.09) 1px, transparent 1px)",
    heroGradientText: "linear-gradient(90deg, #0B7A4D 0%, #1D6FD4 52%, #B8860B 100%)",
    heroFadeBottom: "linear-gradient(180deg, transparent, #F4F9F7)",
    section: "#F4F9F7",
    sectionAlt: "#EAF2EF",
    toggleTrack: "#E2E8F0",
    toggleBorder: "#CBD5E1",
    toggleKnob: "#FFFFFF",
    glassCard: "#FFFFFF",
    glassCardBorder: "#D8E6E0",
    roleCardBg: "#FFFFFF",
    roleCardBorder: "#D8E6E0",
    roleCardText: "#0F172A",
    roleCardMuted: "#64748B",
  },
  dark: {
    bg: "#090B0E",
    surface: "rgba(255, 255, 255, 0.06)",
    text: "#FFFFFF",
    border: "rgba(255, 255, 255, 0.13)",
    brand: "#16A36A",
    muted: "#B9C2D0",
    label: "#AAB4C3",
    subtle: "#9CA3AF",
    accent: "#8EF0BE",
    accentBlue: "#69A7FF",
    badgeText: "#8EF0BE",
    ghostBg: "rgba(255, 255, 255, 0.08)",
    ghostBorder: "rgba(255, 255, 255, 0.16)",
    cardShadow: "0 20px 70px rgba(0, 0, 0, 0.26)",
    errorBg: "rgba(190, 18, 60, 0.18)",
    errorText: "#FDA4AF",
    errorBorder: "rgba(253, 164, 175, 0.25)",
    inputBg: "rgba(255, 255, 255, 0.06)",
    inputDisabledBg: "rgba(255, 255, 255, 0.04)",
    prefixBg: "rgba(255, 255, 255, 0.08)",
    footerBg: "rgba(9, 11, 14, 0.96)",
    nav: "rgba(9, 11, 14, 0.92)",
    navBorder: "rgba(255, 255, 255, 0.08)",
    heroBg:
      "radial-gradient(circle at 50% 26%, rgba(22, 163, 106, 0.18), rgba(9, 11, 14, 0.18) 34%, #090B0E 78%), linear-gradient(180deg, rgba(9, 11, 14, 0.58), rgba(9, 11, 14, 0.96))",
    heroPattern: "radial-gradient(circle at center, rgba(22, 163, 106, 0.07) 1px, transparent 1px)",
    heroGradientText: "linear-gradient(90deg, #8EF0BE 0%, #69A7FF 52%, #FACC15 100%)",
    heroFadeBottom: "linear-gradient(180deg, transparent, #090B0E)",
    section: "#090B0E",
    sectionAlt: "#0D1015",
    toggleTrack: "rgba(255, 255, 255, 0.08)",
    toggleBorder: "rgba(255, 255, 255, 0.14)",
    toggleKnob: "#FFFFFF",
    glassCard: "linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.035))",
    glassCardBorder: "rgba(255, 255, 255, 0.13)",
    roleCardBg: "linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.035))",
    roleCardBorder: "rgba(255, 255, 255, 0.13)",
    roleCardText: "#FFFFFF",
    roleCardMuted: "#B9C2D0",
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

export function applyPomichThemeToDocument(mode: PomichThemeMode) {
  if (typeof document === "undefined") return
  document.documentElement.dataset.pomichTheme = mode
  clearPomichTelegramThemeOverrides()
}
