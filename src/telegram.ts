export interface TelegramWebAppUser {
  id?: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
  header_bg_color?: string
  accent_text_color?: string
  section_bg_color?: string
  section_header_text_color?: string
  subtitle_text_color?: string
  destructive_text_color?: string
}

export interface TelegramMainButton {
  text: string
  color: string
  textColor: string
  isVisible: boolean
  isActive: boolean
  isProgressVisible: boolean
  setText: (text: string) => void
  onClick: (callback: () => void) => void
  offClick: (callback: () => void) => void
  show: () => void
  hide: () => void
  enable: () => void
  disable: () => void
  showProgress: (leaveActive?: boolean) => void
  hideProgress: () => void
  setParams: (params: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }) => void
}

export interface TelegramBackButton {
  isVisible: boolean
  onClick: (callback: () => void) => void
  offClick: (callback: () => void) => void
  show: () => void
  hide: () => void
}

export interface TelegramHapticFeedback {
  impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void
  notificationOccurred: (type: "error" | "success" | "warning") => void
  selectionChanged: () => void
}

export interface TelegramSafeAreaInset {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

export interface TelegramContact {
  phone_number?: string
  first_name?: string
  last_name?: string
  user_id?: number
}

export interface TelegramWebApp {
  initData?: string
  initDataUnsafe?: {
    user?: TelegramWebAppUser
    start_param?: string
  }
  version?: string
  platform?: string
  colorScheme?: "light" | "dark"
  themeParams?: TelegramThemeParams
  isExpanded?: boolean
  viewportHeight?: number
  viewportStableHeight?: number
  /** Bot API 7.0+ — system safe area (notch / home indicator). */
  safeAreaInset?: TelegramSafeAreaInset
  /** Bot API 8.0+ — content safe area inside Telegram chrome. */
  contentSafeAreaInset?: TelegramSafeAreaInset
  headerColor?: string
  backgroundColor?: string
  isClosingConfirmationEnabled?: boolean
  MainButton?: TelegramMainButton
  BackButton?: TelegramBackButton
  HapticFeedback?: TelegramHapticFeedback
  ready?: () => void
  expand?: () => void
  close?: () => void
  isVersionAtLeast?: (version: string) => boolean
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  enableClosingConfirmation?: () => void
  disableClosingConfirmation?: () => void
  isVerticalSwipesEnabled?: boolean
  enableVerticalSwipes?: () => void
  disableVerticalSwipes?: () => void
  /** Bot API 6.9+ — native share-phone popup. */
  requestContact?: (callback: (shared: boolean) => void) => void
  onEvent?: (eventType: string, eventHandler: (...args: unknown[]) => void) => void
  offEvent?: (eventType: string, eventHandler: (...args: unknown[]) => void) => void
}

/** True when WebApp reports Bot API >= required (no-op / false if helper missing). */
export function telegramSupportsVersion(webApp: TelegramWebApp | undefined, version: string): boolean {
  return Boolean(webApp?.isVersionAtLeast?.(version))
}

export interface TelegramContext {
  isTelegram: boolean
  initData?: string
  user?: TelegramWebAppUser
  chatId?: string
  botKind?: "customer" | "provider"
  webApp?: TelegramWebApp
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp
    }
  }
}

export function getTelegramContext(): TelegramContext {
  if (typeof window === "undefined") {
    return { isTelegram: false }
  }

  const webApp = window.Telegram?.WebApp
  const user = webApp?.initDataUnsafe?.user
  const chatId = user?.id ? String(user.id) : undefined

  return {
    isTelegram: Boolean(webApp?.initData),
    initData: webApp?.initData,
    user,
    chatId,
    botKind: resolveTelegramBotKind() ?? undefined,
    webApp,
  }
}

/** Resolve which Telegram bot opened the Mini App (hint only; backend verifies signature). */
export function resolveTelegramBotKind(): "customer" | "provider" | null {
  if (typeof window === "undefined") return null

  const queryBot = new URLSearchParams(window.location.search).get("tgBot")?.trim().toLowerCase()
  if (queryBot === "customer" || queryBot === "client") return "customer"
  if (queryBot === "provider" || queryBot === "partner") return "provider"

  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param?.trim().toLowerCase()
  if (startParam === "customer" || startParam === "client") return "customer"
  if (startParam === "provider" || startParam === "partner") return "provider"

  const queryRole = new URLSearchParams(window.location.search).get("role")?.trim().toLowerCase()
  if (queryRole === "customer" || queryRole === "provider") return queryRole

  return null
}

