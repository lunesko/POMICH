import { afterEach, describe, expect, it } from "vitest"

import { sanitizePublicAppUrl } from "./telegram"

describe("sanitizePublicAppUrl", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/")
  })

  it("strips customer/provider deep-link query noise", () => {
    window.history.pushState({}, "", "/?role=customer&screen=cabinet&tgBot=customer&logged_out=1")
    sanitizePublicAppUrl({ preserveAdminRole: true })
    expect(window.location.pathname).toBe("/")
    expect(window.location.search).toBe("")
  })

  it("keeps hidden admin role when requested", () => {
    window.history.pushState({}, "", "/?role=admin&screen=duty")
    sanitizePublicAppUrl({ preserveAdminRole: true })
    expect(window.location.search).toBe("?role=admin")
  })

  it("can strip admin role when preserveAdminRole is false", () => {
    window.history.pushState({}, "", "/?role=admin")
    sanitizePublicAppUrl({ preserveAdminRole: false })
    expect(window.location.search).toBe("")
  })
})
