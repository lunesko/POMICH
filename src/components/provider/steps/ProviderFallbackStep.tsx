import { getProviderOffers, getNearbyMapOrders } from "../../../api/client"
import { RideScreen } from "../../layout/RideScreen"
import { DEFAULT_SERVICE_RADIUS_KM } from "../../../lib/constants"
import { readAuthSessionSubject } from "../../../lib/auth"
import PartnerDutyPanel from "../PartnerDutyPanel"
import { filterVisibleOffers, isPresentableOffer } from "../../../lib/dispatchOffer"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"

export default function ProviderFallbackStep({ state }: { state: ProviderFlowState }) {
  const { providerId, providerAuthToken, dutySheetSnap, onDuty, presenceSaving, incomingOffers, setIncomingOffers, setNearbyRequestPins, mapRequestPins, offerClock, providerLocation, providerGeoLoading, providerGeoError, providerRecenterTrigger, providerSpeedMps, providerProfile, registrationForm, dismissedOfferIdsRef, dismissedOrderIdsRef, providerPresence, isPartnerRegisteredAndCompleted, providerCanGoOnline, retryProviderGeolocation, openOfferDetail, openRequestPin, acceptFromMapPin, contactFromMapPin, setDuty, handleDutyToggle, openPhoneOrProfileGate } = state
  {
    const fallbackOfferCount = incomingOffers.filter((offer) => isPresentableOffer(offer, offerClock)).length
    const fallbackOffer = incomingOffers.find((offer) => isPresentableOffer(offer, offerClock))
    const fallbackCta = !isPartnerRegisteredAndCompleted
      ? "Завершити профіль"
      : !providerCanGoOnline
        ? "Підтвердити телефон"
        : presenceSaving
          ? "Оновлюємо статус…"
          : onDuty
            ? fallbackOffer
              ? "Відкрити заявку"
              : "Оновити карту"
            : "Вийти на лінію"
    const fallbackPrimary = () => {
      if (!isPartnerRegisteredAndCompleted || !providerCanGoOnline) {
        openPhoneOrProfileGate()
        return
      }
      if (onDuty) {
        if (fallbackOffer) {
          openOfferDetail(fallbackOffer)
          return
        }
        const subjectId = readAuthSessionSubject(providerAuthToken || "") || providerId
        if (providerAuthToken) {
          getProviderOffers(subjectId, providerAuthToken)
            .then((offers) => {
              setIncomingOffers(filterVisibleOffers(Array.isArray(offers) ? offers : [], {
                dismissedOfferIds: dismissedOfferIdsRef.current,
                dismissedOrderIds: dismissedOrderIdsRef.current,
              }))
            })
            .catch(() => undefined)
          const radiusKm = providerProfile.serviceRadiusKm ?? registrationForm.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM
          getNearbyMapOrders(providerLocation.lat, providerLocation.lng, radiusKm, undefined, providerAuthToken)
            .then((orders) => setNearbyRequestPins(Array.isArray(orders) ? orders : []))
            .catch(() => undefined)
        }
        return
      }
      void setDuty(true)
    }
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
              activeOfferCount={fallbackOfferCount}
              ctaLabel={fallbackCta}
              onToggleDuty={handleDutyToggle}
              onPrimaryAction={fallbackPrimary}
              primaryDisabled={presenceSaving}
            />
          </div>
          <div data-sheet-full>
            <PartnerDutyPanel
              mode="full"
              onDuty={onDuty}
              presenceSaving={presenceSaving}
              mapRequestCount={mapRequestPins.length}
              activeOfferCount={fallbackOfferCount}
              ctaLabel={fallbackCta}
              onToggleDuty={handleDutyToggle}
              onPrimaryAction={fallbackPrimary}
              primaryDisabled={presenceSaving}
            />
          </div>
        </RideScreen>
      </>
    )
  }
}
