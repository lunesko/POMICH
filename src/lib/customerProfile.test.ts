import { describe, expect, it } from "vitest"

import type { CustomerProfile } from "../api/client"

import {
  DEFAULT_CUSTOMER_NAME,
  getProfileChecklist,
  mergeCustomerProfiles,
  profileChecklistItemStatus,
  profileChecklistSummary,
} from "./customerProfile"

const baseProfile: CustomerProfile = {
  id: "tg-829741830",
  name: "Vitaliy",
  phone: "+380661007434",
  verificationStatus: "unverified",
}

describe("customerProfile checklist", () => {
  it("requires only name, phone, and verification for clients", () => {
    const checklist = getProfileChecklist(baseProfile)
    expect(checklist.map((item) => item.key)).toEqual(["name", "phone", "verification"])
    expect(checklist.every((item) => item.required || item.key === "verification")).toBe(true)
    expect(checklist.find((item) => item.key === "email")).toBeUndefined()
    expect(checklist.find((item) => item.key === "telegram")).toBeUndefined()
  })

  it("labels optional rows separately from required gaps", () => {
    expect(profileChecklistItemStatus({ key: "name", label: "Ім'я", filled: true, required: true })).toBe("✓ Заповнено")
    expect(profileChecklistItemStatus({ key: "phone", label: "Телефон", filled: false, required: true })).toBe("— Потрібно")
    expect(profileChecklistItemStatus({ key: "email", label: "Email", filled: false, required: false })).toBe("— Необов'язково")
  })

  it("summarizes only required fields", () => {
    expect(profileChecklistSummary(baseProfile)).toBe("2 з 3 обов'язкових полів заповнено")
  })

  it("hides verification row when profile is already verified", () => {
    const verified = { ...baseProfile, verificationStatus: "verified" as const }
    expect(getProfileChecklist(verified).map((item) => item.key)).toEqual(["name", "phone"])
    expect(profileChecklistSummary(verified)).toBe("2 з 2 обов'язкових полів заповнено")
  })
})

describe("mergeCustomerProfiles", () => {
  it("keeps valid in-progress phone when incoming profile omits it", () => {
    const current: CustomerProfile = { ...baseProfile, phone: "+380661007434" }
    const incoming: CustomerProfile = { ...baseProfile, phone: "", name: "Vitaliy" }
    expect(mergeCustomerProfiles(current, incoming).phone).toBe("+380661007434")
  })

  it("prefers incoming phone when it is valid", () => {
    const current: CustomerProfile = { ...baseProfile, phone: "+380661007434" }
    const incoming: CustomerProfile = { ...baseProfile, phone: "+380671112233" }
    expect(mergeCustomerProfiles(current, incoming).phone).toBe("+380671112233")
  })

  it("keeps typed name when incoming profile resets to default", () => {
    const current: CustomerProfile = { ...baseProfile, name: "Vitaliy" }
    const incoming: CustomerProfile = { ...baseProfile, name: DEFAULT_CUSTOMER_NAME }
    expect(mergeCustomerProfiles(current, incoming).name).toBe("Vitaliy")
  })

  it("preserves verified status when merging sessions", () => {
    const guest: CustomerProfile = { ...baseProfile, id: "guest-web", verificationStatus: "unverified" }
    const telegram: CustomerProfile = { ...baseProfile, id: "tg-829741830", verificationStatus: "verified" }
    expect(mergeCustomerProfiles(guest, telegram).verificationStatus).toBe("verified")
    expect(mergeCustomerProfiles(telegram, guest).verificationStatus).toBe("verified")
  })

  it("keeps geocoded city when incoming profile still has stale Kyiv default", () => {
    const current: CustomerProfile = { ...baseProfile, city: "Ужгород" }
    const incoming: CustomerProfile = { ...baseProfile, city: "Київ" }
    expect(mergeCustomerProfiles(current, incoming).city).toBe("Ужгород")
  })
})
