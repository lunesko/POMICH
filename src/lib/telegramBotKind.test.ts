import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { resolveEntryRole, resolveEntryScreen, resolveTelegramBotKind, getTelegramContext } from "../telegram"

describe("telegram two-bot hints", () => {
  const originalLocation = window.location
  const originalTelegram = window.Telegram

  beforeEach(() => {
    // @ts-expect-error test override
    delete window.location
    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/")
    window.Telegram = undefined
  })

  afterEach(() => {
    // @ts-expect-error restore
    window.location = originalLocation
    window.Telegram = originalTelegram
  })

  it("resolves botKind from tgBot query", () => {
    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/?role=provider&tgBot=customer")
    expect(resolveTelegramBotKind()).toBe("customer")
    expect(resolveEntryRole()).toBe("customer")
  })

  it("falls back from start_param then role", () => {
    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/")
    window.Telegram = {
      WebApp: {
        initData: "x",
        initDataUnsafe: { start_param: "partner", user: { id: 1 } },
      },
    }
    expect(resolveTelegramBotKind()).toBe("provider")
    expect(getTelegramContext().botKind).toBe("provider")
  })

  it("uses role when tgBot/start_param missing", () => {
    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/?role=provider")
    expect(resolveTelegramBotKind()).toBe("provider")
  })

  it("resolves Mini App screen from ?screen= deep links", () => {
    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/?role=provider&tgBot=provider&screen=duty")
    expect(resolveEntryScreen()).toBe("duty")

    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/?role=provider&screen=cabinet")
    expect(resolveEntryScreen()).toBe("cabinet")

    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/?role=customer&screen=history")
    expect(resolveEntryScreen()).toBe("history")

    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/?role=customer&screen=order")
    expect(resolveEntryScreen()).toBe("order")
  })

  it("resolves screen aliases from start_param", () => {
    // @ts-expect-error test override
    window.location = new URL("https://pomich.help/")
    window.Telegram = {
      WebApp: {
        initData: "x",
        initDataUnsafe: { start_param: "partner_online", user: { id: 1 } },
      },
    }
    expect(resolveEntryScreen()).toBe("duty")
  })
})
