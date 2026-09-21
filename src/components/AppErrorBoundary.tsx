import { Component, type ErrorInfo, type ReactNode } from "react"

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

const CHUNK_RELOAD_KEY = "pomich-chunk-reload"

function isChunkLoadError(error: Error | null | undefined): boolean {
  if (!error) return false
  const text = `${error.name} ${error.message}`
  return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError|Importing a module script failed|error loading dynamically imported module/i.test(
    text,
  )
}

async function clearClientCaches(): Promise<void> {
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

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[POMICH] render crash", error, info.componentStack)

    // After deploy, Safari may keep an old index that imports deleted Vite chunks.
    if (typeof window === "undefined" || !isChunkLoadError(error)) return
    if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1") return
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
    void clearClientCaches().finally(() => {
      window.location.reload()
    })
  }

  private retry = () => {
    this.setState({ error: null })
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      void clearClientCaches().finally(() => window.location.reload())
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="pomich-app-fallback">
          <div className="pomich-app-fallback__card">
            <div className="pomich-app-fallback__title">Не вдалося завантажити POMICH</div>
            <p style={{ margin: "12px 0 0", color: "var(--pomich-muted)", fontWeight: 600, lineHeight: 1.45 }}>
              Часто це старий кеш після оновлення. Натисніть «Оновити» — ми очистимо кеш і перезавантажимо сторінку.
            </p>
            <div className="pomich-app-fallback__actions">
              <button type="button" className="pomich-primary-btn" onClick={this.retry}>
                Оновити
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
