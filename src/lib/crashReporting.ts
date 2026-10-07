/** Anonymous crash counters. Error messages, stacks, URLs and account data stay local. */
export type CrashCategory = 'render_error' | 'chunk_error' | 'js_error' | 'unhandled_rejection'
let sent = 0

export function reportCrash(category: CrashCategory): void {
  if (!import.meta.env.PROD || sent >= 5) return
  sent += 1
  try {
    const body = JSON.stringify({ category })
    if (navigator.sendBeacon?.('/api/telemetry/crashes', new Blob([body], { type: 'application/json' }))) return
    void fetch('/api/telemetry/crashes', {
      method: 'POST', body, headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', keepalive: true,
    }).catch(() => undefined)
  } catch {
    // Reporting must never trigger an additional crash.
  }
}

export function startCrashReporting(): () => void {
  const error = () => reportCrash('js_error')
  const rejection = () => reportCrash('unhandled_rejection')
  window.addEventListener('error', error)
  window.addEventListener('unhandledrejection', rejection)
  return () => {
    window.removeEventListener('error', error)
    window.removeEventListener('unhandledrejection', rejection)
  }
}
