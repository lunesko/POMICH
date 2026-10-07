import ProviderAuthStep from "./steps/ProviderAuthStep"
import ProviderVerifyStep from "./steps/ProviderVerifyStep"
import ProviderRegisterStep from "./steps/ProviderRegisterStep"
import ProviderDutyStep from "./steps/ProviderDutyStep"
import ProviderCompletedStep from "./steps/ProviderCompletedStep"
import ProviderAwaitingPriceStep from "./steps/ProviderAwaitingPriceStep"
import ProviderArrivedStep from "./steps/ProviderArrivedStep"
import ProviderNavigationStep from "./steps/ProviderNavigationStep"
import ProviderOfferStep from "./steps/ProviderOfferStep"
import ProviderFallbackStep from "./steps/ProviderFallbackStep"
import type { ProviderFlowState } from "./hooks/useProviderFlowController"

export default function ProviderFlowView({ state }: { state: ProviderFlowState }) {
 const { providerAuthToken, providerToken, step, activeOffer } = state
  if (!providerAuthToken && !providerToken) return <ProviderAuthStep state={state} />
  if (step === "verify") return <ProviderVerifyStep state={state} />
  if (step === "register") return <ProviderRegisterStep state={state} />
  if (step === "duty") return <ProviderDutyStep state={state} />
  if (step === "completed") return <ProviderCompletedStep state={state} />
  if (step === "awaiting_price") return <ProviderAwaitingPriceStep state={state} />
  if (step === "arrived") return <ProviderArrivedStep state={state} />
  if (step === "navigation") return <ProviderNavigationStep state={state} />
  if (step === "offer" && activeOffer) return <ProviderOfferStep state={state} />
  return <ProviderFallbackStep state={state} />
}
