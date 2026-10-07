import PrimaryButton from "./PrimaryButton"
import SecondaryButton from "./SecondaryButton"
import ScreenLayout from "./ScreenLayout"
import Header from "./Header"
import LazyRouteMap from "../../map/LazyRouteMap"
import { type OrderStatus } from "../../../lib/constants"
import { normalizeOrderStatus } from "../../../lib/orderStatus"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"
import { BORDER, MUTED, CARD } from "./flowTheme"

export default function ProviderNavigationStep({ state }: { state: ProviderFlowState }) {
  const { mapTileTheme, step, setStep, activeOrder, offerError, orderAdvancing, providerLocation, providerRecenterTrigger, providerSpeedMps, advanceProviderOrder, cancelActiveOrder } = state
  if (step === "navigation") {
    const activeStatus = normalizeOrderStatus(activeOrder?.status)
    const nextStatus: OrderStatus = activeStatus === "price_confirmed" || activeStatus === "assigned" || activeStatus === "accepted" ? "en_route" : "arrived"
    const hasLiveGps = Number.isFinite(providerLocation.lat) && Number.isFinite(providerLocation.lng)
    // Never fall back to hardcoded Uzhhorod demo points — that drew a fake blue destination
    // and/or routed to the wrong pickup after accept.
    const routePickup = activeOrder?.customerCoordinates
    const routeDestination = activeOrder?.destinationCoordinates
    const customerLabel = activeOrder?.customerLocation || "Точка подачі клієнта"
    return (
      <ScreenLayout
        footer={
          <>
            <PrimaryButton
              label={activeStatus === "en_route" ? "Я НА МІСЦІ" : "ЇДУ ДО КЛІЄНТА"}
              loading={orderAdvancing}
              loadingLabel={activeStatus === "en_route" ? "Оновлюємо…" : "Виїжджаємо…"}
              disabled={activeStatus === "accepted"}
              onClick={() => {
                if (activeOrder) void advanceProviderOrder(nextStatus)
                else setStep("arrived")
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
        <Header title="Маршрут до клієнта" subtitle={activeOrder?.id ? `Активне замовлення #${activeOrder.id}` : "Активне замовлення"} status={activeStatus === "en_route" ? "en_route" : "price_confirmed"} showThemeToggle={false} compactToggle />
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 12 }}>
          {routePickup ? (
            <LazyRouteMap
              pickup={routePickup}
              destination={routeDestination}
              providerPosition={hasLiveGps ? providerLocation : undefined}
              subtitle={hasLiveGps ? "Ваша GPS-позиція" : "Очікуємо геолокацію"}
              mapTileTheme={mapTileTheme}
              geoSpeedMps={providerSpeedMps}
              recenterTrigger={providerRecenterTrigger}
            />
          ) : (
            <div style={{ background: CARD, borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, color: MUTED, fontWeight: 700 }}>
              Немає координат клієнта для побудови маршруту. Оновіть заявку або попросіть клієнта надіслати геолокацію ще раз.
            </div>
          )}
          <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16 }}>
            <div style={{ fontWeight: 950, fontSize: 20 }}>{hasLiveGps ? "Навігація за GPS" : "Немає GPS"}</div>
            <div style={{ color: "#CBD5E1", marginTop: 6, fontWeight: 700 }}>Клієнт: {customerLabel}</div>
            <div style={{ color: "#CBD5E1", marginTop: 8, fontWeight: 700, lineHeight: 1.4 }}>
              {hasLiveGps
                ? "Позиція оновлюється з вашого пристрою. Імітацію руху вимкнено."
                : "Увімкніть геолокацію, щоб бачити себе на карті. Рух не імітується."}
            </div>
          </div>
          {offerError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{offerError}</div> : null}
        </div>
      </ScreenLayout>
    )
  }
return null
}