/** Map Telegram start_param or URL ?role= / ?tgBot= to onboarding role (customer|provider). */
export function resolveEntryRole(): "customer" | "provider" | null {
  if (typeof window === "undefined") return null

  const botKind = resolveTelegramBotKind()
  if (botKind) return botKind

  const queryRole = new URLSearchParams(window.location.search).get("role")
  if (queryRole === "customer" || queryRole === "provider") return queryRole

  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param?.trim().toLowerCase()
  if (!startParam) return null
  if (startParam === "customer" || startParam === "client") return "customer"
  if (startParam === "provider" || startParam === "partner") return "provider"
  return null
}

const THEME_PARAM_MAP: Record<string, string> = {
  bg_color: "--tg-theme-bg-color",
  text_color: "--tg-theme-text-color",
  hint_color: "--tg-theme-hint-color",
  link_color: "--tg-theme-link-color",
  button_color: "--tg-theme-button-color",
  button_text_color: "--tg-theme-button-text-color",
  secondary_bg_color: "--tg-theme-secondary-bg-color",
  header_bg_color: "--tg-theme-header-bg-color",
  accent_text_color: "--tg-theme-accent-text-color",
  section_bg_color: "--tg-theme-section-bg-color",
  section_header_text_color: "--tg-theme-section-header-text-color",
  subtitle_text_color: "--tg-theme-subtitle-text-color",
  destructive_text_color: "--tg-theme-destructive-text-color",
}

const DEFAULT_THEME: Record<string, string> = {
  "--tg-theme-bg-color": "#F6F7F8",
  "--tg-theme-text-color": "#111315",
  "--tg-theme-hint-color": "#6B7280",
  "--tg-theme-link-color": "#2F80ED",
  "--tg-theme-button-color": "#16A36A",
  "--tg-theme-button-text-color": "#FFFFFF",
  "--tg-theme-secondary-bg-color": "#FFFFFF",
  "--tg-theme-header-bg-color": "#FFFFFF",
  "--tg-theme-accent-text-color": "#16A36A",
  "--tg-theme-section-bg-color": "#FFFFFF",
  "--tg-theme-section-header-text-color": "#111315",
  "--tg-theme-subtitle-text-color": "#6B7280",
  "--tg-theme-destructive-text-color": "#EF4444",
}

function setInsetCssVar(root: HTMLElement, name: string, value: number | undefined) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    root.style.setProperty(name, `${value}px`)
  }
}

/**
 * Keep app shell height aligned with the *visible* viewport (Telegram WebApp
 * stable height, or browser visualViewport). Prevents bottom-sheet clipping
 * under mobile browser chrome / Telegram UI.
 */
export function syncAppViewportHeight(webApp?: TelegramWebApp) {
  if (typeof document === "undefined" || typeof window === "undefined") return

  const root = document.documentElement
  const tgStableHeight = webApp?.viewportStableHeight
  const visualHeight = window.visualViewport?.height
  const innerHeight = window.innerHeight

  /* Check if virtual keyboard is likely open (visual viewport shrunk or focused input) */
  const activeElement = document.activeElement
  const isInputFocused =
    Boolean(activeElement) &&
    (activeElement?.tagName === "INPUT" ||
      activeElement?.tagName === "TEXTAREA" ||
      (activeElement as HTMLElement)?.isContentEditable)
  const isKeyboardOpen =
    isInputFocused || (typeof visualHeight === "number" && visualHeight > 0 && visualHeight < innerHeight * 0.82)

  let stableHeight: number
  if (typeof tgStableHeight === "number" && Number.isFinite(tgStableHeight) && tgStableHeight > 0) {
    stableHeight = tgStableHeight
  } else if (isKeyboardOpen) {
    /* Keep existing stable height or fallback to innerHeight when typing */
    const existing = parseFloat(root.style.getPropertyValue("--tg-viewport-stable-height"))
    stableHeight = Number.isFinite(existing) && existing > 0 ? existing : innerHeight
  } else {
    const candidates = [visualHeight, innerHeight].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
    )
    stableHeight = candidates.length > 0 ? Math.round(Math.min(...candidates)) : innerHeight
  }

  root.style.setProperty("--tg-viewport-stable-height", `${stableHeight}px`)

  if (typeof visualHeight === "number" && Number.isFinite(visualHeight) && visualHeight > 0) {
    root.style.setProperty("--tg-viewport-visible-height", `${Math.round(visualHeight)}px`)
  }

  const safe = webApp?.safeAreaInset
  setInsetCssVar(root, "--tg-safe-area-inset-top", safe?.top)
  setInsetCssVar(root, "--tg-safe-area-inset-right", safe?.right)
  setInsetCssVar(root, "--tg-safe-area-inset-bottom", safe?.bottom)
  setInsetCssVar(root, "--tg-safe-area-inset-left", safe?.left)

  const content = webApp?.contentSafeAreaInset
  setInsetCssVar(root, "--tg-content-safe-area-inset-top", content?.top)
  setInsetCssVar(root, "--tg-content-safe-area-inset-right", content?.right)
  setInsetCssVar(root, "--tg-content-safe-area-inset-bottom", content?.bottom)
  setInsetCssVar(root, "--tg-content-safe-area-inset-left", content?.left)
}

