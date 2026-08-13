import { useEffect, useMemo, useState } from "react"

import {
  confirmCustomerVerificationCode,
  messageFromFetchError,
  sendCustomerVerificationCode,
  ApiRequestError,
  type CustomerProfile,
} from "../../api/client"
import { isCustomerVerified } from "../../lib/customerProfile"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"

import { FieldError } from "./FieldError"
import { PhoneInput } from "./PhoneInput"
import { PrimaryButton } from "./PrimaryButton"

export const OTP_RESEND_COOLDOWN_SECONDS = 45

interface OtpVerificationPanelProps {
  profile: CustomerProfile
  customerToken?: string
  isTelegram?: boolean
  phone?: string
  email?: string
  compact?: boolean
  /**
   * @deprecated Ignored — OTP is never auto-sent. Kept optional so call sites compile
   * until props are cleaned up; send only on explicit button tap.
   */
  autoSendChannel?: "telegram" | "email"
  onVerified?: (profile: CustomerProfile) => void
  /** Called after phone is saved (inline save or via OTP send patch). */
  onPhoneSaved?: (phone: string, profile?: CustomerProfile) => void
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function OtpVerificationPanel({
  profile,
  customerToken,
  isTelegram = false,
  phone,
  email,
  compact = false,
  onVerified,
  onPhoneSaved,
}: OtpVerificationPanelProps) {
  const propPhone = phone ?? profile.phone ?? ""
  const [localPhone, setLocalPhone] = useState(propPhone)
  const [phoneCommitted, setPhoneCommitted] = useState(() => validateUkraineMobilePhone(propPhone).valid)
  const [phoneFieldError, setPhoneFieldError] = useState<string>()
  const [savingPhone, setSavingPhone] = useState(false)
  const [code, setCode] = useState("")
  const [expiresAt, setExpiresAt] = useState<string>()
  const [countdown, setCountdown] = useState(0)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string>()
  const [codeError, setCodeError] = useState<string>()
  const [codeHint, setCodeHint] = useState<string>()
  const [devHint, setDevHint] = useState<string>()
  const [sentChannel, setSentChannel] = useState<"telegram" | "email">()

  useEffect(() => {
    setLocalPhone(propPhone)
    setPhoneCommitted(validateUkraineMobilePhone(propPhone).valid)
  }, [propPhone])

  const verified = isCustomerVerified(profile)
  const phoneValue = localPhone
  const emailValue = email ?? profile.email ?? ""
  const phoneValidation = validateUkraineMobilePhone(phoneValue)
  const showPhoneGate = !phoneCommitted
  const canSendTelegram = isTelegram || phoneValidation.valid
  const canSendEmail = Boolean(emailValue.trim() && emailValue.includes("@"))

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

  const sendLabel = useMemo(() => {
    if (sending) return "Надсилаємо…"
    if (resendCooldown > 0) return `Повторно через ${resendCooldown} с`
    if (sentChannel === "telegram" || sentChannel === "email") return "Надіслати код повторно"
    return null
  }, [sending, sentChannel, resendCooldown])

  const helpText = useMemo(() => {
    if (showPhoneGate) {
      return "Це підтвердження телефону, не нова реєстрація. 1. Введіть номер і натисніть «Зберегти і надіслати код». 2. Введіть 6 цифр з @pomich_ua_bot."
    }
    if (sentChannel) {
      return "Код уже в @pomich_ua_bot. Введіть 6 цифр нижче. Після підтвердження цей крок більше не питатимемо."
    }
    if (isTelegram) {
      return "Профіль уже є — потрібне лише підтвердження телефону. 1. «Надіслати код» у цей чат. 2. Введіть 6 цифр. Далі вхід без повторної реєстрації."
    }
    return "Профіль уже є — це не реєстрація. 1. Відкрийте @pomich_ua_bot і натисніть /start. 2. «Надіслати код» на сайті. 3. Введіть 6 цифр з бота один раз — далі не питатимемо."
  }, [showPhoneGate, sentChannel, isTelegram])


  const handleSend = async (channel: "telegram" | "email", phoneOverride?: string) => {
    if (!customerToken) {
      setError("Потрібна сесія клієнта. Перезавантажте сторінку.")
      return
    }
    const effectivePhone = phoneOverride ?? phoneValue
    const effectivePhoneValidation = validateUkraineMobilePhone(effectivePhone)
    if (channel === "telegram" && !effectivePhoneValidation.valid && !isTelegram) {
      setError("Введіть коректний український номер телефону.")
      return
    }
    if (channel === "telegram" && !effectivePhoneValidation.valid) {
      setError("Введіть коректний український номер телефону нижче.")
      return
    }
    if (channel === "email" && !canSendEmail) {
      setError("Введіть коректну email-адресу.")
      return
    }
    if (resendCooldown > 0 && sentChannel) {
      return
    }

    setSending(true)
    setError(undefined)
    setDevHint(undefined)
    try {
      const response = await sendCustomerVerificationCode(
        {
          channel,
          phone: effectivePhoneValidation.valid ? effectivePhoneValidation.e164 : undefined,
          email: channel === "email" ? emailValue.trim() : undefined,
        },
        customerToken,
      )
      if (effectivePhoneValidation.valid) {
        setLocalPhone(effectivePhoneValidation.e164)
        setPhoneCommitted(true)
        onPhoneSaved?.(effectivePhoneValidation.e164)
      }
      setSentChannel(channel)
      setExpiresAt(response.expiresAt)
      setResendCooldown(response.cooldownSeconds ?? OTP_RESEND_COOLDOWN_SECONDS)
      setCode("")
      setCodeError(undefined)
      setCodeHint(undefined)
      if (response.alreadySent) {
        setError("Код уже надіслано в Telegram. Введіть 6 цифр нижче.")
      }
      if (response.devCode) {
        setDevHint(`Код для тесту (dev): ${response.devCode}`)
      }
    } catch (err) {
      const message = messageFromFetchError(err, "Не вдалося надіслати код. Спробуйте ще раз.")
      const retryAfter =
        err instanceof ApiRequestError && typeof err.retryAfterSeconds === "number"
          ? err.retryAfterSeconds
          : undefined
      if (
        (err instanceof ApiRequestError && (err.status === 429 || err.code === "send_cooldown" || err.code === "rate_limit_exceeded")) ||
        /send_cooldown|rate_limit|забагато спроб|уже надіслано|429/i.test(message)
      ) {
        setResendCooldown(retryAfter ?? OTP_RESEND_COOLDOWN_SECONDS)
        setError(message)
        // Keep code entry visible if a code may already be in Telegram.
        if (!sentChannel) {
          setSentChannel(channel)
        }
      } else {
        setError(message)
      }
    } finally {
      setSending(false)
    }
  }

  const handleSavePhoneAndSend = async () => {
    if (!customerToken) {
      setError("Потрібна сесія клієнта. Перезавантажте сторінку.")
      return
    }
    const validation = validateUkraineMobilePhone(phoneValue)
    if (!validation.valid) {
      setPhoneFieldError(validation.error || "Введіть коректний український номер")
      return
    }

    setSavingPhone(true)
    setPhoneFieldError(undefined)
    setError(undefined)
    setLocalPhone(validation.e164)
    try {
      // /verify/send patches phone on the customer profile when provided.
      await handleSend("telegram", validation.e164)
    } finally {
      setSavingPhone(false)
    }
  }

  const handleConfirm = async () => {
    if (!customerToken) {
      setError("Потрібна сесія клієнта. Перезавантажте сторінку.")
      return
    }
    if (code.trim().length !== 6) {
      setCodeError("Введіть 6-значний код")
      setCodeHint("Код з Telegram-бота @pomich_ua_bot — рівно 6 цифр")
      return
    }

    setConfirming(true)
    setError(undefined)
    setCodeError(undefined)
    setCodeHint(undefined)
    try {
      const response = await confirmCustomerVerificationCode({ code: code.trim() }, customerToken)
      setExpiresAt(undefined)
      setCode("")
      setDevHint(undefined)
      onVerified?.(response.profile)
    } catch (err) {
      setCodeError(messageFromFetchError(err, "Код не підтверджено. Перевірте та спробуйте ще раз."))
      setCodeHint("Перевірте цифри або надішліть новий код")
    } finally {
      setConfirming(false)
    }
  }

  if (verified) {
    return (
      <div className={`pomich-otp-panel${compact ? " is-compact" : ""}`}>
        <div className="pomich-otp-verified">
          <span className="pomich-otp-verified-dot" aria-hidden="true" />
          Телефон підтверджено
        </div>
      </div>
    )
  }

  const showManualSend = !showPhoneGate && canSendTelegram && !sentChannel
  const showManualEmailSend = !showPhoneGate && canSendEmail && !sentChannel

  return (
    <div className={`pomich-otp-panel${compact ? " is-compact" : ""}`}>
      <div className="pomich-cabinet-section-title">Підтвердження телефону</div>
      <p className="pomich-cabinet-help-text">{helpText}</p>

      {showPhoneGate ? (
        <div className="pomich-otp-phone-gate" style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          <label className="pomich-cabinet-field">
            <span className="pomich-form-label">Телефон *</span>
            <PhoneInput
              value={phoneValue}
              onChange={(next) => {
                setLocalPhone(next)
                if (phoneFieldError) setPhoneFieldError(undefined)
                if (error) setError(undefined)
              }}
              error={phoneFieldError}
              disabled={savingPhone || sending}
            />
          </label>
          <PrimaryButton
            label={savingPhone || sending ? "Зберігаємо…" : "Зберегти і надіслати код"}
            onClick={() => void handleSavePhoneAndSend()}
            disabled={savingPhone || sending || !customerToken}
          />
        </div>
      ) : null}

      <div className="pomich-otp-actions">
        {showManualSend ? (
          <button
            type="button"
            className="pomich-cabinet-chip-btn pomich-otp-send-btn"
            disabled={sending || resendCooldown > 0}
            onClick={() => handleSend("telegram")}
          >
            {sending ? "Надсилаємо…" : "Надіслати код у Telegram"}
          </button>
        ) : null}
        {showManualEmailSend ? (
          <button
            type="button"
            className="pomich-cabinet-chip-btn pomich-otp-send-btn"
            disabled={sending || resendCooldown > 0}
            onClick={() => handleSend("email")}
          >
            {sending ? "Надсилаємо…" : "Надіслати код на email"}
          </button>
        ) : null}
      </div>

      {!showPhoneGate ? (
        <div className="pomich-otp-field">
          <label className="pomich-cabinet-field">
            <span className="pomich-form-label">Код підтвердження</span>
            <input
              value={code}
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, "").slice(0, 6)
                setCode(next)
                if (codeError) setCodeError(undefined)
                if (codeHint) setCodeHint(undefined)
                if (error) setError(undefined)
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 цифр"
              className={`pomich-form-input pomich-otp-input${codeError ? " is-error" : ""}`}
            />
          </label>
          <FieldError error={codeError} hint={codeHint} />
          {expiresAt && countdown > 0 ? (
            <div className="pomich-otp-countdown">Код дійсний {formatCountdown(countdown)}</div>
          ) : null}
          {expiresAt && countdown === 0 ? (
            <div className="pomich-form-error">Час дії коду минув. Надішліть новий код.</div>
          ) : null}
          <PrimaryButton
            label={confirming ? "Перевіряємо…" : "Підтвердити"}
            onClick={handleConfirm}
            disabled={confirming || code.length !== 6 || !customerToken}
          />
          {sendLabel ? (
            <button
              type="button"
              className="pomich-cabinet-chip-btn"
              disabled={sending || resendCooldown > 0}
              onClick={() => handleSend(sentChannel || (canSendTelegram ? "telegram" : "email"))}
            >
              {sendLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {!customerToken ? <div className="pomich-form-error">Сесію не знайдено. Перезавантажте сторінку або увійдіть знову.</div> : null}
      {devHint ? <div className="pomich-otp-dev-hint">{devHint}</div> : null}
      {error ? <div className="pomich-form-error">{error}</div> : null}
    </div>
  )
}
