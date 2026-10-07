import { AccountLoginStep } from "../../views/AccountLoginStep"
import { ProviderRegistrationStep } from "../../views/ProviderRegistrationStep"
import type { ProviderFlowState } from "../hooks/useProviderFlowController"

export default function ProviderAuthStep({ state }: { state: ProviderFlowState }) {
  const { providerToken, providerRegistered, onRestoreAccount, providerAuthToken, authError, setAuthError, accountLogin, setAccountLogin, accountPassword, setAccountPassword, authSaving, loginView, setLoginView, registrationSaving, registrationError, registrationForm, customerIdForOtp, customerTokenForOtp, updateRegistrationForm, toggleRegistrationSpecialty, saveRegistration, completingPartnerProfile, submitProviderAccountLogin, openPartnerRestoreOrLogin } = state
  if (!providerAuthToken && !providerToken) {
    // Returning partner (server/account flag): wait for customer→provider self-session.
    // Do not use localStorage alone — that stuck first-time Mini App opens on an endless boot screen.
    if (providerRegistered && customerIdForOtp && customerTokenForOtp) {
      return <div className="pomich-boot-screen">Завантажуємо кабінет партнера…</div>
    }
    // Phone OTP restore / registration first — password login is a Mini App dead-end.
    if (loginView === "register" || onRestoreAccount) {
      return (
        <ProviderRegistrationStep
          form={registrationForm}
          saving={registrationSaving}
          error={registrationError}
          completingProfile={completingPartnerProfile}
          onChange={updateRegistrationForm}
          onToggleSpecialty={toggleRegistrationSpecialty}
          onSubmit={saveRegistration}
          onLogin={openPartnerRestoreOrLogin}
        />
      )
    }

    return (
      <AccountLoginStep
        title="Вхід партнера"
        subtitle="Увійдіть у свій акаунт POMICH, щоб бачити заявки та оновлювати статуси."
        login={accountLogin}
        password={accountPassword}
        saving={authSaving}
        error={authError}
        onLoginChange={setAccountLogin}
        onPasswordChange={setAccountPassword}
        onSubmit={submitProviderAccountLogin}
        showThemeToggle={false}
        onRegister={() => {
          setAuthError(undefined)
          setLoginView("register")
        }}
      />
    )
  }
return null
}
