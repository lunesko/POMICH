import { type OrderResponse, type ProviderAvailability } from "../../../api/client"
import VerificationPill from "./VerificationPill"
import SecondaryButton from "./SecondaryButton"
import { BRAND, BORDER, DARK, CARD, MUTED, SELECTED } from "./flowTheme"

export default function ProviderCard({
  orderId,
  eta,
  assignedProvider,
  fallbackName,
}: {
  orderId?: string
  eta?: number
  assignedProvider?: OrderResponse["assignedProvider"] | ProviderAvailability
  fallbackName?: string
}) {
  const cardProvider = assignedProvider
  if (!cardProvider) {
    return (
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
        <div style={{ fontWeight: 900, color: DARK }}>{fallbackName ?? "Партнер прийняв заявку"}</div>
        <div style={{ color: MUTED, fontWeight: 700, marginTop: 6, fontSize: 13 }}>Завантажуємо дані виконавця…</div>
      </div>
    )
  }
  const phone = cardProvider.phone
  const telegram = cardProvider.telegram
  const rating = cardProvider.rating
  const distanceKm = "distanceKm" in cardProvider && typeof cardProvider.distanceKm === "number" ? cardProvider.distanceKm : undefined
  const verificationStatus = "verificationStatus" in cardProvider ? cardProvider.verificationStatus : "verified"
  const distanceLabel =
    typeof distanceKm === "number"
      ? distanceKm < 0.15
        ? "Поруч із вами"
        : `${distanceKm.toFixed(1)} км від вас`
      : null
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, boxShadow: "0 8px 22px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: SELECTED, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🚛</div>
          <div>
            <div style={{ fontWeight: 900, color: DARK }}>{cardProvider.name ?? fallbackName ?? "Партнер"}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{[cardProvider.vehicle, cardProvider.plate].filter(Boolean).join(" · ") || "Дані авто уточнюються"}</div>
            <div style={{ marginTop: 6 }}><VerificationPill status={verificationStatus} /></div>
          </div>
        </div>
        {typeof rating === "number" ? <div style={{ textAlign: "right", fontWeight: 900, color: BRAND }}>★ {rating}</div> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: phone && telegram ? "1fr 1fr" : "1fr", gap: 10, marginTop: 12 }}>
        {phone ? (
          <SecondaryButton label="📞 Подзвонити" onClick={() => { window.location.href = `tel:${phone}` }} />
        ) : null}
        {telegram ? (
          <SecondaryButton
            label="💬 Чат"
            onClick={() => {
              window.open(`https://t.me/${telegram}${orderId ? `?start=order_${orderId}` : ""}`, "_blank", "noopener,noreferrer")
            }}
          />
        ) : null}
      </div>
      {eta ? <div style={{ marginTop: 10, color: MUTED, fontSize: 13, fontWeight: 700 }}>Прибуття приблизно за {eta} хв</div> : null}
      {distanceLabel ? <div style={{ marginTop: 6, color: MUTED, fontSize: 13, fontWeight: 700 }}>{distanceLabel}</div> : null}
    </div>
  )
}
