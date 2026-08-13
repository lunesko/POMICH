import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enableTelegramPageScroll, initTelegramApp, syncAppViewportHeight } from '../telegram'

describe('Telegram WebApp scroll init', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as Window & { Telegram?: unknown }).Telegram
    document.documentElement.style.removeProperty('--tg-viewport-stable-height')
    document.documentElement.style.removeProperty('--tg-content-safe-area-inset-top')
    document.documentElement.style.removeProperty('--tg-content-safe-area-inset-bottom')
  })

  it('calls disableVerticalSwipes during initTelegramApp when Bot API >= 7.7', () => {
    const disableVerticalSwipes = vi.fn()
    window.Telegram = {
      WebApp: {
        initData: 'telegram-init-data-stub',
        ready: vi.fn(),
        expand: vi.fn(),
        isVersionAtLeast: () => true,
        disableVerticalSwipes,
      },
    }

    initTelegramApp()

    expect(disableVerticalSwipes).toHaveBeenCalledTimes(1)
  })

  it('skips disableVerticalSwipes on Bot API 6.0', () => {
    const disableVerticalSwipes = vi.fn()
    expect(() =>
      enableTelegramPageScroll({
        isVersionAtLeast: () => false,
        disableVerticalSwipes,
      }),
    ).not.toThrow()
    expect(disableVerticalSwipes).not.toHaveBeenCalled()
  })

  it('enableTelegramPageScroll is safe when API is missing', () => {
    expect(() => enableTelegramPageScroll(undefined)).not.toThrow()
    expect(() => enableTelegramPageScroll({})).not.toThrow()
  })

  it('does nothing outside Telegram', () => {
    const ready = vi.fn()
    window.Telegram = { WebApp: { ready } }

    const ctx = initTelegramApp()

    expect(ctx.isTelegram).toBe(false)
    expect(ready).not.toHaveBeenCalled()
  })

  it('syncAppViewportHeight prefers the smallest visible height', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 720 },
    })

    syncAppViewportHeight({ viewportStableHeight: 780, viewportHeight: 800 })

    expect(document.documentElement.style.getPropertyValue('--tg-viewport-stable-height')).toBe('720px')
  })

  it('syncAppViewportHeight writes Telegram content safe-area insets', () => {
    syncAppViewportHeight({
      viewportStableHeight: 640,
      contentSafeAreaInset: { top: 12, bottom: 8, left: 0, right: 0 },
    })

    expect(document.documentElement.style.getPropertyValue('--tg-content-safe-area-inset-top')).toBe('12px')
    expect(document.documentElement.style.getPropertyValue('--tg-content-safe-area-inset-bottom')).toBe('8px')
  })
})
