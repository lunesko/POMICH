import { afterEach, describe, expect, it, vi } from "vitest"
import { refreshBrowserAuthorization } from "./browserAuthorization"

function token(sub: string, exp: number) {
  return `pomich_auth_v1.${btoa(JSON.stringify({ role: "customer", sub, exp }))}.sig`
}
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear() })

describe("remembered browser authorization", () => {
  it("refreshes concurrent protected requests once, preserving the account", async () => {
    const expired = token("remembered-user", 1)
    const next = token("remembered-user", Date.now() / 1000 + 3600)
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ role: "customer", subjectId: "remembered-user", accessToken: next, expiresAt: Date.now() / 1000 + 3600 }) }))
    vi.stubGlobal("fetch", fetch)
    const results = await Promise.all([refreshBrowserAuthorization({ Authorization: `Bearer ${expired}` }), refreshBrowserAuthorization({ Authorization: `Bearer ${expired}` })])
    expect(fetch).toHaveBeenCalledTimes(1)
    for (const headers of results) expect(new Headers(headers).get("Authorization")).toBe(`Bearer ${next}`)
    expect(window.sessionStorage.getItem("pomichAuthSession:customer:remembered-user")).not.toContain(next)
  })

  it("does not replace an old request identity with a different cookie account", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ role: "customer", subjectId: "different-user", accessToken: token("different-user", Date.now() / 1000 + 3600), expiresAt: Date.now() / 1000 + 3600 }) })))
    await expect(refreshBrowserAuthorization({ Authorization: `Bearer ${token("original-user", 1)}` })).rejects.toThrow("Акаунт змінився")
  })

  it("does not restore after explicit logout", async () => {
    window.localStorage.setItem("pomichExplicitLogout", "web")
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    await refreshBrowserAuthorization({ Authorization: `Bearer ${token("logged-out-user", 1)}` })
    expect(fetch).not.toHaveBeenCalled()
  })
})
