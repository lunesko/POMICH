import useProviderFlowController from "./hooks/useProviderFlowController"
import ProviderFlowView from "./ProviderFlowView"

export default function ProviderFlow({
  providerToken,
  providerRegistered = false,
  initialScreen,
  onLogout,
  onRestoreAccount,
}: {
  providerToken?: string
  providerRegistered?: boolean
  /** Deep link from Telegram bot buttons: duty / offers / verify. */
  initialScreen?: "duty" | "offers" | "verify"
  onLogout?: () => void
  onRestoreAccount?: () => void
}) {
  const state = useProviderFlowController({ providerToken, providerRegistered, initialScreen, onLogout, onRestoreAccount })
  return <ProviderFlowView state={state} />
}
