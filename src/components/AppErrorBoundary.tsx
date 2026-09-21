import { Component, type ErrorInfo, type ReactNode } from "react"

import {
  clearClientCaches,
  isChunkLoadError,
  recoverFromChunkError,
  resetChunkReloadGuard,
} from "../lib/chunkRecovery"

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[POMICH] render crash", error, info.componentStack)
    recoverFromChunkError(error)
  }

  private retry = () => {
    this.setState({ error: null })
    resetChunkReloadGuard()
    void clearClientCaches().finally(() => window.location.reload())
  }

  render() {
    if (this.state.error) {
      const chunk = isChunkLoadError(this.state.error)
      return (
        <div className="pomich-app-fallback">
          <div className="pomich-app-fallback__card">
            <div className="pomich-app-fallback__title">Не вдалося завантажити POMICH</div>
            <p style={{ margin: "12px 0 0", color: "var(--pomich-muted)", fontWeight: 600, lineHeight: 1.45 }}>
              {chunk
                ? "Часто це старий кеш після оновлення. Натисніть «Оновити» — ми очистимо кеш і перезавантажимо сторінку."
                : "Натисніть «Оновити». Якщо помилка повторюється — напишіть у підтримку."}
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