export function applyTelegramTheme(webApp?: TelegramWebApp) {
  if (typeof document === "undefined") return

  const root = document.documentElement
  const params = webApp?.themeParams ?? {}
  const usesPomichTheme = Boolean(root.dataset.pomichTheme)

  if (usesPomichTheme) {
    for (const cssVar of Object.values(THEME_PARAM_MAP)) {
      root.style.removeProperty(cssVar)
    }
  } else {
    for (const [key, cssVar] of Object.entries(THEME_PARAM_MAP)) {
      const value = params[key as keyof TelegramThemeParams]
      if (value) root.style.setProperty(cssVar, value)
    }

    for (const [cssVar, fallback] of Object.entries(DEFAULT_THEME)) {
      if (!root.style.getPropertyValue(cssVar)) root.style.setProperty(cssVar, fallback)
    }
  }

  syncAppViewportHeight(webApp)

  if (usesPomichTheme) {
    return
  }

  // setHeaderColor / setBackgroundColor: Bot API 6.1+
  if (!telegramSupportsVersion(webApp, "6.1")) return

  const headerColor = params.header_bg_color ?? params.bg_color
  const backgroundColor = params.bg_color
  if (headerColor) webApp?.setHeaderColor?.(headerColor)
  if (backgroundColor) webApp?.setBackgroundColor?.(backgroundColor)
}

/** Allow finger scroll inside the Mini App (Bot API 7.7+). */
export function enableTelegramPageScroll(webApp?: TelegramWebApp) {
  if (!telegramSupportsVersion(webApp, "7.7")) return
  webApp?.disableVerticalSwipes?.()
}

export function initTelegramApp(): TelegramContext {
  const ctx = getTelegramContext()
  if (ctx.isTelegram && ctx.webApp) {
    ctx.webApp.ready?.()
    ctx.webApp.expand?.()
    enableTelegramPageScroll(ctx.webApp)
    applyTelegramTheme(ctx.webApp)
  }
  return ctx
}

export function telegramHaptic(
  webApp?: TelegramWebApp,
  kind: "light" | "medium" | "heavy" | "selection" | "success" | "error" | "warning" = "light",
) {
  const haptic = webApp?.HapticFeedback
  if (!haptic) return
  if (kind === "selection") {
    haptic.selectionChanged?.()
    return
  }
  if (kind === "success" || kind === "error" || kind === "warning") {
    haptic.notificationOccurred?.(kind)
    return
  }
  haptic.impactOccurred?.(kind)
}

interface TelegramContactRequestedEvent {
  responseUnsafe?: {
    contact?: TelegramContact
  }
  contact?: TelegramContact
}

/** One-tap phone share via Telegram native dialog (Bot API 6.9+). */
export function requestTelegramContact(webApp?: TelegramWebApp): Promise<TelegramContact | null> {
  if (typeof window === "undefined" || !webApp?.requestContact || !telegramSupportsVersion(webApp, "6.9")) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (contact: TelegramContact | null) => {
      if (settled) return
      settled = true
      webApp.offEvent?.("contactRequested", onContactRequested)
      resolve(contact)
    }

    const onContactRequested = (payload: unknown) => {
      const event = payload as TelegramContactRequestedEvent
      const contact = event?.responseUnsafe?.contact ?? event?.contact
      finish(contact?.phone_number ? contact : null)
    }

    webApp.onEvent?.("contactRequested", onContactRequested)
    webApp.requestContact?.((shared) => {
      if (!shared) finish(null)
    })

    window.setTimeout(() => finish(null), 120_000)
  })
}
