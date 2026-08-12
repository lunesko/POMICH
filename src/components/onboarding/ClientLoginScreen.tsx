import { useEffect, useState } from "react"



import {

  confirmCustomerPhoneLoginCode,

  messageFromFetchError,

  sendCustomerPhoneLoginCode,

  type AuthSession,

} from "../../api/client"

import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"

import { OnboardingFormShell } from "../layout/OnboardingFormShell"

import { PhoneInput } from "../ui/PhoneInput"

import { PrimaryButton } from "../ui/PrimaryButton"

import { ThemeToggle } from "../ui/ThemeToggle"



interface ClientLoginScreenProps {

  saving?: boolean

  error?: string

  onSubmit: (session: AuthSession) => void

  onRegister: () => void

  onBack?: () => void

}



function formatCountdown(seconds: number): string {

  const mins = Math.floor(seconds / 60)

  const secs = seconds % 60

  return `${mins}:${secs.toString().padStart(2, "0")}`

}



function LoginScreenHeader({ onBack }: { onBack?: () => void }) {

  return (

    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>

      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>

        {onBack ? (

          <button type="button" onClick={onBack} className="pomich-back-btn" aria-label="Назад">←</button>

        ) : null}

        <div>

          <div className="pomich-header-title">Увійти</div>

          <div className="pomich-header-subtitle">Код надійде у Telegram за номером телефону</div>

        </div>

      </div>

      <ThemeToggle compact />

    </div>

  )

}



export default function ClientLoginScreen({ saving, error: externalError, onSubmit, onRegister, onBack }: ClientLoginScreenProps) {

  const [phone, setPhone] = useState("")

  const [code, setCode] = useState("")

  const [phoneError, setPhoneError] = useState<string>()

  const [error, setError] = useState<string>()

  const [sending, setSending] = useState(false)

  const [confirming, setConfirming] = useState(false)

  const [expiresAt, setExpiresAt] = useState<string>()

  const [countdown, setCountdown] = useState(0)

  const [codeSent, setCodeSent] = useState(false)



  const phoneValidation = validateUkraineMobilePhone(phone)

  const canSend = phoneValidation.valid

  const canConfirm = code.trim().length === 6 && canSend



  useEffect(() => {

    if (!expiresAt) {

      setCountdown(0)

      return

    }

    const tick = () => {

      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))

      setCountdown(remaining)

    }

    tick()

    const timer = window.setInterval(tick, 1000)

    return () => window.clearInterval(timer)

  }, [expiresAt])



  const handleSendCode = async () => {

    const validation = validateUkraineMobilePhone(phone)

    if (!validation.valid) {

      setPhoneError(validation.error)

      return

    }

    setPhoneError(undefined)

    setError(undefined)

    setSending(true)

    try {

      const response = await sendCustomerPhoneLoginCode(validation.e164)

      setExpiresAt(response.expiresAt)

      setCodeSent(true)

      setCode("")

    } catch (err) {

      setError(messageFromFetchError(err, "Не вдалося надіслати код. Спробуйте ще раз."))

    } finally {

      setSending(false)

    }

  }



  const handleConfirm = async () => {

    const validation = validateUkraineMobilePhone(phone)

    if (!validation.valid) {

      setPhoneError(validation.error)

      return

    }

    if (code.trim().length !== 6) {

      setError("Введіть 6-значний код.")

      return

    }

    setError(undefined)

    setConfirming(true)

    try {

      const session = await confirmCustomerPhoneLoginCode({ phone: validation.e164, code: code.trim() })

      onSubmit(session)

    } catch (err) {

      setError(messageFromFetchError(err, "Код не підтверджено. Перевірте та спробуйте ще раз."))

    } finally {

      setConfirming(false)

    }

  }



  const displayError = externalError || error



  return (

    <OnboardingFormShell

      header={<LoginScreenHeader onBack={onBack} />}

      footer={

        <PrimaryButton

          label={confirming || saving ? "Перевіряємо…" : "Увійти"}

          onClick={() => void handleConfirm()}

          disabled={!canConfirm || confirming || saving || !codeSent}

        />

      }

    >

      <label style={{ display: "grid", gap: 6 }}>

        <span className="pomich-form-label">Телефон *</span>

        <PhoneInput

          value={phone}

          onChange={(next) => {

            setPhone(next)

            if (phoneError) setPhoneError(undefined)

            if (error) setError(undefined)

          }}

          error={phoneError}

        />

      </label>

      {codeSent ? (

        <label style={{ display: "grid", gap: 6 }}>

          <span className="pomich-form-label">Код підтвердження</span>

          <input

            value={code}

            onChange={(event) => {

              const next = event.target.value.replace(/\D/g, "").slice(0, 6)

              setCode(next)

              if (error) setError(undefined)

            }}

            inputMode="numeric"

            autoComplete="one-time-code"

            placeholder="6 цифр"

            className="pomich-form-input pomich-otp-input"

          />

        </label>

      ) : null}

      {expiresAt && countdown > 0 ? (

        <div className="pomich-otp-countdown">Код дійсний {formatCountdown(countdown)}</div>

      ) : null}

      {expiresAt && countdown === 0 && codeSent ? (

        <div className="pomich-form-error">Час дії коду минув. Надішліть новий код.</div>

      ) : null}

      <button type="button" className="pomich-cabinet-chip-btn" disabled={!canSend || sending} onClick={() => void handleSendCode()}>

        {sending ? "Надсилаємо…" : codeSent ? "Надіслати код повторно" : "Надіслати код у Telegram"}

      </button>

      {displayError ? <div className="pomich-form-error">{displayError}</div> : null}

      <button type="button" className="pomich-cabinet-chip-btn" onClick={onRegister}>

        Немає акаунта? Зареєструватися

      </button>

    </OnboardingFormShell>

  )

}

