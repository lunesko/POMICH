import { RideScreen } from "../../layout/RideScreen"
import {
  isWithinUkraineServiceArea,
  serviceRequiresDestination,
  type ServiceKey,
} from "../../../lib/pomichDomain"
import {
  type Point,
} from "../../../lib/constants"
import {
  BORDER,
  MUTED,
  SURFACE_TONE,
} from "../customerFlowTokens"
import {
  PrimaryButton,
  StepBack,
  SheetHeading,
  LocationRow,
  StepBadge,
} from "../customerFlowUi"

export default function LocationStep({
  pickup,
  serviceKey,
  addressLabel,
  geoMessage,
  geoLoading,
  geoError,
  recenterTrigger,
  geoSpeedMps = null,
  isTelegram,
  onPick,
  onRetryGeo,
  onBack,
  onNext
}: {
  pickup: Point
  serviceKey: ServiceKey
  addressLabel: string
  geoMessage: string
  geoLoading: boolean
  geoError?: string
  recenterTrigger: number
  geoSpeedMps?: number | null
  isTelegram?: boolean
  onPick: (point: Point) => void
  onRetryGeo: () => void
  onBack: () => void
  onNext: () => void
}) {
  const geoStatusHint = geoError ? undefined : geoLoading ? "Визначаємо ваше місцезнаходження…" : geoMessage
  const outsideServiceArea = !isWithinUkraineServiceArea(pickup)

  return (
    <RideScreen
      pickup={pickup}
      mapSubtitle="Ваше місцезнаходження · перетягніть маркер"
      onPick={onPick}
      mapFocus
      onRetryGeo={onRetryGeo}
      geoLoading={geoLoading}
      geoError={geoError}
      recenterTrigger={recenterTrigger}
      geoSpeedMps={geoSpeedMps}
    >
      <div data-sheet-peek>
        <SheetHeading title="Де ви зараз?" subtitle={geoLoading ? "Визначаємо адресу…" : addressLabel} />
      </div>
      <div data-sheet-full>
      <StepBadge step={2} total={serviceRequiresDestination(serviceKey) ? 5 : 4} label="Де ви зараз?" />
      <StepBack onBack={onBack} hide={isTelegram} />
      <SheetHeading title="Де ви зараз?" subtitle="Це місце, де вас знайде партнер. Перетягніть маркер на карті або натисніть, щоб уточнити." />

      <div style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px 10px", background: SURFACE_TONE }}>
        <LocationRow icon="📍" title="Адреса" subtitle={geoLoading ? "Визначаємо адресу…" : addressLabel} active />
        {geoStatusHint ? (
          <div style={{ margin: "0 0 8px 47px", color: MUTED, fontSize: 11, fontWeight: 750, lineHeight: 1.35 }}>{geoStatusHint}</div>
        ) : null}
      </div>

      {geoError ? (
        <div style={{ marginTop: 10, background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: "10px 12px", fontSize: 12, fontWeight: 800 }}>
          {geoError}
        </div>
      ) : null}

      {outsideServiceArea ? (
        <div role="alert" style={{ marginTop: 10, background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: "10px 12px", fontSize: 12, fontWeight: 850 }}>
          POMICH зараз працює в Україні. Перемістіть маркер на точку в Україні, щоб створити заявку.
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        {isTelegram ? null : <PrimaryButton label="Підтвердити місце" onClick={onNext} disabled={outsideServiceArea} />}
      </div>
      </div>
    </RideScreen>
  )
}
