import { useEffect, useRef } from "react"

import type { DispatchOffer } from "../../api/client"
import { getProviderCapabilityLabel, getServiceEmoji, type Point } from "../../lib/constants"
import { parseOfferPrice } from "../../lib/dispatchOffer"
import LazyRouteMap from "../map/LazyRouteMap"
import { usePomichTheme } from "../../context/PomichThemeProvider"
import type { MapTileTheme } from "../../lib/theme"
import { Header } from "../layout/Header"
import ScreenLayout from "../layout/ScreenLayout"
import { PrimaryButton } from "../ui/PrimaryButton"
import { SecondaryButton } from "../ui/SecondaryButton"

export function IncomingOfferStep({
  offer,
  providerLocation,
  secondsLeft,
  saving,
  error,
  proposedPrice,
  priceNote,
  onProposedPriceChange,
  onPriceNoteChange,
  onAccept,
  onDecline,
  onAcceptBlocked,
}: {
  offer: DispatchOffer
  providerLocation: Point
  secondsLeft: number
  saving: boolean
  error?: string
  proposedPrice: string
  priceNote: string
  onProposedPriceChange: (value: string) => void
  onPriceNoteChange: (value: string) => void
  onAccept: (price: string) => void | Promise<void>
  onDecline: () => void | Promise<void>
  onAcceptBlocked?: (reason: "expired" | "price") => void
}) {
  const priceInputRef = useRef<HTMLInputElement>(null)
  const parsedPrice = parseOfferPrice(proposedPrice)
  const priceValid = typeof parsedPrice === "number"
  const customerPickup = offer.customerCoordinates ?? providerLocation
  const eta = offer.etaMinutes ?? Math.ceil((offer.distanceKm ?? 1) * 4)
  const distanceLabel = typeof offer.distanceKm === "number" ? `${offer.distanceKm.toFixed(1)} км` : "—"

  useEffect(() => {
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    if (coarse) return
    const timer = window.setTimeout(() => priceInputRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [offer.id])

  const handleAcceptClick = () => {
    if (saving) return
    if (secondsLeft <= 0) {
      onAcceptBlocked?.("expired")
      return
    }
    if (!priceValid) {
      onAcceptBlocked?.("price")
      priceInputRef.current?.focus()
      return
    }
    void onAccept(proposedPrice)
  }

  return (
    <ScreenLayout
      footer={(
        <div className="pomich-offer-accept-footer">
          {error ? (
            <div className="pomich-offer-inline-error" role="alert">
              {error}
            </div>
          ) : null}
          <PrimaryButton
            label="ПРИЙНЯТИ З ЦІНОЮ"
            loadingLabel="Приймаємо…"
            loading={saving}
            onClick={handleAcceptClick}
            disabled={saving || secondsLeft <= 0}
          />
          <SecondaryButton label="ПРОПУСТИТИ" onClick={() => void onDecline()} disabled={saving} />
        </div>
      )}
    >
      <Header
        title="Нове замовлення"
        subtitle={secondsLeft > 0 ? `${secondsLeft} сек · ${distanceLabel} · ~${eta} хв` : "Час вийшов"}
        status="searching"
      />
      <div className="pomich-incoming-offer">
        <LazyRouteMap
          full
          pickup={customerPickup}
          providerPosition={providerLocation}
          subtitle={`${distanceLabel} · ~${eta} хв`}
        />
        <div className="pomich-incoming-offer__card">
          <div className="pomich-incoming-offer__head">
            <div className="pomich-incoming-offer__title">
              {getServiceEmoji(offer.service)} {getProviderCapabilityLabel(offer.service)}
            </div>
            <div className="pomich-incoming-offer__eta">~{eta} хв</div>
          </div>
          <div className="pomich-incoming-offer__meta">
            <span>{distanceLabel} до клієнта</span>
            {offer.approximateLocation ? <span>{offer.approximateLocation}</span> : null}
          </div>
          {offer.vehicleState ? (
            <div className="pomich-incoming-offer__row"><strong>Авто:</strong> {offer.vehicleState}</div>
          ) : null}
          {offer.customerComment ? (
            <div className="pomich-incoming-offer__comment">
              <strong>Коментар:</strong> {offer.customerComment}
            </div>
          ) : null}
        </div>

        <label className="pomich-incoming-offer__price">
          <span>Ваша ціна, грн</span>
          <input
            ref={priceInputRef}
            value={proposedPrice}
            onChange={(event) => onProposedPriceChange(event.target.value.replace(/[^\d.,]/g, ""))}
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

        <label className="pomich-incoming-offer__note">
          <span>Примітка (необов&apos;язково)</span>
          <input
            value={priceNote}
            onChange={(event) => onPriceNoteChange(event.target.value)}
            placeholder="Що входить у вартість"
            className="pomich-form-input"
          />
        </label>
      </div>
    </ScreenLayout>
  )
}

export default IncomingOfferStep
