import { Component, type ErrorInfo, type ReactNode } from "react"

import {
  clearClientCaches,
  isChunkLoadError,
  recoverFromChunkError,
  resetChunkReloadGuard,
} from "../../lib/chunkRecovery"

interface FlowChunkBoundaryProps {
  children: ReactNode
}

interface FlowChunkBoundaryState {
  error: Error | null
}

/**
 * Catches lazy-route chunk failures (Кабінет / flows) without killing the whole app shell.
 * Auto-recovers once from stale Vite hashes after deploy.
 */
export default class FlowChunkBoundary extends Component<FlowChunkBoundaryProps, FlowChunkBoundaryState> {
  state: FlowChunkBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): FlowChunkBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[POMICH] flow chunk crash", error, info.componentStack)
    recoverFromChunkError(error)
  }

  private retry = () => {
    this.setState({ error: null })
    resetChunkReloadGuard()
    void clearClientCaches().finally(() => window.location.reload())
  }

  render() {
    if (!this.state.error) return this.props.children

    const chunk = isChunkLoadError(this.state.error)
    return (
      <div
        className="pomich-app-fallback"
        style={{
          minHeight: "40dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div className="pomich-app-fallback__card" style={{ maxWidth: 380, width: "100%" }}>
          <div className="pomich-app-fallback__title" style={{ fontSize: "1.05rem" }}>
            {chunk ? "Оновлюємо інтерфейс…" : "Не вдалося відкрити екран"}
          </div>
          <p style={{ margin: "10px 0 0", color: "var(--pomich-muted)", fontWeight: 600, lineHeight: 1.45, fontSize: "0.9rem" }}>
            {chunk
              ? "Після оновлення залишився старий кеш. Натисніть «Оновити» — очистимо кеш і перезавантажимо."
              : "Спробуйте оновити сторінку. Якщо помилка повторюється — напишіть у підтримку."}
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
}
