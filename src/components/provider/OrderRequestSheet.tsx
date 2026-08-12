import type { MapRequestPin } from "../../api/client"
import { BORDER, DARK, getProviderCapabilityLabel, getServiceEmoji } from "../../lib/constants"
import { PrimaryButton } from "../ui/PrimaryButton"
import { SecondaryButton } from "../ui/SecondaryButton"

export function OrderRequestSheet({
  pin,
  proposedPrice,
  saving,
  error,
  secondsLeft,
  onProposedPriceChange,
  onAccept,
  onClose,
  onAcceptBlocked,
}: {
  pin: MapRequestPin
  proposedPrice: string
  saving: boolean
  error?: string
  secondsLeft?: number
  onProposedPriceChange: (value: string) => void
  onAccept: () => void
  onClose: () => void
  onAcceptBlocked?: (reason: "expired" | "price") => void
}) {
  const parsedPrice = Number(proposedPrice.replace(",", "."))
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0
  const offerExpired = typeof secondsLeft === "number" && secondsLeft <= 0
  const eta = pin.etaMinutes ?? (typeof pin.distanceKm === "number" ? Math.ceil(pin.distanceKm * 4) : undefined)
  const distanceLabel = typeof pin.distanceKm === "number" ? `${pin.distanceKm.toFixed(1)} км` : "—"

  const handleAcceptClick = () => {
    if (saving) return
    if (offerExpired) {
      onAcceptBlocked?.("expired")
      return
    }
    if (!priceValid) {
      onAcceptBlocked?.("price")
      return
    }
    onAccept()
  }

  return (
    <div
      className="pomich-order-request-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Деталі заявки"
      onClick={onClose}
    >
      <div className="pomich-order-request-sheet__panel" onClick={(event) => event.stopPropagation()}>
        <div className="pomich-order-request-sheet__handle" aria-hidden="true" />
        <div className="pomich-order-request-sheet__title">
          {getServiceEmoji(pin.service)} {getProviderCapabilityLabel(pin.service)}
        </div>
        <div className="pomich-order-request-sheet__meta">
          {distanceLabel}
          {eta ? ` · ~${eta} хв` : ""}
          {typeof secondsLeft === "number" ? ` · ${secondsLeft > 0 ? `${secondsLeft} сек` : "час вийшов"}` : ""}
        </div>

        <div className="pomich-order-request-sheet__details">
          <div><strong>Адреса:</strong> {pin.customerLocation ?? "Поруч із вами"}</div>
          {pin.vehicleState ? <div><strong>Авто:</strong> {pin.vehicleState}</div> : null}
          {pin.customerComment ? (
            <div className="pomich-order-request-sheet__comment">
              <strong>Коментар клієнта:</strong>
              <p>{pin.customerComment}</p>
            </div>
          ) : null}
        </div>

        <label className="pomich-order-request-sheet__price-label">
          <span>Вартість послуги, ₴</span>
          <input
            value={proposedPrice}
            onChange={(event) => onProposedPriceChange(event.target.value)}
            inputMode="decimal"
            placeholder="Наприклад: 1200"
            className="pomich-form-input"
            style={{ color: DARK, minHeight: 48 }}
          />
        </label>

        {error ? (
          <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800, fontSize: "var(--pomich-text-sm)" }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
          <PrimaryButton label={saving ? "Приймаємо…" : offerExpired ? "Час вийшов" : "ПРИЙНЯТИ З ЦІНОЮ"} onClick={handleAcceptClick} disabled={saving} />
          <SecondaryButton label="Закрити" onClick={onClose} disabled={saving} />
        </div>
      </div>
    </div>
  )
}

export default OrderRequestSheet
