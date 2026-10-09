import { restoreBrowserSession, type AuthSession } from "../api/client"
import { authSessionStorageKey, isExplicitLogout, storeAuthSession } from "./auth"

type Principal = { role: "customer" | "provider"; sub: string; exp: number }
const pending = new Map<string, Promise<AuthSession | undefined>>()
const renewed = new Map<string, AuthSession>()

function principal(token: string): Principal | undefined {
  if (!token.startsWith("pomich_auth_v1.")) return undefined
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const body = JSON.parse(atob(encoded + "=".repeat((4 - encoded.length % 4) % 4)))
    if ((body.role === "customer" || body.role === "provider") && typeof body.sub === "string" && typeof body.exp === "number") return body
  } catch { /* Server remains responsible for signature validation. */ }
  return undefined
}

/** Refresh before sending a request, including polling and heartbeat, without replaying mutations. */
export async function refreshBrowserAuthorization(source?: HeadersInit): Promise<HeadersInit | undefined> {
  if (!source) return undefined
  const headers = new Headers(source)
  const token = headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || ""
  const body = principal(token)
  if (!body || body.exp > Date.now() / 1000 + 30 || isExplicitLogout()) return source
  let session = renewed.get(token)
  if (!session || session.expiresAt <= Date.now() / 1000 + 30) {
    let request = pending.get(token)
    if (!request) {
      request = restoreBrowserSession(body.role)
      pending.set(token, request)
    }
    try { session = await request } finally { pending.delete(token) }
  }
  if (!session || isExplicitLogout()) return source
  // Another tab may have logged in as someone else. Never apply its bearer to this identity's URLs.
  if (session.role !== body.role || session.subjectId !== body.sub) throw new Error("Акаунт змінився. Оновіть сторінку та увійдіть знову.")
  if (renewed.size > 32) renewed.clear()
  renewed.set(token, session)
  storeAuthSession(authSessionStorageKey(body.role, body.sub), session)
  headers.set("Authorization", `Bearer ${session.accessToken}`)
  return headers
}
