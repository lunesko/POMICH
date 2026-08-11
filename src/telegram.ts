export interface TelegramWebAppUser {
  id?: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TelegramWebApp {
  initData?: string
  initDataUnsafe?: {
    user?: TelegramWebAppUser
  }
  ready?: () => void
  expand?: () => void
}

export interface TelegramContext {
  isTelegram: boolean
  initData?: string
  user?: TelegramWebAppUser
  chatId?: string
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
    isTelegram: Boolean(webApp),
    initData: webApp?.initData,
    user,
    chatId,
    webApp,
  }
}
