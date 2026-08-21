import { useEffect, useRef } from "react"

type WakeLockSentinelLike = {
  released: boolean
  release: () => Promise<void>
  addEventListener?: (type: "release", listener: () => void) => void
}

/**
 * Keep the screen awake while `enabled` (partner on duty in Telegram / mobile WebApp).
 * Re-acquires after visibility returns — OS releases the lock when the screen turns off.
 */
export function useScreenWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null)

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") return
    const wakeLockApi = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock
    if (!wakeLockApi?.request) return

    let cancelled = false

    const release = async () => {
      const current = sentinelRef.current
      sentinelRef.current = null
      if (!current || current.released) return
      try {
        await current.release()
      } catch {
        // ignore
      }
    }

    const request = async () => {
      if (cancelled || document.visibilityState !== "visible") return
      try {
        await release()
        if (cancelled || document.visibilityState !== "visible") return
        const sentinel = await wakeLockApi.request("screen")
        if (cancelled) {
          await sentinel.release().catch(() => undefined)
          return
        }
        sentinelRef.current = sentinel
        sentinel.addEventListener?.("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null
        })
      } catch {
        // Permission denied / unsupported context — fall back to Telegram bot alerts.
      }
    }

    void request()

    const onVisibility = () => {
      if (document.visibilityState === "visible") void request()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      void release()
    }
  }, [enabled])
}
