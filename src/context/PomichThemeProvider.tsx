import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import {
  applyPomichThemeToDocument,
  pomichThemeColors,
  POMICH_THEME_STORAGE_KEY,
  readStoredPomichTheme,
  resolveInitialPomichTheme,
  type PomichThemeColors,
  type PomichThemeMode,
} from "../lib/theme"
import { getTelegramContext } from "../telegram"

interface PomichThemeContextValue {
  mode: PomichThemeMode
  colors: PomichThemeColors
  setMode: (mode: PomichThemeMode) => void
  toggle: () => void
  isDark: boolean
}

const PomichThemeContext = createContext<PomichThemeContextValue | null>(null)

export function PomichThemeProvider({ children }: { children: ReactNode }) {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const [mode, setModeState] = useState<PomichThemeMode>(() =>
    resolveInitialPomichTheme({ telegramColorScheme: telegramContext.webApp?.colorScheme }),
  )

  const setMode = useCallback((next: PomichThemeMode) => {
    applyPomichThemeToDocument(next)
    setModeState(next)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(POMICH_THEME_STORAGE_KEY, next)
    }
  }, [])

  const toggle = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark")
  }, [mode, setMode])

  useEffect(() => {
    applyPomichThemeToDocument(mode)
  }, [mode])

  useEffect(() => {
    if (!telegramContext.webApp) return

    const webApp = telegramContext.webApp
    const onThemeChanged = () => {
      if (readStoredPomichTheme()) return
      const tgMode = webApp.colorScheme
      if (tgMode === "light" || tgMode === "dark") {
        applyPomichThemeToDocument(tgMode)
        setModeState(tgMode)
      }
    }

    const extended = webApp as typeof webApp & {
      onEvent?: (event: string, handler: () => void) => void
      offEvent?: (event: string, handler: () => void) => void
    }
    extended.onEvent?.("themeChanged", onThemeChanged)
    return () => extended.offEvent?.("themeChanged", onThemeChanged)
  }, [telegramContext.webApp])

  const value = useMemo(
    () => ({
      mode,
      colors: pomichThemeColors[mode],
      setMode,
      toggle,
      isDark: mode === "dark",
    }),
    [mode, setMode, toggle],
  )

  return <PomichThemeContext.Provider value={value}>{children}</PomichThemeContext.Provider>
}

export function usePomichTheme() {
  const ctx = useContext(PomichThemeContext)
  if (!ctx) throw new Error("usePomichTheme must be used within PomichThemeProvider")
  return ctx
}

export function usePomichThemeOptional() {
  return useContext(PomichThemeContext)
}

export default PomichThemeProvider
