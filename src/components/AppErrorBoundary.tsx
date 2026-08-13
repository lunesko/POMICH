import { Component, type ErrorInfo, type ReactNode } from "react"

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
  }

  render() {
    if (this.state.error) {
      return (
        <div className="pomich-app-fallback">
          <div className="pomich-app-fallback__card">
            <div className="pomich-app-fallback__title">Не вдалося завантажити POMICH</div>
            <p style={{ margin: "12px 0 0", color: "var(--pomich-muted)", fontWeight: 600, lineHeight: 1.45 }}>
              Спробуйте оновити сторінку (Ctrl+F5). Якщо помилка повторюється — напишіть у підтримку.
            </p>
            <div className="pomich-app-fallback__actions">
              <button type="button" className="pomich-primary-btn" onClick={() => window.location.reload()}>
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
