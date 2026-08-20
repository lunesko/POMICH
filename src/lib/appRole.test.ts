import { beforeEach, describe, expect, it } from "vitest"

import {
  clearActiveAppRole,
  clearPendingPartnerReview,
  persistActiveAppRole,
  persistPendingPartnerReview,
  readActiveAppRole,
  readPendingPartnerReview,
} from "./appRole"

describe("appRole persistence", () => {
  beforeEach(() => {
    clearActiveAppRole()
    clearPendingPartnerReview()
  })

  it("persists and reads active app role", () => {
    expect(readActiveAppRole()).toBeNull()
    persistActiveAppRole("provider")
    expect(readActiveAppRole()).toBe("provider")
    clearActiveAppRole()
    expect(readActiveAppRole()).toBeNull()
  })

  it("persists pending partner review order id", () => {
    persistPendingPartnerReview("PM-123")
    expect(readPendingPartnerReview()?.orderId).toBe("PM-123")
    clearPendingPartnerReview()
    expect(readPendingPartnerReview()).toBeUndefined()
  })
})
