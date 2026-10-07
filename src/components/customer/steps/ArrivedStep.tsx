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
  MUTED,
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

export default function ArrivedStep({ orderId, status, order, pickup, destination, cancelError, cancelling, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; cancelError?: string; cancelling?: boolean; onCancel: () => void }) {
  const partnerPoint = order?.assignedProvider?.location
  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={partnerPoint} mapSubtitle="Виконавець на місці">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Виконавець на місці" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} assignedProvider={order?.assignedProvider} />
        <div style={{ background: CARD, borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ marginTop: 16, fontWeight: 900, color: DARK }}>Партнер прибув на місце</div>
          <div style={{ marginTop: 6, color: MUTED, fontWeight: 700 }}>Статус оновиться автоматично, коли партнер почне та завершить роботи в системі.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        <PrimaryButton label="Очікуємо початок робіт" disabled />
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати"} danger disabled={cancelling} onClick={onCancel} />
      </div>
    </RideScreen>
  )
}
