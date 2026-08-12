import { useCallback, useEffect } from "react"
import { applyTelegramTheme, initTelegramApp, telegramHaptic, type TelegramWebApp } from "../telegram"
import { useTelegram } from "./useTelegram"

interface MainButtonConfig {
  text: string
  visible?: boolean
  enabled?: boolean
  loading?: boolean
  onClick?: () => void
}

interface BackButtonConfig {
  visible?: boolean
  onClick?: () => void
}

export function useTelegramUx() {
  const ctx = useTelegram()

  useEffect(() => {
    if (!ctx.isTelegram) return
    document.documentElement.classList.add("tg-compact")
    return () => document.documentElement.classList.remove("tg-compact")
  }, [ctx.isTelegram])

  useEffect(() => {
    if (!ctx.webApp) return

    const webApp = ctx.webApp
    applyTelegramTheme(webApp)

    const syncViewport = () => applyTelegramTheme(webApp)
    const onThemeChanged = () => applyTelegramTheme(webApp)

    syncViewport()
    window.addEventListener("resize", syncViewport)

    const viewportHandler = webApp as TelegramWebApp & {
      onEvent?: (event: string, handler: () => void) => void
      offEvent?: (event: string, handler: () => void) => void
    }
    viewportHandler.onEvent?.("viewportChanged", syncViewport)
    viewportHandler.onEvent?.("themeChanged", onThemeChanged)

    return () => {
      window.removeEventListener("resize", syncViewport)
      viewportHandler.offEvent?.("viewportChanged", syncViewport)
      viewportHandler.offEvent?.("themeChanged", onThemeChanged)
    }
  }, [ctx.webApp])

  const haptic = useCallback(
    (kind: "light" | "medium" | "heavy" | "selection" | "success" | "error" | "warning" = "light") => {
      telegramHaptic(ctx.webApp, kind)
    },
    [ctx.webApp],
  )

  return { ...ctx, haptic }
}

export function useTelegramMainButton(config: MainButtonConfig) {
  const { webApp, isTelegram } = useTelegram()
  const { text, visible = true, enabled = true, loading = false, onClick } = config

  useEffect(() => {
    const mainButton = webApp?.MainButton
    if (!isTelegram || !mainButton) return

    const handler = () => onClick?.()

    if (!visible) {
      mainButton.hide()
      mainButton.offClick(handler)
      return () => mainButton.offClick(handler)
    }

    mainButton.setText(text)
    mainButton.show()
    if (enabled && !loading) mainButton.enable()
    else mainButton.disable()
    if (loading) mainButton.showProgress?.()
    else mainButton.hideProgress?.()
    mainButton.onClick(handler)

    return () => {
      mainButton.offClick(handler)
      mainButton.hideProgress?.()
      mainButton.hide()
    }
  }, [isTelegram, webApp, text, visible, enabled, loading, onClick])
}

export function useTelegramBackButton(config: BackButtonConfig) {
  const { webApp, isTelegram } = useTelegram()
  const { visible = false, onClick } = config

  useEffect(() => {
    const backButton = webApp?.BackButton
    if (!isTelegram || !backButton) return

    const handler = () => onClick?.()

    if (!visible) {
      backButton.hide()
      backButton.offClick(handler)
      return () => backButton.offClick(handler)
    }

    backButton.show()
    backButton.onClick(handler)

    return () => {
      backButton.offClick(handler)
      backButton.hide()
    }
  }, [isTelegram, webApp, visible, onClick])
}
