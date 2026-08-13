import { Component, type ErrorInfo, type ReactNode } from "react"

interface PomichErrorBoundaryProps {
  children: ReactNode
}

interface PomichErrorBoundaryState {
  error: Error | null
}

export default class PomichErrorBoundary extends Component<PomichErrorBoundaryProps, PomichErrorBoundaryState> {
  state: PomichErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PomichErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[POMICH] UI crash", error, info.componentStack)
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        className="pomich-app-fallback"
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--pomich-bg, #E2E9E6)",
          color: "var(--pomich-text, #1A2332)",
        }}
      >
        <div
          className="pomich-app-fallback__card"
          style={{
            maxWidth: 420,
            width: "100%",
            borderRadius: 16,
            padding: "20px 18px",
            border: "1px solid var(--pomich-border, rgba(28,42,36,0.12))",
            background: "var(--pomich-surface, #fff)",
            boxShadow: "var(--pomich-card-shadow, 0 8px 24px rgba(0,0,0,0.08))",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>POMICH</h1>
          <p style={{ margin: "12px 0 0", lineHeight: 1.5, fontWeight: 700 }}>
            Не вдалося завантажити інтерфейс. Спробуйте оновити сторінку.
          </p>
          <button
            type="button"
            onClick={this.reload}
            style={{
              marginTop: 16,
              minHeight: 48,
              width: "100%",
              border: "none",
              borderRadius: 12,
              background: "linear-gradient(135deg, #16A36A 0%, #2F80ED 100%)",
              color: "#fff",
              fontWeight: 900,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Оновити
          </button>
        </div>
      </div>
    )
  }
}
