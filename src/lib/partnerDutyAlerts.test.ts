import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

import { diffNewIds, ensurePartnerAlertPermission, showPartnerDutyNotification } from "./partnerDutyAlerts"

describe("diffNewIds", () => {
  it("returns only ids not seen before", () => {
    expect(diffNewIds(new Set(["a"]), ["a", "b", "c"])).toEqual(["b", "c"])
  })
})

describe("partner notification helpers", () => {
  const originalNotification = globalThis.Notification

  beforeEach(() => {
    vi.stubGlobal(
      "Notification",
      class MockNotification {
        static permission: NotificationPermission = "default"
        static requestPermission = vi.fn(async () => {
          MockNotification.permission = "granted"
          return "granted" as NotificationPermission
        })
        onclick: ((this: Notification, ev: Event) => void) | null = null
        constructor(
          public title: string,
          public options?: NotificationOptions,
        ) {}
        close = vi.fn()
      },
    )
  })

  afterEach(() => {
    if (originalNotification) {
      vi.stubGlobal("Notification", originalNotification)
    } else {
      // @ts-expect-error cleanup
      delete globalThis.Notification
    }
  })

  it("requests notification permission when default", async () => {
    const permission = await ensurePartnerAlertPermission()
    expect(permission).toBe("granted")
    expect(Notification.requestPermission).toHaveBeenCalled()
  })

  it("shows notification when permission granted", () => {
    ;(Notification as unknown as { permission: NotificationPermission }).permission = "granted"
    expect(showPartnerDutyNotification("t", "b", "tag-1")).toBe(true)
  })
})
