import { ProviderRegistrationStep } from "../../views/ProviderRegistrationStep"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"

export default function ProviderRegisterStep({ state }: { state: ProviderFlowState }) {
  const { onRestoreAccount, linkedPartnerId, effectiveProviderRegistered, step, setStep, registrationSaving, registrationError, registrationForm, profileGateOpenRef, updateRegistrationForm, toggleRegistrationSpecialty, saveRegistration, completingPartnerProfile, openPartnerRestoreOrLogin } = state
  if (step === "register") {
    return (
      <ProviderRegistrationStep
        form={registrationForm}
        saving={registrationSaving}
        error={registrationError}
        completingProfile={completingPartnerProfile}
        onChange={updateRegistrationForm}
        onToggleSpecialty={toggleRegistrationSpecialty}
        onSubmit={saveRegistration}
        onLogin={onRestoreAccount ? openPartnerRestoreOrLogin : undefined}
        onBack={completingPartnerProfile || effectiveProviderRegistered || Boolean(linkedPartnerId)
          ? () => {
              profileGateOpenRef.current = false
              setStep("duty")
            }
          : undefined}
      />
    )
  }
return null
}
