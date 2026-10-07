import { IncomingOfferStep } from "../IncomingOfferStep"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"

export default function ProviderOfferStep({ state }: { state: ProviderFlowState }) {
  const { step, offerError, offerSaving, proposedPrice, priceNote, setPriceNote, providerLocation, activeOffer, secondsLeft, handleOfferAcceptBlocked, syncProposedPrice, acceptOffer, declineOffer } = state
  if (step === "offer" && activeOffer) {
    return (
      <IncomingOfferStep
        offer={activeOffer}
        providerLocation={providerLocation}
        secondsLeft={secondsLeft}
        saving={offerSaving}
        error={offerError}
        proposedPrice={proposedPrice}
        priceNote={priceNote}
        onProposedPriceChange={syncProposedPrice}
        onPriceNoteChange={setPriceNote}
        onAccept={(price) => void acceptOffer(activeOffer, price)}
        onDecline={() => void declineOffer(activeOffer)}
        onAcceptBlocked={handleOfferAcceptBlocked}
      />
    )
  }
return null
}
