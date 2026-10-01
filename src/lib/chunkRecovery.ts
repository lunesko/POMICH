/** Shared helpers for recovering from stale Vite chunk loads after deploy. */

export const CHUNK_RELOAD_KEY = "pomich-chunk-reload"
export const SW_GENERATION = "45"

export function isChunkLoadError(error: Error | null | undefined): boolean {
  if (!error) return false
  const text = `${error.name} ${error.message}`
  return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError|Importing a module script failed|error loading dynamically imported module/i.test(
    text,
  )
}

export async function clearClientCaches(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch {
    // ignore
  }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations()
    if (regs) {
      await Promise.all(regs.map((reg) => reg.unregister()))
    }
  } catch {
    // ignore
  }
}

/** Hard navigation that Telegram WebView cannot no-op as easily as location.reload(). */
export function hardBootNavigate(): void {
  if (typeof window === "undefined") return
  const next = `${window.location.origin}/?_pomich=${Date.now()}&_clear=1`
  try {
    window.location.replace(next)
  } catch {
    window.location.href = next
  }
}

/** Clear caches and reload once per session for chunk failures. */
export function recoverFromChunkError(error: Error): boolean {
  if (typeof window === "undefined" || !isChunkLoadError(error)) return false
  if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1") return false
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
  void clearClientCaches().finally(() => {
    hardBootNavigate()
  })
  return true
}

export function resetChunkReloadGuard(): void {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(CHUNK_RELOAD_KEY)
}
