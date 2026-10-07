import { useState } from "react"
import { RideScreen } from "../../layout/RideScreen"
import {
  serviceRequiresDestination,
  type ServiceKey,
  ON_SITE_DESTINATION_LABEL,
} from "../../../lib/pomichDomain"
import {
  type Point,
} from "../../../lib/constants"
import { forwardGeocodeAddress } from "../../../lib/reverseGeocode"
import {
  DARK,
  BORDER,
  MUTED,
  SURFACE_TONE,
} from "../customerFlowTokens"
import {
  PrimaryButton,
  SecondaryButton,
  StepBack,
  SheetHeading,
  LocationRow,
  SheetDivider,
  StepBadge,
} from "../customerFlowUi"

export default function DestinationStep({
  pickup,
  destination,
  value,
  serviceKey,
  geoSpeedMps = null,
  isTelegram,
  onPick,
  onResolvedAddress,
  onChange,
  destinationResolved,
  onNext,
  onBack,
  onSkipOnSite
}: {
  pickup: Point
  destination: Point
  value: string
  serviceKey: ServiceKey
  geoSpeedMps?: number | null
  isTelegram?: boolean
  onPick: (point: Point) => void
  onResolvedAddress: (point: Point, label: string) => void
  onChange: (value: string) => void
  destinationResolved: boolean
  onNext: () => void
  onBack: () => void
  onSkipOnSite?: () => void
}) {
  const needsDestination = serviceRequiresDestination(serviceKey)
  const [addressResolving, setAddressResolving] = useState(false)
  const [addressError, setAddressError] = useState<string | undefined>()
  const [resolvedAddressLabel, setResolvedAddressLabel] = useState<string | undefined>()
  const title = needsDestination ? "Куди доставити авто?" : "Допомога на місці"
  const subtitle = needsDestination
    ? "Натисніть на карті або введіть адресу СТО / точки доставки."
    : ON_SITE_DESTINATION_LABEL

  const resolveTypedAddress = async () => {
    if (!value.trim() || addressResolving) return
    setAddressResolving(true)
    setAddressError(undefined)
    const resolved = await forwardGeocodeAddress(value)
    setAddressResolving(false)
    if (!resolved) {
      setResolvedAddressLabel(undefined)
      setAddressError("Адресу не знайдено.")
      return
    }
    setResolvedAddressLabel(resolved.label)
    onResolvedAddress(resolved.point, resolved.label)
  }

  return (
    <RideScreen
      pickup={pickup}
      destination={needsDestination ? destination : pickup}
      mapSubtitle={needsDestination ? "Оберіть точку на карті" : "Ваше місцезнаходження"}
      onPick={needsDestination ? onPick : undefined}
      mapFocus={needsDestination}
      geoSpeedMps={geoSpeedMps}
    >
      <div data-sheet-peek>
        <SheetHeading title={title} subtitle={value.trim() || (needsDestination ? "Оберіть точку на карті" : ON_SITE_DESTINATION_LABEL)} />
      </div>
      <div data-sheet-full>
      <StepBadge step={3} total={5} label="Куди доставити авто?" />
      <StepBack onBack={onBack} hide={isTelegram} />
      <SheetHeading title={title} subtitle={subtitle} />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: SURFACE_TONE }}>
        <LocationRow icon="●" title="Звідки" subtitle="Ваше місцезнаходження" active />
        {needsDestination ? (
          <>
            <SheetDivider />
            <LocationRow icon="🏁" title="Куди" subtitle={value.trim() || "Оберіть на карті або введіть адресу"} />
          </>
        ) : (
          <>
            <SheetDivider />
            <LocationRow icon="🛠️" title="Куди" subtitle={ON_SITE_DESTINATION_LABEL} />
          </>
        )}
      </div>

      {needsDestination ? (
        <>
          <label style={{ display: "grid", gap: 8, marginTop: 16 }}>
            <span style={{ fontWeight: 900, color: DARK }}>Адреса доставки</span>
            <input
              value={value}
              onChange={(event) => { setAddressError(undefined); setResolvedAddressLabel(undefined); onChange(event.target.value) }}
              placeholder="Наприклад: Київ, вул. Велика Васильківська, 10"
              style={{ width: "100%", minHeight: 50, padding: "0 14px", borderRadius: 16, border: `1px solid ${BORDER}`, fontSize: 15, fontWeight: 750, fontFamily: "inherit", background: "var(--pomich-input-bg)", color: "var(--pomich-text)" }}
            />
          </label>
          <SecondaryButton label={addressResolving ? "Шукаємо адресу…" : "Знайти адресу"} onClick={() => void resolveTypedAddress()} disabled={addressResolving || value.trim().length < 3} />
          {addressError ? (
            <div role="alert" style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>
              <div>{addressError}</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.5 }}>
                <li>додайте місто, вулицю та номер будинку;</li>
                <li>або виберіть точку безпосередньо на карті.</li>
              </ul>
            </div>
          ) : null}
          {destinationResolved ? (
            <div className="pomich-address-resolved" role="status">
              <strong>✓ Точку доставки підтверджено на карті</strong>
              {resolvedAddressLabel ? <span>{resolvedAddressLabel}</span> : null}
            </div>
          ) : null}
          <div style={{ color: MUTED, fontSize: 12, fontWeight: 750, marginTop: 8 }}>Точка: {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</div>
          {isTelegram ? null : (
            <div style={{ marginTop: 16 }}>
              <PrimaryButton label="Далі" onClick={onNext} disabled={!destinationResolved} />
              {!destinationResolved ? <div className="pomich-disabled-reason">Спочатку знайдіть адресу й підтвердьте точку або виберіть її на карті.</div> : null}
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <div style={{ background: "var(--pomich-info-bg)", color: "var(--pomich-info-text)", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
            Партнер приїде до вас. Окрему точку «куди везти» вказувати не потрібно.
          </div>
          {isTelegram ? null : <PrimaryButton label="Далі" onClick={() => (onSkipOnSite ? onSkipOnSite() : onNext())} />}
        </div>
      )}
      </div>
    </RideScreen>
  )
}
