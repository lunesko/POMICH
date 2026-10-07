import { type OrderResponse } from "../../../api/client"
import { RideScreen } from "../../layout/RideScreen"
import { type Point, type OrderStatus } from "../../../lib/constants"
import PrimaryButton from "./PrimaryButton"
import SecondaryButton from "./SecondaryButton"
import Timeline from "./Timeline"
import ProviderCard from "./ProviderCard"
import SheetHeading from "./SheetHeading"
import { BORDER, CARD, MUTED } from "./flowTheme"

export default function TrackingStep({ orderId, status, order, pickup, destination, cancelError, cancelling, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; cancelError?: string; cancelling?: boolean; onCancel: () => void }) {
  const liveProviderLocation = order?.assignedProvider?.location
  const hasLiveLocation = Boolean(liveProviderLocation && Number.isFinite(liveProviderLocation.lat) && Number.isFinite(liveProviderLocation.lng))
  const providerPosition = hasLiveLocation
    ? { lat: liveProviderLocation!.lat, lng: liveProviderLocation!.lng }
    : undefined
  const distanceKm = typeof order?.assignedProvider?.distanceKm === "number" ? order.assignedProvider.distanceKm : undefined
  const eta = typeof order?.assignedProvider?.etaMinutes === "number" ? order.assignedProvider.etaMinutes : undefined
  const distanceLabel =
    typeof distanceKm === "number"
      ? distanceKm < 0.15
        ? "Поруч із вами"
        : `${distanceKm.toFixed(1)} км від вас`
      : null
  const mapSubtitle = hasLiveLocation
    ? [eta ? `ETA ${eta} хв` : null, distanceLabel].filter(Boolean).join(" · ") || "Партнер у дорозі"
    : "Партнер прийняв · очікуємо геолокацію"

  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={providerPosition} mapSubtitle={mapSubtitle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Партнер у дорозі" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        {eta ? <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 999, padding: "9px 12px", fontWeight: 950 }}>{eta} хв</div> : null}
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={order?.assignedProvider} />
        <div style={{ background: CARD, borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ color: MUTED, fontSize: 13, fontWeight: 700, marginTop: 12 }}>
            {hasLiveLocation
              ? (typeof distanceKm === "number" && distanceKm < 0.15 ? "Партнер майже на місці." : "Партнер їде до точки подачі. Позиція оновлюється з GPS.")
              : "Партнер прийняв заявку. Карта покаже рух, щойно з’явиться його геолокація."}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        <PrimaryButton label={eta ? `Очікувати · ${eta} хв` : "Очікуємо партнера"} disabled />
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати заявку"} danger disabled={cancelling} onClick={onCancel} />
      </div>
    </RideScreen>
  )
}
