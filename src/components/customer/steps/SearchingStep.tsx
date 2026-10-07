import { type OrderResponse } from "../../../api/client"
import { RideScreen } from "../../layout/RideScreen"
import { type Point, type OrderStatus } from "../../../lib/constants"
import PrimaryButton from "./PrimaryButton"
import SecondaryButton from "./SecondaryButton"
import StatusPill from "./StatusPill"
import Timeline from "./Timeline"
import SheetHeading from "./SheetHeading"
import { BORDER, DARK, MUTED, SURFACE_TONE } from "./flowTheme"

export default function SearchingStep({ orderId, status, order, pickup, destination, cancelError, cancelling, onCancel, onRetryDispatch }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; cancelError?: string; cancelling?: boolean; onCancel: () => void; onRetryDispatch: () => void }) {
  const noProviders = order?.dispatchState === "NO_PROVIDERS_AVAILABLE"
  const awaitingDispatcher = Boolean(order?.dispatchInfo?.awaitingDispatcher) || noProviders
  const offers = order?.offers ?? []
  const pendingOffers = offers.filter((offer) => offer.status === "pending").length
  const offersSent = order?.dispatchInfo?.offersSent ?? offers.length
  const wave = order?.dispatchInfo?.wave
  const offersExhausted =
    !noProviders &&
    status === "searching" &&
    offersSent > 0 &&
    pendingOffers === 0 &&
    offers.some((offer) => offer.status === "expired" || offer.status === "declined" || offer.status === "lost")
  const showRetry = noProviders || offersExhausted
  const statusHint =
    (typeof order?.dispatchInfo?.clientStatusHint === "string" && order.dispatchInfo.clientStatusHint.trim()) ||
    (awaitingDispatcher || showRetry
      ? "Партнера поруч поки немає. Диспетчер розширює пошук."
      : undefined)

  return (
    <RideScreen pickup={pickup} destination={destination} providers={order?.assignedProvider ? [order.assignedProvider] : undefined} mapSubtitle={orderId ? `#${orderId}` : "Очікуємо партнера"}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading
          title={showRetry ? "Розширюємо пошук" : "Очікуємо партнера"}
          subtitle={
            statusHint
              ? statusHint
              : typeof wave === "number" && wave > 1
                ? `Шукаємо далі · хвиля ${wave}`
                : orderId
                  ? `Замовлення #${orderId}`
                  : "Шукаємо найближчого перевіреного партнера…"
          }
        />
        <StatusPill status={status} />
      </div>

      <div className="pomich-radar-container">
        <div className="pomich-radar-ring" />
        <div className="pomich-radar-ring" />
        <div className="pomich-radar-ring" />
        <div className="pomich-radar-beam" />
        <div className="pomich-radar-center-icon">🚛</div>
      </div>

      <div style={{ color: MUTED, fontWeight: 750, lineHeight: 1.4, textAlign: "center" }}>
        {noProviders
          ? "Можна повторити пошук без створення нової заявки."
          : offersExhausted
            ? "Система повторює пошук автоматично. Можна також натиснути «Спробувати ще раз»."
            : offersSent > 0
              ? `Звернулися до ${offersSent} партнерів. Перший, хто підтвердить, отримає заявку.`
              : "Скануємо найближчих партнерів на лінії… Партнери бачать ваше місцезнаходження."}
      </div>
      <div style={{ marginTop: 16 }}><Timeline status={status} /></div>
      <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
        {[
          { text: "Заявку надіслано в систему", active: true },
          { text: "Сканування та розсилка партнерам", active: true },
          { text: "Очікування підтвердження ціни", active: !showRetry },
        ].map((item) => (
          <div key={item.text} style={{ background: SURFACE_TONE, borderRadius: 15, border: `1px solid ${BORDER}`, padding: "12px 14px", fontWeight: 850, color: DARK, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: item.active ? "var(--pomich-accent, #16a36a)" : "var(--pomich-muted)", fontWeight: 900 }}>{item.active ? "✓" : "⏳"}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        {showRetry ? <PrimaryButton label="Спробувати ще раз" onClick={onRetryDispatch} /> : null}
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати заявку"} danger disabled={cancelling} onClick={onCancel} />
      </div>
    </RideScreen>
  )
}
