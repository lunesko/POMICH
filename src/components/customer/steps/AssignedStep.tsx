import {
  type OrderResponse,
} from "../../../api/client"
import { RideScreen } from "../../layout/RideScreen"
import {
  type Point,
  type OrderStatus,
} from "../../../lib/constants"
import {
  DARK,
  BORDER,
  CARD,
  SELECTED,
} from "../customerFlowTokens"
import {
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  Timeline,
  ProviderCard,
  SheetHeading,
} from "../customerFlowUi"

export default function AssignedStep({ orderId, status, order, pickup, destination, isTelegram, cancelError, cancelling, onTrack, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; isTelegram?: boolean; cancelError?: string; cancelling?: boolean; onTrack: () => void; onCancel: () => void }) {
  const assignedProvider = order?.assignedProvider
  const eta = assignedProvider?.etaMinutes
  const confirmedPrice = order?.partnerProposedPrice

  return (
    <RideScreen pickup={pickup} destination={destination} providers={assignedProvider ? [assignedProvider] : undefined} mapSubtitle="Ціна підтверджена">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Допомога їде до вас" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Прибуття</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>{typeof eta === "number" ? `~${eta} хв` : "—"}</div>
        </div>
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Узгоджена ціна</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>{typeof confirmedPrice === "number" ? `${confirmedPrice.toLocaleString("uk-UA")} ₴` : "—"}</div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={assignedProvider} />
        <div style={{ background: CARD, borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
        </div>
        <div style={{ background: SELECTED, borderRadius: 18, padding: 14, color: DARK, fontWeight: 800 }}>
          {assignedProvider?.name ?? "Партнер"} їде до вас
          {typeof eta === "number" ? `. ETA ~${eta} хв` : ""}
          {typeof confirmedPrice === "number" ? `, узгоджена ціна ${confirmedPrice.toLocaleString("uk-UA")} ₴` : ""}.
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        {isTelegram ? null : <PrimaryButton label="Дивитися маршрут" onClick={onTrack} disabled={cancelling} />}
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати заявку"} danger disabled={cancelling} onClick={onCancel} />
      </div>
    </RideScreen>
  )
}
