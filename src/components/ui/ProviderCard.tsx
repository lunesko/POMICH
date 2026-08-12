import type { OrderResponse, ProviderAvailability } from "../../api/client"
import { BORDER, BRAND, DARK, provider } from "../../lib/constants"
import { SecondaryButton } from "./SecondaryButton"
import { VerificationPill } from "./VerificationPill"

interface ProviderCardProps {
  orderId?: string
  eta?: number
  assignedProvider?: OrderResponse["assignedProvider"] | ProviderAvailability
}

export function ProviderCard({ orderId, eta, assignedProvider }: ProviderCardProps) {
  const cardProvider = assignedProvider ?? provider
  const phone = cardProvider.phone ?? provider.phone
  const telegram = cardProvider.telegram ?? provider.telegram
  const rating = cardProvider.rating ?? provider.rating
  const distanceKm = "distanceKm" in cardProvider && typeof cardProvider.distanceKm === "number" ? cardProvider.distanceKm : undefined
  const verificationStatus = "verificationStatus" in cardProvider ? cardProvider.verificationStatus : "verified"

  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, boxShadow: "0 8px 22px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "#E8F8F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🚛</div>
          <div>
            <div style={{ fontWeight: 900, color: DARK }}>{cardProvider.name ?? provider.name}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{cardProvider.vehicle ?? provider.vehicle} · {cardProvider.plate ?? provider.plate}</div>
            <div style={{ marginTop: 6 }}><VerificationPill status={verificationStatus} /></div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontWeight: 900, color: BRAND }}>★ {rating}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <a href={`tel:${phone}`} style={{ textDecoration: "none" }}><SecondaryButton label="📞 Подзвонити" /></a>
        <a href={`https://t.me/${telegram}${orderId ? `?start=order_${orderId}` : ""}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><SecondaryButton label="💬 Чат" /></a>
      </div>
      {eta ? <div style={{ marginTop: 10, color: "#6B7280", fontSize: 13, fontWeight: 700 }}>Прибуття приблизно за {eta} хв</div> : null}
      {distanceKm ? <div style={{ marginTop: 6, color: "#6B7280", fontSize: 13, fontWeight: 700 }}>{distanceKm.toFixed(1)} км від вас</div> : null}
    </div>
  )
}
