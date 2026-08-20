import { describe, expect, it } from "vitest"

import {
  isPartnerProfileComplete,
  isPartnerProfileFieldsComplete,
  isPartnerProfileIncomplete,
} from "./partnerProfileComplete"

const complete = {
  name: "Олександр",
  phone: "+380671112233",
  vehicle: "Volkswagen Transporter",
  plate: "AO 1248 CH",
  specialties: ["tow"],
  registeredAt: "2026-01-01T00:00:00Z",
}

describe("partnerProfileComplete", () => {
  it("requires name phone vehicle valid plate and specialties", () => {
    expect(isPartnerProfileFieldsComplete(complete)).toBe(true)
    expect(isPartnerProfileIncomplete(complete)).toBe(false)
    expect(isPartnerProfileFieldsComplete({ ...complete, plate: "" })).toBe(false)
    expect(isPartnerProfileFieldsComplete({ ...complete, plate: "BX" })).toBe(false)
    expect(isPartnerProfileFieldsComplete({ ...complete, specialties: [] })).toBe(false)
    expect(isPartnerProfileFieldsComplete({ ...complete, name: "Партнер POMICH" })).toBe(false)
  })

  it("requires registeredAt unless treatAsRegistered", () => {
    const withoutReg = { ...complete, registeredAt: undefined }
    expect(isPartnerProfileComplete(withoutReg)).toBe(false)
    expect(isPartnerProfileComplete(withoutReg, { treatAsRegistered: true })).toBe(true)
    expect(isPartnerProfileComplete(complete)).toBe(true)
  })
})
