import { OrderFinalStep } from "../../customer/OrderTerminalStep"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"

export default function ProviderCompletedStep({ state }: { state: ProviderFlowState }) {
  const { onLogout, step, activeOrder, providerLocation, partnerReviewSaving, partnerReviewError, partnerReviewSubmitted, returnToDuty, submitPartnerOrderReview } = state
  if (step === "completed") {
    const partnerReviewDone = partnerReviewSubmitted || Boolean(activeOrder?.partnerReview?.rating)
    const completedPickup = activeOrder?.customerCoordinates ?? providerLocation
    const completedDestination = activeOrder?.destinationCoordinates
    return (
      <OrderFinalStep
        orderId={activeOrder?.id}
        status="completed"
        order={activeOrder}
        pickup={completedPickup}
        destination={completedDestination}
        onRestart={returnToDuty}
        onLogout={onLogout}
        showAction
        reviewMode="partner"
        reviewSaving={partnerReviewSaving}
        reviewError={partnerReviewError}
        reviewSubmitted={partnerReviewDone}
        onSubmitReview={submitPartnerOrderReview}
      />
    )
  }
return null
}
