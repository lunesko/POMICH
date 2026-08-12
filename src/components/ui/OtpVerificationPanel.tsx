import { useEffect, useMemo, useRef, useState } from "react"



import {

  confirmCustomerVerificationCode,

  messageFromFetchError,

  sendCustomerVerificationCode,

  type CustomerProfile,

} from "../../api/client"

import { isCustomerVerified } from "../../lib/customerProfile"

import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"



import { PrimaryButton } from "./PrimaryButton"



interface OtpVerificationPanelProps {

  profile: CustomerProfile

  customerToken?: string

  isTelegram?: boolean

  phone?: string

  email?: string

  compact?: boolean

  autoSendChannel?: "telegram" | "email"

  onVerified?: (profile: CustomerProfile) => void

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

  autoSendChannel,

  onVerified,

}: OtpVerificationPanelProps) {

  const [code, setCode] = useState("")

  const [expiresAt, setExpiresAt] = useState<string>()

  const [countdown, setCountdown] = useState(0)

  const [sending, setSending] = useState(false)

  const [confirming, setConfirming] = useState(false)

  const [error, setError] = useState<string>()

  const [devHint, setDevHint] = useState<string>()

  const [sentChannel, setSentChannel] = useState<"telegram" | "email">()

  const autoSendStartedRef = useRef(false)



  const verified = isCustomerVerified(profile)

  const phoneValue = phone ?? profile.phone ?? ""

  const emailValue = email ?? profile.email ?? ""

  const phoneValidation = validateUkraineMobilePhone(phoneValue)

  const canSendTelegram = isTelegram || phoneValidation.valid

  const canSendEmail = Boolean(emailValue.trim() && emailValue.includes("@"))

  const telegramNeedsPhone = isTelegram && !phoneValidation.valid



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



  const sendLabel = useMemo(() => {

    if (sending) return "Надсилаємо…"

    if (sentChannel === "telegram") return "Надіслати код повторно"

    if (sentChannel === "email") return "Надіслати код повторно"

    return null

  }, [sending, sentChannel])



  const handleSend = async (channel: "telegram" | "email") => {

    if (!customerToken) {

      setError("Потрібна сесія клієнта. Перезавантажте сторінку.")

      return

    }

    if (channel === "telegram" && !canSendTelegram) {

      setError("Спочатку введіть коректний номер телефону та збережіть профіль.")

      return

    }

    if (channel === "telegram" && telegramNeedsPhone) {

      setError("Спочатку введіть коректний номер телефону та натисніть «Зберегти профіль».")

      return

    }

    if (channel === "email" && !canSendEmail) {

      setError("Введіть коректну email-адресу.")

      return

    }



    setSending(true)

    setError(undefined)

    setDevHint(undefined)

    try {

      const response = await sendCustomerVerificationCode(

        {

          channel,

          phone: phoneValidation.valid ? phoneValidation.e164 : undefined,

          email: channel === "email" ? emailValue.trim() : undefined,

        },

        customerToken,

      )

      setSentChannel(channel)

      setExpiresAt(response.expiresAt)

      setCode("")

      if (response.devCode) {

        setDevHint(`Код для тесту (dev): ${response.devCode}`)

      }

    } catch (err) {

      setError(messageFromFetchError(err, "Не вдалося надіслати код. Спробуйте ще раз."))

    } finally {

      setSending(false)

    }

  }



  useEffect(() => {

    if (!autoSendChannel || verified || autoSendStartedRef.current || !customerToken) return

    autoSendStartedRef.current = true

    void handleSend(autoSendChannel)

  }, [autoSendChannel, customerToken, verified])



  const handleConfirm = async () => {

    if (!customerToken) {

      setError("Потрібна сесія клієнта. Перезавантажте сторінку.")

      return

    }

    if (code.trim().length !== 6) {

      setError("Введіть 6-значний код.")

      return

    }



    setConfirming(true)

    setError(undefined)

    try {

      const response = await confirmCustomerVerificationCode({ code: code.trim() }, customerToken)

      setExpiresAt(undefined)

      setCode("")

      setDevHint(undefined)

      onVerified?.(response.profile)

    } catch (err) {

      setError(messageFromFetchError(err, "Код не підтверджено. Перевірте та спробуйте ще раз."))

    } finally {

      setConfirming(false)

    }

  }



  if (verified) {

    return (

      <div className={`pomich-otp-panel${compact ? " is-compact" : ""}`}>

        <div className="pomich-otp-verified">

          <span className="pomich-otp-verified-dot" aria-hidden="true" />

          Профіль підтверджено

        </div>

      </div>

    )

  }



  return (

    <div className={`pomich-otp-panel${compact ? " is-compact" : ""}`}>

      <div className="pomich-cabinet-section-title">Підтвердження профілю</div>

      <p className="pomich-cabinet-help-text">

        {isTelegram

          ? "Натисніть «Надіслати код у Telegram», введіть 6 цифр і підтвердіть. Код діє 10 хвилин."

          : "Надішліть 6-значний код у Telegram (за номером телефону) або на email. Код діє 10 хвилин."}

      </p>



      <div className="pomich-otp-actions">

        {canSendTelegram ? (

          <button

            type="button"

            className="pomich-cabinet-chip-btn pomich-otp-send-btn"

            disabled={sending || telegramNeedsPhone}

            onClick={() => handleSend("telegram")}

          >

            {sending && sentChannel === "telegram" ? "Надсилаємо…" : "Надіслати код у Telegram"}

          </button>

        ) : null}

        {canSendEmail ? (

          <button

            type="button"

            className="pomich-cabinet-chip-btn pomich-otp-send-btn"

            disabled={sending}

            onClick={() => handleSend("email")}

          >

            {sending && sentChannel === "email" ? "Надсилаємо…" : "Надіслати код на email"}

          </button>

        ) : null}

      </div>



      {telegramNeedsPhone ? (

        <div className="pomich-form-error">Спочатку введіть телефон і натисніть «Зберегти профіль».</div>

      ) : null}

      {!canSendTelegram && !canSendEmail ? (

        <div className="pomich-form-error">Заповніть телефон, щоб отримати код у Telegram.</div>

      ) : null}



      <div className="pomich-otp-field">

        <label className="pomich-cabinet-field">

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

            disabled={sending}

            onClick={() => handleSend(sentChannel || (canSendTelegram ? "telegram" : "email"))}

          >

            {sendLabel}

          </button>

        ) : null}

      </div>



      {!customerToken ? <div className="pomich-form-error">Сесію не знайдено. Перезавантажте сторінку або увійдіть знову.</div> : null}

      {devHint ? <div className="pomich-otp-dev-hint">{devHint}</div> : null}

      {error ? <div className="pomich-form-error">{error}</div> : null}

    </div>

  )

}


