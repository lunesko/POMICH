import { getProviderOffers, getNearbyMapOrders } from "../../../api/client"
import { RideScreen } from "../../layout/RideScreen"
import { DEFAULT_SERVICE_RADIUS_KM } from "../../../lib/constants"
import { readAuthSessionSubject } from "../../../lib/auth"
import { PresenceToast } from "../../ui/DutyStatusToggle"
import PartnerDutyPanel from "../PartnerDutyPanel"
import { OrderRequestSheet } from "../OrderRequestSheet"
import { filterVisibleOffers, isPresentableOffer } from "../../../lib/dispatchOffer"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"

export default function ProviderDutyStep({ state }: { state: ProviderFlowState }) {
  const { providerId, providerAuthToken, authError, step, dutySheetSnap, onDuty, presenceSaving, presenceToast, incomingOffers, setIncomingOffers, setNearbyRequestPins, mapRequestPins, selectedRequestPin, setSelectedRequestPin, offerError, setOfferError, offerSaving, proposedPrice, offerClock, providerLocation, providerGeoLoading, providerGeoError, providerRecenterTrigger, providerSpeedMps, providerProfile, registrationForm, dismissedOfferIdsRef, dismissedOrderIdsRef, providerPresence, isPartnerRegisteredAndCompleted, providerCanGoOnline, retryProviderGeolocation, activeOffer, secondsLeft, openOfferDetail, handleOfferAcceptBlocked, syncProposedPrice, openRequestPin, declineFromSheet, acceptFromMapPin, acceptFromSheet, contactFromMapPin, setDuty, handleDutyToggle, openPhoneOrProfileGate } = state
  if (step === "duty") {
    const activeOfferCount = incomingOffers.filter((offer) => isPresentableOffer(offer, offerClock)).length
    const dutyCtaLabel = !isPartnerRegisteredAndCompleted
      ? "Завершити профіль"
      : !providerCanGoOnline
        ? "Підтвердити телефон"
        : presenceSaving
          ? "Оновлюємо статус…"
          : onDuty
            ? activeOffer
              ? offerSaving
                ? "Приймаємо…"
                : "Відкрити заявку"
              : "Оновити карту"
            : "Вийти на лінію"
    const refreshNearby = () => {
      const subjectId = readAuthSessionSubject(providerAuthToken || "") || providerId
      if (!providerAuthToken) return
      getProviderOffers(subjectId, providerAuthToken)
        .then((offers) => {
          setIncomingOffers(filterVisibleOffers(Array.isArray(offers) ? offers : [], {
            dismissedOfferIds: dismissedOfferIdsRef.current,
            dismissedOrderIds: dismissedOrderIdsRef.current,
          }))
          setOfferError(undefined)
        })
        .catch(() => setOfferError("Не вдалося оновити пропозиції. Спробуйте ще раз."))
      const radiusKm = providerProfile.serviceRadiusKm ?? registrationForm.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM
      getNearbyMapOrders(providerLocation.lat, providerLocation.lng, radiusKm, undefined, providerAuthToken)
        .then((orders) => setNearbyRequestPins(Array.isArray(orders) ? orders : []))
        .catch(() => setOfferError("Не вдалося оновити карту заявок. Спробуйте ще раз."))
    }
    const onDutyPrimary = () => {
      if (!isPartnerRegisteredAndCompleted || !providerCanGoOnline) {
        openPhoneOrProfileGate()
        return
      }
      if (onDuty) {
        if (activeOffer) {
          openOfferDetail(activeOffer)
          return
        }
        refreshNearby()
        return
      }
      void setDuty(true)
    }
    const offerBanner = activeOffer
      ? `Нова заявка · ${secondsLeft > 0 ? `${secondsLeft} сек` : "час вийшов"}`
      : undefined
    const panelOfferError =
      offerError && offerError !== "Вкажіть вартість послуги в гривнях." ? offerError : undefined

    return (
      <>
      <RideScreen
        pickup={providerLocation}
        providers={onDuty ? [providerPresence] : []}
        requestPins={mapRequestPins}
        mapSubtitle={onDuty ? `На лінії · ${mapRequestPins.length} заявок поруч` : "Україна · партнер"}
        showAllProviders={false}
        showDirectoryProviders={false}
        expandedSheet={dutySheetSnap === "expanded"}
        defaultSnap={dutySheetSnap}
        onAcceptRequest={acceptFromMapPin}
        onContactRequest={contactFromMapPin}
        onRequestPinSelect={openRequestPin}
        onRetryGeo={retryProviderGeolocation}
        geoLoading={providerGeoLoading}
        geoError={providerGeoError}
        recenterTrigger={providerRecenterTrigger}
        geoSpeedMps={providerSpeedMps}
        fitSheetToContent
      >
        <div data-sheet-peek>
          <PartnerDutyPanel
            mode="peek"
            onDuty={onDuty}
            presenceSaving={presenceSaving}
            mapRequestCount={mapRequestPins.length}
            activeOfferCount={activeOfferCount}
            ctaLabel={dutyCtaLabel}
            offerBanner={offerBanner}
            onToggleDuty={handleDutyToggle}
            onPrimaryAction={onDutyPrimary}
            primaryDisabled={offerSaving}
          />
        </div>
        <div data-sheet-full>
          <PartnerDutyPanel
            mode="full"
            onDuty={onDuty}
            presenceSaving={presenceSaving}
            mapRequestCount={mapRequestPins.length}
            activeOfferCount={activeOfferCount}
            ctaLabel={dutyCtaLabel}
            authError={authError}
            offerBanner={offerBanner ? `${offerBanner} — відкрийте деталі` : undefined}
            offerError={panelOfferError}
            onToggleDuty={handleDutyToggle}
            onPrimaryAction={onDutyPrimary}
            primaryDisabled={offerSaving}
          />
        </div>
        {presenceToast ? <PresenceToast message={presenceToast} /> : null}
      </RideScreen>
      {selectedRequestPin ? (
        <OrderRequestSheet
          pin={selectedRequestPin}
          proposedPrice={proposedPrice}
          saving={offerSaving}
          error={offerError}
          secondsLeft={secondsLeft}
          onProposedPriceChange={syncProposedPrice}
          onAccept={(price) => void acceptFromSheet(price)}
          onDecline={() => void declineFromSheet()}
          onClose={() => {
            setSelectedRequestPin(undefined)
            setOfferError(undefined)
          }}
          onAcceptBlocked={handleOfferAcceptBlocked}
        />
      ) : null}
      </>
    )
  }
return null
}
