import { RideScreen } from "../../layout/RideScreen"
import {
  serviceRequiresDestination,
  type ServiceKey,
  ON_SITE_DESTINATION_LABEL,
} from "../../../lib/pomichDomain"
import {
  type Point,
} from "../../../lib/constants"
import {
  serviceDetailRows,
  type ServiceDetails,
} from "../../../lib/serviceDetails"
import {
  BORDER,
  MUTED,
  SURFACE_TONE,
  SUBTLE,
} from "../customerFlowTokens"
import {
  PrimaryButton,
  StepBack,
  SheetHeading,
  LocationRow,
  SheetDivider,
  StepBadge,
} from "../customerFlowUi"

export default function ReviewStep({
  serviceLabel,
  serviceKey,
  addressLabel,
  destination,
  pickup,
  destinationPoint,
  serviceDetails,
  customerComment,
  onCustomerCommentChange,
  loading,
  isTelegram,
  onConfirm,
  onBack
}: {
  serviceLabel: string
  serviceKey: ServiceKey
  addressLabel: string
  destination: string
  pickup: Point
  destinationPoint: Point
  serviceDetails: ServiceDetails
  customerComment: string
  onCustomerCommentChange: (value: string) => void
  loading: boolean
  isTelegram?: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const showDestination = serviceRequiresDestination(serviceKey) && Boolean(destination.trim())
  const onSiteLabel = !serviceRequiresDestination(serviceKey)
  const detailRows = serviceDetailRows(serviceDetails)
  const totalSteps = serviceRequiresDestination(serviceKey) ? 5 : 4

  return (
    <RideScreen
      pickup={pickup}
      destination={onSiteLabel ? pickup : destinationPoint}
      mapSubtitle="Перевірка заявки"
    >
      <StepBadge step={totalSteps} total={totalSteps} label="Перевірте заявку" />
      <StepBack onBack={onBack} hide={isTelegram} />
      <SheetHeading title="Перевірте заявку" subtitle="Ціну та час прибуття побачите після того, як партнер прийме заявку." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: SURFACE_TONE }}>
        <LocationRow icon="🛠️" title="Послуга" subtitle={serviceLabel} active />
        <SheetDivider />
        <LocationRow icon="📍" title="Де ви" subtitle={addressLabel} />
        {showDestination ? (
          <>
            <SheetDivider />
            <LocationRow icon="🏁" title="Куди" subtitle={destination} />
          </>
        ) : onSiteLabel ? (
          <>
            <SheetDivider />
            <LocationRow icon="🛠️" title="Куди" subtitle={ON_SITE_DESTINATION_LABEL} />
          </>
        ) : null}
        {detailRows.length > 0 ? <SheetDivider /> : null}
        {detailRows.map((row, index) => (
          <div key={row.label}>
            {index > 0 ? <SheetDivider /> : null}
            <LocationRow icon={index === 0 ? "🚗" : "·"} title={row.label} subtitle={row.value} />
          </div>
        ))}
      </div>

      <label className="pomich-form-field" style={{ marginTop: 14 }}>
        <span style={{ color: MUTED, fontSize: "var(--pomich-text-xs)", fontWeight: 850 }}>Коментар до заявки (необов&apos;язково)</span>
        <textarea
          value={customerComment}
          onChange={(event) => onCustomerCommentChange(event.target.value.slice(0, 500))}
          onFocus={(event) => {
            if (typeof event.target?.scrollIntoView === "function") {
              setTimeout(() => event.target.scrollIntoView({ behavior: "smooth", block: "center" }), 150)
            }
          }}
          placeholder="Наприклад: авто на паркінгу біля входу, ключі в салоні…"
          maxLength={500}
          className="pomich-comment-field"
        />
        <span style={{ color: SUBTLE, fontSize: "var(--pomich-text-xs)", fontWeight: 700, textAlign: "right" }}>{customerComment.length}/500</span>
      </label>

      <div style={{ marginTop: 12, background: "var(--pomich-info-bg)", color: "var(--pomich-info-text)", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
        Після надсилання заявки перевірені партнери побачать ваше місцезнаходження, відстань і зможуть прийняти її.
      </div>

      <div style={{ marginTop: 16 }}>
        {isTelegram ? null : <PrimaryButton label="Надіслати заявку" onClick={onConfirm} loading={loading} disabled={loading} />}
      </div>
    </RideScreen>
  )
}
