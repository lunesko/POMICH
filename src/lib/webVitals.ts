import { onCLS, onINP, onLCP, type Metric } from 'web-vitals'

type VitalName = 'CLS' | 'INP' | 'LCP'
type VitalSample = { name: VitalName; value: number }

const pending = new Map<VitalName, VitalSample>()

function pageGroup(): 'landing' | 'customer' | 'provider' | 'admin' {
  const currentRole = document.documentElement.dataset.pomichView
  if (currentRole === 'customer' || currentRole === 'provider' || currentRole === 'admin') return currentRole
  const path = window.location.pathname
  if (path.startsWith('/admin')) return 'admin'
  if (path.startsWith('/partner') || path.startsWith('/provider')) return 'provider'
  if (path.startsWith('/app') || path.startsWith('/customer')) return 'customer'
  return 'landing'
}

function queueMetric(metric: Metric) {
  if (metric.name !== 'CLS' && metric.name !== 'INP' && metric.name !== 'LCP') return
  if (!Number.isFinite(metric.value) || metric.value < 0) return
  pending.set(metric.name, { name: metric.name, value: metric.value })
}

function flush() {
  if (!pending.size) return
  const metrics = Array.from(pending.values())
  pending.clear()
  const body = JSON.stringify({
    page: pageGroup(),
    viewport: window.innerWidth < 768 ? 'mobile' : 'desktop',
    metrics,
  })
  if (navigator.sendBeacon?.('/api/telemetry/web-vitals', new Blob([body], { type: 'application/json' }))) return
  void fetch('/api/telemetry/web-vitals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

/** Field measurements only; never send URLs, user identifiers, or interaction targets. */
export function startWebVitals() {
  onCLS(queueMetric)
  onINP(queueMetric)
  onLCP(queueMetric)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
}
