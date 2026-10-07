import { useState } from "react"
import {
  type CustomerProfile,
  type ProviderAvailability,
} from "../../../api/client"
import { RideScreen } from "../../layout/RideScreen"
import {
  type ServiceKey,
} from "../../../lib/pomichDomain"
import {
  isCustomerProfileComplete,
  isCustomerReadyForOrder,
} from "../../../lib/customerProfile"
import {
  homeProblemCards,
  nearbyProvidersFor,
  homeOtherProblemCards,
  type Point,
} from "../../../lib/constants"
import {
  BRAND,
  CARD,
  GHOST,
  SELECTED,
  SURFACE_TONE,
} from "../customerFlowTokens"
import {
  LocationRow,
  SheetDivider,
  CurrentLocationCard,
  AvailabilityPanel,
  CustomerTrustPanel,
  StepBadge,
} from "../customerFlowUi"

import { OtpVerificationPanel } from "../../ui/OtpVerificationPanel"
import { CitySelect } from "../../ui/CitySelect"
export default function HomeStep({
  pickup,
  locationLabel,
  serviceCity,
  providers,
  providersLoading,
  customerProfile,
  customerVerificationSaving,
  customerVerificationError,
  customerToken,
  isTelegram,
  geoLoading,
  geoError,
  recenterTrigger,
  geoSpeedMps = null,
  onProfileChange,
  onVerifyCustomer,
  onProfileVerified,
  onRetryGeo,
  onOpenGeoSettings,
  onServiceCityChange,
  onSelect,
}: {
  pickup: Point
  locationLabel: string
  serviceCity: string
  providers: ProviderAvailability[]
  providersLoading: boolean
  customerProfile: CustomerProfile
  customerVerificationSaving: boolean
  customerVerificationError?: string
  customerToken?: string
  isTelegram?: boolean
  geoLoading: boolean
  geoError?: string
  recenterTrigger: number
  geoSpeedMps?: number | null
  onProfileChange: (patch: Partial<CustomerProfile>) => void
  onVerifyCustomer: () => void
  onProfileVerified: (profile: CustomerProfile) => void
  onRetryGeo: () => void
  onOpenGeoSettings?: () => void
  onServiceCityChange: (city: string) => void
  onSelect: (service: ServiceKey) => void
}) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const profileReady = isCustomerReadyForOrder(customerProfile)
  const [showOtherProblems, setShowOtherProblems] = useState(false)

  const handleSelect = (service: ServiceKey) => {
    if (!profileReady) return
    onSelect(service)
  }

  const problemGrid = (
    <div className="pomich-problem-grid">
      {homeProblemCards.map((card, index) => (
        <button
          key={card.key}
          type="button"
          onClick={() => handleSelect(card.key)}
          disabled={!profileReady}
          className="pomich-problem-card"
          style={{ animationDelay: `${index * 50}ms`, opacity: profileReady ? 1 : 0.72 }}
        >
          <span className="pomich-problem-card__emoji" aria-hidden="true">
            {card.emoji}
          </span>
          <span className="pomich-problem-card__label">{card.label}</span>
          <span className="pomich-problem-card__hint">{card.hint}</span>
        </button>
      ))}
    </div>
  )

  return (
    <RideScreen
      pickup={pickup}
      providers={nearby}
      showDirectoryProviders={false}
      mapSubtitle={locationLabel}
      defaultSnap="collapsed"
      recenterTrigger={recenterTrigger}
      geoSpeedMps={geoSpeedMps}
      onRetryGeo={onRetryGeo}
      geoLoading={geoLoading}
      geoError={geoError}
    >
      <div data-sheet-full className="pomich-home-sheet">
        <div className="pomich-home-sheet__intro">
          <StepBadge step={1} label="Оберіть проблему" />
          <h2 className="pomich-home-sheet__title">Що сталося?</h2>
          <p className="pomich-home-sheet__subtitle">Оберіть проблему — підтвердимо місце і знайдемо партнера поруч.</p>
        </div>

        <div className="pomich-sheet-section-head">
          <div className="pomich-sheet-section-title">Швидка допомога</div>
          <div className="pomich-sheet-badge" style={{ background: nearby.length > 0 ? SELECTED : "var(--pomich-warn-bg)", color: nearby.length > 0 ? BRAND : "var(--pomich-warn-text)" }}>
            {nearby.length > 0 ? `${nearby.length} поруч` : "підберемо"}
          </div>
        </div>

        {problemGrid}

        <div className="pomich-problem-other">
          <button
            type="button"
            className="pomich-problem-other__toggle"
            aria-expanded={showOtherProblems}
            onClick={() => setShowOtherProblems((open) => !open)}
          >
            Інша проблема
            <span aria-hidden="true">{showOtherProblems ? "▴" : "▾"}</span>
          </button>
          {showOtherProblems ? (
            <div className="pomich-flow-stack" style={{ marginTop: 6 }}>
              {homeOtherProblemCards.map((card) => (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => handleSelect(card.key)}
                  disabled={!profileReady}
                  className="pomich-service-row"
                  style={{ background: profileReady ? CARD : GHOST, opacity: profileReady ? 1 : 0.7 }}
                >
                  <span className="pomich-service-row__icon" style={{ background: SURFACE_TONE }}>
                    <span aria-hidden="true">{card.emoji}</span>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="pomich-service-row__label">{card.label}</span>
                    <span className="pomich-service-row__hint">{card.hint}</span>
                  </span>
                  <span className="pomich-service-row__chevron" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!profileReady ? (
          <div style={{ background: "var(--pomich-info-bg)", color: "var(--pomich-info-text)", borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 800 }}>
            {isCustomerProfileComplete(customerProfile)
              ? "Підтвердіть телефон кодом, щоб викликати допомогу."
              : "Вкажіть ім'я та телефон нижче — потім можна викликати допомогу."}
          </div>
        ) : null}

        {!profileReady ? (
          isCustomerProfileComplete(customerProfile) ? (
            <OtpVerificationPanel
              profile={customerProfile}
              customerToken={customerToken}
              isTelegram={isTelegram}
              compact
              onVerified={onProfileVerified}
            />
          ) : (
            <CustomerTrustPanel profile={customerProfile} saving={customerVerificationSaving} error={customerVerificationError} customerToken={customerToken} isTelegram={isTelegram} onChange={onProfileChange} onVerify={onVerifyCustomer} onVerified={onProfileVerified} />
          )
        ) : null}

        <div className="pomich-home-sheet__meta">
          <CurrentLocationCard
            locationLabel={locationLabel}
            geoLoading={geoLoading}
            geoError={geoError}
            onRefreshGeo={onRetryGeo}
            onOpenGeoSettings={geoError ? onOpenGeoSettings : undefined}
          >
            <SheetDivider />
            <div className="pomich-location-hint" aria-disabled="true">
              <LocationRow icon="🏁" title="Куди везти або де ремонтувати" subtitle="Уточнимо після вибору послуги" />
            </div>
          </CurrentLocationCard>

          <CitySelect
            id="pomich-customer-home-city"
            value={serviceCity}
            onChange={onServiceCityChange}
            label="Місто сервісу"
          />

          <AvailabilityPanel pickup={pickup} providers={providers} loading={providersLoading} />
        </div>
      </div>

      <div data-sheet-peek>
        <div className="pomich-sheet-section-head" style={{ marginTop: 0, marginBottom: 0 }}>
          <div className="pomich-sheet-section-title" style={{ fontSize: "0.95rem" }}>Що сталося?</div>
          <div className="pomich-sheet-badge" style={{ background: nearby.length > 0 ? SELECTED : "var(--pomich-warn-bg)", color: nearby.length > 0 ? BRAND : "var(--pomich-warn-text)" }}>
            {nearby.length > 0 ? `${nearby.length} поруч` : "підберемо"}
          </div>
        </div>
        <div className="pomich-problem-grid pomich-problem-grid--peek">
          {homeProblemCards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => handleSelect(card.key)}
              disabled={!profileReady}
              className="pomich-problem-card pomich-problem-card--peek"
              style={{ opacity: profileReady ? 1 : 0.72 }}
            >
              <span className="pomich-problem-card__emoji" aria-hidden="true">{card.emoji}</span>
              <span className="pomich-problem-card__label">{card.label}</span>
            </button>
          ))}
        </div>
      </div>
    </RideScreen>
  )
}
