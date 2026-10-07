import { useState, useEffect } from "react"
import {
  type OrderResponse,
} from "../../../api/client"
import { RideScreen } from "../../layout/RideScreen"
import {
  type Point,
  type OrderStatus,
} from "../../../lib/constants"
import { acceptedIdleSecondsLeft, formatCountdown } from "../../../lib/dispatchOffer"
import {
  DARK,
  BORDER,
  CARD,
} from "../customerFlowTokens"
import {
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  Timeline,
  ProviderCard,
  SheetHeading,
} from "../customerFlowUi"

export default function AcceptedStep({
  orderId,
  status,
  order,
  pickup,
  destination,
  confirming,
  confirmError,
  cancelError,
  cancelling,
  onConfirmPrice,
  onContact,
  onCancel,
}: {
  orderId?: string
  status: OrderStatus
  order?: OrderResponse
  pickup: Point
  destination: Point
  confirming: boolean
  confirmError?: string
  cancelError?: string
  cancelling?: boolean
  onConfirmPrice: () => void
  onContact: () => void
  onCancel: () => void
}) {
  const assignedProvider = order?.assignedProvider
  const eta = assignedProvider?.etaMinutes
  const proposedPrice = order?.partnerProposedPrice
  const partnerName = assignedProvider?.name ?? order?.providerName
  const priceLabel = typeof proposedPrice === "number" ? `${proposedPrice.toLocaleString("uk-UA")} ₴` : "—"
  const [clock, setClock] = useState(Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  const idleSecondsLeft = acceptedIdleSecondsLeft(order, clock)

  return (
    <RideScreen pickup={pickup} destination={destination} providers={assignedProvider ? [assignedProvider] : undefined} mapSubtitle="Партнер запропонував ціну" expandedSheet>
      <div data-sheet-peek>
        <SheetHeading title="Запропонована ціна" subtitle={typeof proposedPrice === "number" ? `${priceLabel} · підтвердіть` : "Очікуємо ціну від партнера"} />
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 28, fontWeight: 950, color: DARK }}>{priceLabel}</div>
          <StatusPill status={status} />
        </div>
      </div>
      <div data-sheet-full>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Партнер прийняв заявку" subtitle={orderId ? `Замовлення #${orderId}` : "Обговоріть ціну з партнером"} />
        <StatusPill status={status} />
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Прибуття</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>{typeof eta === "number" ? `~${eta} хв` : "—"}</div>
        </div>
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Запропонована ціна</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>{priceLabel}</div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={assignedProvider} fallbackName={partnerName} />
        {order?.partnerPriceNote ? (
          <div style={{ background: "#EFF6FF", borderRadius: 18, padding: 14, color: "#1D4ED8", fontWeight: 800, fontSize: 13, lineHeight: 1.45 }}>
            Примітка партнера: {order.partnerPriceNote}
          </div>
        ) : null}
        <div style={{ background: CARD, borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
        </div>
        <div style={{ background: "var(--pomich-warn-bg)", borderRadius: 18, padding: 14, color: "var(--pomich-warn-text)", fontWeight: 800, lineHeight: 1.45 }}>
          {partnerName ?? "Партнер"} запропонував {typeof proposedPrice === "number" ? priceLabel : "ціну"}.{" "}
          {idleSecondsLeft > 0
            ? `Підтвердіть протягом ${formatCountdown(idleSecondsLeft)}, інакше заявку буде скасовано.`
            : "Час підтвердження вийшов — заявку буде скасовано автоматично."}
        </div>
        {confirmError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{confirmError}</div> : null}
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
      </div>
      <div className="pomich-price-confirm-actions">
        <PrimaryButton label={confirming ? "Підтверджуємо…" : "Підтвердити ціну"} onClick={onConfirmPrice} loading={confirming} disabled={confirming || cancelling || typeof proposedPrice !== "number"} />
        <SecondaryButton label="Зв'язатися" onClick={onContact} disabled={cancelling} />
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати заявку"} danger disabled={cancelling} onClick={onCancel} />
      </div>
      </div>
    </RideScreen>
  )
}
