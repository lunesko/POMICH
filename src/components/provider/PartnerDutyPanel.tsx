import { PrimaryButton } from "../ui/PrimaryButton"
import { SecondaryButton } from "../ui/SecondaryButton"
import { DutyStatusToggle } from "../ui/DutyStatusToggle"

export type PartnerDutyPanelMode = "peek" | "full"

type PartnerDutyPanelProps = {
  mode: PartnerDutyPanelMode
  onDuty: boolean
  presenceSaving: boolean
  mapRequestCount: number
  activeOfferCount: number
  ctaLabel: string
  authError?: string
  offerBanner?: string
  offerError?: string
  onToggleDuty: () => void
  onPrimaryAction: () => void
  onLeaveDuty?: () => void
  onRefreshMap?: () => void
  showLeaveDuty?: boolean
  showRefresh?: boolean
  primaryDisabled?: boolean
}

export default function PartnerDutyPanel({
  mode,
  onDuty,
  presenceSaving,
  mapRequestCount,
  activeOfferCount,
  ctaLabel,
  authError,
  offerBanner,
  offerError,
  onToggleDuty,
  onPrimaryAction,
  onLeaveDuty,
  onRefreshMap,
  showLeaveDuty = false,
  showRefresh = false,
  primaryDisabled = false,
}: PartnerDutyPanelProps) {
  const isPeek = mode === "peek"
  const statusLabel = onDuty ? "На лінії" : "Поза лінією"
  const hint = onDuty ? "Заявки поруч на карті" : "Увімкніть лінію, щоб бачити заявки"

  return (
    <div className={`pomich-duty-panel${isPeek ? " pomich-duty-panel--peek" : ""}`}>
      <div className="pomich-duty-panel__head">
        <div className="pomich-duty-panel__titles">
          <div className="pomich-duty-panel__eyebrow">Партнер POMICH</div>
          <div className="pomich-duty-panel__status-row">
            <span className={`pomich-duty-panel__dot${onDuty ? " is-on" : ""}`} aria-hidden="true" />
            <div className="pomich-duty-panel__status">{statusLabel}</div>
          </div>
          <div className="pomich-duty-panel__hint">{hint}</div>
        </div>
        <DutyStatusToggle onDuty={onDuty} saving={presenceSaving} disabled={presenceSaving} onToggle={onToggleDuty} />
      </div>

      <div className="pomich-duty-panel__metrics" aria-label="Показники зміни">
        <div className="pomich-duty-metric">
          <span className="pomich-duty-metric__label">Заявки на карті</span>
          <strong className="pomich-duty-metric__value">{mapRequestCount}</strong>
        </div>
        <div className="pomich-duty-metric">
          <span className="pomich-duty-metric__label">Активних пропозицій</span>
          <strong className="pomich-duty-metric__value">{activeOfferCount}</strong>
        </div>
      </div>

      {offerBanner ? <div className="pomich-duty-panel__banner pomich-duty-panel__banner--warn">{offerBanner}</div> : null}
      {authError ? <div className="pomich-duty-panel__banner pomich-duty-panel__banner--error">{authError}</div> : null}
      {offerError ? <div className="pomich-duty-panel__banner pomich-duty-panel__banner--warn">{offerError}</div> : null}

      <div className="pomich-duty-panel__actions">
        <PrimaryButton label={ctaLabel} onClick={onPrimaryAction} disabled={primaryDisabled || presenceSaving} />
        {showRefresh && onRefreshMap ? (
          <SecondaryButton label="Оновити карту" onClick={onRefreshMap} disabled={presenceSaving} />
        ) : null}
        {showLeaveDuty && onLeaveDuty ? (
          <SecondaryButton label="Піти з лінії" onClick={onLeaveDuty} disabled={presenceSaving} />
        ) : null}
      </div>
    </div>
  )
}
