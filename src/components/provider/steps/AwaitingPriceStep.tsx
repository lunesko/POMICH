import type { OrderResponse } from "../../../api/client"
import { acceptedIdleSecondsLeft, formatCountdown } from "../../../lib/dispatchOffer"
import { BORDER, CARD, DARK, MUTED } from "../providerFlowTokens"
import { Header, ScreenLayout, SecondaryButton, Timeline } from "../providerFlowUi"

export default function AwaitingPriceStep({
  activeOrder,
  offerClock,
  orderAdvancing,
  offerError,
  onCancel,
}: {
  activeOrder?: OrderResponse
  offerClock: number
  orderAdvancing: boolean
  offerError?: string
  onCancel: () => void
}) {
  const proposed = activeOrder?.partnerProposedPrice
  const idleSecondsLeft = acceptedIdleSecondsLeft(activeOrder, offerClock)
  return (
    <ScreenLayout
      footer={
        <SecondaryButton
          label={orderAdvancing ? "Скасовуємо…" : "Скасувати заявку"}
          danger
          disabled={orderAdvancing}
          onClick={onCancel}
        />
      }
    >
      <Header title="Очікуємо клієнта" subtitle={activeOrder?.id ? `Замовлення #${activeOrder.id}` : undefined} status="accepted" showThemeToggle={false} compactToggle />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
          <div style={{ fontWeight: 950, fontSize: 20, color: DARK }}>Ціну надіслано клієнту</div>
          <div style={{ color: MUTED, fontWeight: 750, marginTop: 8, lineHeight: 1.45 }}>
            Ви запропонували {typeof proposed === "number" ? `${proposed.toLocaleString("uk-UA")} ₴` : "ціну"}. Клієнт підтвердить або зв'яжеться для обговорення.
          </div>
          <div style={{ marginTop: 14, background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: 12, fontWeight: 800, lineHeight: 1.45 }}>
            {idleSecondsLeft > 0
              ? `Якщо клієнт не підтвердить ціну за ${formatCountdown(idleSecondsLeft)}, заявку буде скасовано.`
              : "Час очікування вийшов — заявку буде скасовано автоматично."}
          </div>
          <div style={{ marginTop: 14 }}>
            <Timeline status="accepted" />
          </div>
        </div>
        {offerError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{offerError}</div> : null}
      </div>
    </ScreenLayout>
  )
}
