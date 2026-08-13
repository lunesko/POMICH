import { useEffect, useRef } from "react"

import type { MapRequestPin } from "../../api/client"
import { getProviderCapabilityLabel, getServiceEmoji } from "../../lib/constants"
import { parseOfferPrice } from "../../lib/dispatchOffer"
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
  onDecline,
  onClose,
  onAcceptBlocked,
}: {
  pin: MapRequestPin
  proposedPrice: string
  saving: boolean
  error?: string
  secondsLeft?: number
  onProposedPriceChange: (value: string) => void
  onAccept: (price: string) => void | Promise<void>
  onDecline?: () => void | Promise<void>
  onClose: () => void
  onAcceptBlocked?: (reason: "expired" | "price") => void
}) {
  const priceInputRef = useRef<HTMLInputElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const parsedPrice = parseOfferPrice(proposedPrice)
  const priceValid = typeof parsedPrice === "number"
  const offerExpired = typeof secondsLeft === "number" && secondsLeft <= 0
  const eta = pin.etaMinutes ?? (typeof pin.distanceKm === "number" ? Math.ceil(pin.distanceKm * 4) : undefined)
  const distanceLabel = typeof pin.distanceKm === "number" ? `${pin.distanceKm.toFixed(1)} км` : "—"

  useEffect(() => {
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    if (coarse) return
    const timer = window.setTimeout(() => {
      priceInputRef.current?.focus()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [pin.id, pin.offerId])

  useEffect(() => {
    if (!offerExpired) return
    onAcceptBlocked?.("expired")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerExpired, pin.id, pin.offerId])

  const ensureActionsVisible = () => {
    window.setTimeout(() => {
      if (typeof actionsRef.current?.scrollIntoView === "function") {
        actionsRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" })
      }
    }, 120)
  }

  const handleAcceptClick = () => {
    if (saving) return
    if (offerExpired) {
      onAcceptBlocked?.("expired")
      return
    }
    if (!priceValid) {
      onAcceptBlocked?.("price")
      priceInputRef.current?.focus()
      ensureActionsVisible()
      return
    }
    void onAccept(proposedPrice)
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
        <div className="pomich-order-request-sheet__scroll">
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

          {error ? (
            <div className="pomich-offer-inline-error" role="alert">
              {error}
            </div>
          ) : null}

          <label className="pomich-order-request-sheet__price-label">
            <span>Ваша ціна, грн</span>
            <input
              ref={priceInputRef}
              value={proposedPrice}
              onChange={(event) => onProposedPriceChange(event.target.value.replace(/[^\d.,]/g, ""))}
              onFocus={ensureActionsVisible}
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder="1200"
              aria-label="Вартість послуги в гривнях"
              className="pomich-form-input pomich-offer-price-input pomich-offer-price-input--compact"
              style={{ border: `2px solid ${error && !priceValid ? "var(--pomich-error-text)" : "var(--pomich-brand)"}` }}
            />
          </label>
        </div>

        <div ref={actionsRef} className="pomich-order-request-sheet__actions">
          <PrimaryButton
            label={offerExpired ? "Час вийшов" : "ПРИЙНЯТИ З ЦІНОЮ"}
            loadingLabel="Приймаємо…"
            loading={saving}
            onClick={handleAcceptClick}
            disabled={saving || offerExpired}
          />
          {onDecline ? (
            <SecondaryButton label="Пропустити" onClick={() => void onDecline()} disabled={saving || offerExpired} />
          ) : null}
          <SecondaryButton label="Закрити" onClick={onClose} disabled={saving} />
        </div>
      </div>
    </div>
  )
}

export default OrderRequestSheet
