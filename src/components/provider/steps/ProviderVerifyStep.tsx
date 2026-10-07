import ScreenLayout from "./ScreenLayout"
import Header from "./Header"
import { type CustomerProfile } from "../../../api/client"
import { OtpVerificationPanel } from "../../ui/OtpVerificationPanel"
import FormContainer from "../../layout/FormContainer"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"

export default function ProviderVerifyStep({ state }: { state: ProviderFlowState }) {
  const { providerId, step, setStep, providerProfile, setProviderProfile, registrationForm, setRegistrationForm, telegramContext, otpBotUsername, customerIdForOtp, customerTokenForOtp, customerOtpProfile, setCustomerOtpProfile, profileGateOpenRef, markProviderPhoneVerified, loadCurrentProvider } = state
  if (step === "verify") {
    const otpProfile: CustomerProfile = customerOtpProfile ?? {
      id: customerIdForOtp || providerId,
      name: providerProfile.name || registrationForm.name,
      phone: providerProfile.phone || registrationForm.phone,
      verificationStatus: providerProfile.verificationStatus,
    }
    return (
      <ScreenLayout className="pomich-screen-layout--form">
        <Header
          title="Підтвердження телефону"
          subtitle="Спочатку телефон, потім код з Telegram"
          showThemeToggle={false}
          compactToggle
          onBack={() => {
            profileGateOpenRef.current = false
            setStep("duty")
          }}
        />
        <FormContainer>
          <div className="pomich-form-card">
            <OtpVerificationPanel
              profile={otpProfile}
              customerToken={customerTokenForOtp}
              isTelegram={telegramContext.isTelegram}
              telegramBotUsername={otpBotUsername}
              telegramBotKind={telegramContext.botKind}
              verifiedActionLabel="Вийти на лінію"
              phone={otpProfile.phone}
              onPhoneSaved={(savedPhone) => {
                setRegistrationForm((form) => ({ ...form, phone: savedPhone }))
                setProviderProfile((profile) => ({ ...profile, phone: savedPhone }))
              }}
              onVerified={async (saved) => {
                if (saved) setCustomerOtpProfile(saved)
                const currentProvider = await loadCurrentProvider()
                markProviderPhoneVerified(currentProvider)
                setStep("duty")
              }}
            />
          </div>
        </FormContainer>
      </ScreenLayout>
    )
  }
return null
}
