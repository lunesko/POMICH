import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { resolveEntryRole, resolveTelegramBotKind, getTelegramContext } from "../telegram"

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
})
