import { BORDER, DARK, SUBTLE, CARD, GHOST } from "./flowTheme"

export default function GeoRefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Оновити геолокацію"
      aria-busy={loading || undefined}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      style={{
        minHeight: 36,
        padding: "0 12px",
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        background: loading ? GHOST : CARD,
        color: loading ? SUBTLE : DARK,
        fontWeight: 900,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        touchAction: "manipulation",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{loading ? "…" : "↻"}</span>
      {loading ? "Оновлюємо…" : "Оновити"}
    </button>
  )
}
