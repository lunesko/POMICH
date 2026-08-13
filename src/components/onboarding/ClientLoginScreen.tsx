import { useEffect, useState } from "react"

import {
  ApiRequestError,
  confirmCustomerPhoneLoginCode,
  formatOtpRetryWait,
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

function isOtpSendLimitError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) return true
    if (error.code === "rate_limit_exceeded" || error.code === "send_cooldown") return true
  }
  const message = messageFromFetchError(error, "")
  return /send_cooldown|rate_limit|забагато спроб|уже надіслано|429/i.test(message)
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
  const [resendCooldown, setResendCooldown] = useState(0)
  /** Once true, always show the 6-digit code field until phone number changes. */
  const [awaitingCode, setAwaitingCode] = useState(false)

  const phoneValidation = validateUkraineMobilePhone(phone)
  const canSend = phoneValidation.valid
  const canConfirm = code.trim().length === 6 && canSend
  const busy = sending || confirming || Boolean(saving)

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

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setInterval(() => {
      setResendCooldown((value) => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendCooldown])

  const openCodeEntry = (options?: { expiresAt?: string; cooldownSeconds?: number; hint?: string }) => {
    setAwaitingCode(true)
    if (options?.expiresAt) {
      setExpiresAt(options.expiresAt)
    } else if (!expiresAt) {
      // Keep a usable window even when server only returned a rate-limit signal.
      setExpiresAt(new Date(Date.now() + 10 * 60 * 1000).toISOString())
    }
    if (typeof options?.cooldownSeconds === "number" && options.cooldownSeconds > 0) {
      setResendCooldown(options.cooldownSeconds)
    }
    if (options?.hint) {
      setError(options.hint)
    }
  }

  const handleSendCode = async () => {
    const validation = validateUkraineMobilePhone(phone)
    if (!validation.valid) {
      setPhoneError(validation.error)
      return
    }
    if (resendCooldown > 0 && awaitingCode) {
      return
    }
    setPhoneError(undefined)
    setError(undefined)
    setSending(true)
    try {
      const response = await sendCustomerPhoneLoginCode(validation.e164)
      openCodeEntry({
        expiresAt: response.expiresAt,
        cooldownSeconds: response.cooldownSeconds ?? 45,
        hint: response.alreadySent
          ? "Код уже надіслано в Telegram. Введіть 6 цифр нижче."
          : undefined,
      })
      setCode("")
    } catch (err) {
      if (isOtpSendLimitError(err)) {
        const retryAfter =
          err instanceof ApiRequestError && typeof err.retryAfterSeconds === "number"
            ? err.retryAfterSeconds
            : err instanceof ApiRequestError && err.code === "rate_limit_exceeded"
              ? 600
              : 45
        openCodeEntry({
          cooldownSeconds: retryAfter,
          hint:
            err instanceof ApiRequestError
              ? err.message
              : formatOtpRetryWait(retryAfter, "rate_limit_exceeded"),
        })
      } else {
        setError(messageFromFetchError(err, "Не вдалося надіслати код. Спробуйте ще раз."))
      }
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
      setError("Введіть 6-значний код з @pomich_ua_bot.")
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

  const handlePrimary = () => {
    if (!awaitingCode) {
      void handleSendCode()
      return
    }
    void handleConfirm()
  }

  const primaryLabel = (() => {
    if (sending) return "Надсилаємо…"
    if (confirming || saving) return "Перевіряємо…"
    if (!awaitingCode) return "Надіслати код"
    return "Підтвердити"
  })()

  const primaryDisabled = busy || (!awaitingCode ? !canSend : !canConfirm)
  const displayError = externalError || error

  return (
    <OnboardingFormShell
      header={<LoginScreenHeader onBack={onBack} />}
      footer={
        <PrimaryButton
          label={primaryLabel}
          onClick={handlePrimary}
          disabled={primaryDisabled}
        />
      }
    >
      <label style={{ display: "grid", gap: 6 }}>
        <span className="pomich-form-label">Телефон *</span>
        <PhoneInput
          value={phone}
          onChange={(next) => {
            const previous = phone
            setPhone(next)
            if (phoneError) setPhoneError(undefined)
            if (error) setError(undefined)
            // Only reset OTP step when the actual E.164 number changes (not formatting noise).
            if (awaitingCode && next !== previous) {
              setAwaitingCode(false)
              setCode("")
              setExpiresAt(undefined)
              setResendCooldown(0)
            }
          }}
          error={phoneError}
        />
      </label>

      {awaitingCode ? (
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
            autoFocus
            placeholder="6 цифр з Telegram"
            className="pomich-form-input pomich-otp-input"
          />
        </label>
      ) : (
        <p className="pomich-cabinet-help-text" style={{ margin: 0 }}>
          Введіть номер і натисніть «Надіслати код». Код прийде в @pomich_ua_bot.
        </p>
      )}

      {expiresAt && countdown > 0 ? (
        <div className="pomich-otp-countdown">Код дійсний {formatCountdown(countdown)}</div>
      ) : null}
      {expiresAt && countdown === 0 && awaitingCode ? (
        <div className="pomich-form-error">Час дії коду минув. Надішліть новий код.</div>
      ) : null}

      {awaitingCode ? (
        <button
          type="button"
          className="pomich-cabinet-chip-btn"
          disabled={!canSend || sending || resendCooldown > 0}
          onClick={() => void handleSendCode()}
        >
          {sending
            ? "Надсилаємо…"
            : resendCooldown > 0
              ? `Повторно через ${resendCooldown} с`
              : "Надіслати код повторно"}
        </button>
      ) : null}

      {displayError ? <div className="pomich-form-error">{displayError}</div> : null}

      <button type="button" className="pomich-cabinet-chip-btn" onClick={onRegister}>
        Немає акаунта? Зареєструватися
      </button>
    </OnboardingFormShell>
  )
}
