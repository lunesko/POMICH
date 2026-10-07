import PrimaryButton from "./PrimaryButton"
import SecondaryButton from "./SecondaryButton"
import Timeline from "./Timeline"
import ProviderCard from "./ProviderCard"
import ScreenLayout from "./ScreenLayout"
import Header from "./Header"
import { type OrderStatus } from "../../../lib/constants"
import { normalizeOrderStatus } from "../../../lib/orderStatus"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"
import { DARK, BORDER, MUTED, CARD } from "./flowTheme"

export default function ProviderArrivedStep({ state }: { state: ProviderFlowState }) {
  const { step, setStep, activeOrder, offerError, orderAdvancing, providerPresence, advanceProviderOrder, cancelActiveOrder } = state
  if (step === "arrived") {
    const activeStatus = normalizeOrderStatus(activeOrder?.status)
    const nextStatus: OrderStatus = activeStatus === "arrived" ? "in_progress" : "completed"
    return (
      <ScreenLayout
        footer={
          <>
            <PrimaryButton
              label={activeStatus === "arrived" ? "ПОЧАТИ РОБОТУ" : "ЗАВЕРШИТИ"}
              loading={orderAdvancing}
              loadingLabel={activeStatus === "arrived" ? "Починаємо…" : "Завершуємо…"}
              onClick={() => {
                if (activeOrder) void advanceProviderOrder(nextStatus)
                else setStep("completed")
              }}
            />
            <SecondaryButton
              label={orderAdvancing ? "Скасовуємо…" : "Скасувати заявку"}
              danger
              disabled={orderAdvancing}
              onClick={() => {
                void cancelActiveOrder()
              }}
            />
          </>
        }
      >
        <Header title={activeStatus === "in_progress" ? "Допомога триває" : "Ви на місці"} subtitle="Клієнт бачить ваш статус у POMICH" status={activeStatus === "in_progress" ? "in_progress" : "arrived"} showThemeToggle={false} compactToggle />
        <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
          <ProviderCard orderId={activeOrder?.id} assignedProvider={activeOrder?.assignedProvider ?? providerPresence} />
          <div style={{ background: CARD, borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14 }}>
            <Timeline status={activeStatus === "in_progress" ? "in_progress" : "arrived"} />
            <div style={{ fontWeight: 900, color: DARK, marginTop: 16 }}>Поточна дія</div>
            <div style={{ color: MUTED, fontWeight: 700, marginTop: 6 }}>
              {activeStatus === "arrived"
                ? "Натисніть «Почати роботу», коли починаєте допомогу клієнту."
                : "Підтвердіть завершення, коли допомогу надано."}
            </div>
          </div>
          {offerError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{offerError}</div> : null}
        </div>
      </ScreenLayout>
    )
  }
return null
}
