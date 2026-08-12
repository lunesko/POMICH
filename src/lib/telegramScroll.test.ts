import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enableTelegramPageScroll, initTelegramApp } from '../telegram'

describe('Telegram WebApp scroll init', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as Window & { Telegram?: unknown }).Telegram
  })

  it('calls disableVerticalSwipes during initTelegramApp', () => {
    const disableVerticalSwipes = vi.fn()
    window.Telegram = {
      WebApp: {
        initData: 'telegram-init-data-stub',
        ready: vi.fn(),
        expand: vi.fn(),
        disableVerticalSwipes,
      },
    }

    initTelegramApp()

    expect(disableVerticalSwipes).toHaveBeenCalledTimes(1)
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
})
