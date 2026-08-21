import { useEffect, useRef } from "react"

type WakeLockSentinelLike = {
  released: boolean
  release: () => Promise<void>
  addEventListener?: (type: "release", listener: () => void) => void
  removeEventListener?: (type: "release", listener: () => void) => void
}

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>
  }
}

/**
 * Keeps the device screen awake while `enabled` is true (partner on duty in WebApp).
 * Re-acquires the lock after tab visibility returns (browsers release it when hidden).
 */
export function useScreenWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null)

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") return

    const nav = navigator as WakeLockNavigator
    if (!nav.wakeLock?.request) return

    let cancelled = false

    const release = async () => {
      const sentinel = sentinelRef.current
      sentinelRef.current = null
      if (!sentinel || sentinel.released) return
      try {
        await sentinel.release()
      } catch {
        /* ignore */
      }
    }

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return
      try {
        await release()
        const sentinel = await nav.wakeLock!.request("screen")
        if (cancelled) {
          await sentinel.release().catch(() => undefined)
          return
        }
        sentinelRef.current = sentinel
        sentinel.addEventListener?.("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null
        })
      } catch {
        /* Wake Lock may be denied or unsupported in some WebViews */
      }
    }

    void acquire()

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      void release()
    }
  }, [enabled])
}
