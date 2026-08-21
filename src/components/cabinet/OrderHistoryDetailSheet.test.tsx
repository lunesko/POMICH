import { describe, expect, it } from "vitest"

import { formatOrderDuration } from "./OrderHistoryDetailSheet"

describe("formatOrderDuration", () => {
  it("formats minutes between accepted and completed", () => {
    expect(
      formatOrderDuration({
        acceptedAt: "2026-08-21T10:00:00.000Z",
        statusHistory: [{ status: "completed", at: "2026-08-21T10:42:00.000Z" }],
        status: "completed",
      }),
    ).toBe("42 хв")
  })

  it("formats hours when longer than an hour", () => {
    expect(
      formatOrderDuration({
        createdAt: "2026-08-21T10:00:00.000Z",
        cancelledAt: "2026-08-21T12:15:00.000Z",
        status: "cancelled",
      }),
    ).toBe("2 год 15 хв")
  })

  it("returns undefined without usable timestamps", () => {
    expect(formatOrderDuration({ status: "completed" })).toBeUndefined()
  })
})
