export default function CustomerAppFallback({ message, onRetry, onLanding }: { message: string; onRetry?: () => void; onLanding?: () => void }) {
  return (
    <div className="pomich-app-fallback">
      <div className="pomich-app-fallback__card">
        <div className="pomich-app-fallback__title">{message}</div>
        <div className="pomich-app-fallback__actions">
          {onRetry ? (
            <button type="button" className="pomich-primary-btn" onClick={onRetry}>
              Спробувати ще
            </button>
          ) : null}
          {onLanding ? (
            <button type="button" className="pomich-ghost-btn" onClick={onLanding}>
              На головну
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
