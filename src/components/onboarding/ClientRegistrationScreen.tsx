import { useEffect, useState } from "react"

import { validatePersonName } from "../../lib/personName"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../lib/ukraineCities"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { OnboardingFormShell } from "../layout/OnboardingFormShell"
import { CitySelect } from "../ui/CitySelect"
import { FieldError } from "../ui/FieldError"
import { PhoneInput } from "../ui/PhoneInput"
import { PrimaryButton } from "../ui/PrimaryButton"
import { ThemeToggle } from "../ui/ThemeToggle"

interface ClientRegistrationScreenProps {
  initialName?: string
  initialPhone?: string
  initialCity?: string
  loggedInAs?: string
  saving?: boolean
  error?: string
  onSubmit: (payload: { name: string; phone: string; city: string }) => void
  onBack?: () => void
  onLogout?: () => void
}

function RegistrationScreenHeader({ onBack }: { onBack?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {onBack ? (
          <button type="button" onClick={onBack} className="pomich-back-btn" aria-label="Назад">←</button>
        ) : null}
        <div>
          <div className="pomich-header-title">Реєстрація клієнта</div>
          <div className="pomich-header-subtitle">Ім'я, місто та телефон для виклику допомоги</div>
        </div>
      </div>
      <ThemeToggle compact />
    </div>
  )
}

export default function ClientRegistrationScreen({
  initialName = "",
  initialPhone = "",
  initialCity = DEFAULT_SERVICE_CITY,
  loggedInAs,
  saving,
  error,
  onSubmit,
  onBack,
  onLogout,
}: ClientRegistrationScreenProps) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [city, setCity] = useState(initialCity || DEFAULT_SERVICE_CITY)
  const [nameError, setNameError] = useState<string>()
  const [nameHint, setNameHint] = useState<string>()
  const [phoneError, setPhoneError] = useState<string>()
  const [phoneHint, setPhoneHint] = useState<string>()
  const [cityError, setCityError] = useState<string>()
  const [cityHint, setCityHint] = useState<string>()

  useEffect(() => {
    setName(initialName)
  }, [initialName])

  useEffect(() => {
    setPhone(initialPhone)
  }, [initialPhone])

  useEffect(() => {
    setCity(initialCity || DEFAULT_SERVICE_CITY)
  }, [initialCity])

  useEffect(() => {
    if (!error) return
    if (error.includes("номер") || error.toLowerCase().includes("phone")) {
      setPhoneError(error)
      setPhoneHint("Увійдіть з цим номером або вкажіть інший")
    }
  }, [error])

  const phoneValidation = validateUkraineMobilePhone(phone)
  const nameValidation = validatePersonName(name)
  const cityValidation = validateServiceCity(city)
  const canSubmit = nameValidation.valid && phoneValidation.valid && cityValidation.valid

  const handleSubmit = () => {
    const nextName = validatePersonName(name)
    const nextPhone = validateUkraineMobilePhone(phone)
    const nextCity = validateServiceCity(city)
    setNameError(nextName.error)
    setNameHint(nextName.hint)
    setPhoneError(nextPhone.valid ? undefined : nextPhone.error)
    setPhoneHint(nextPhone.valid ? undefined : "Мобільний номер України: 9 цифр після +380")
    setCityError(nextCity.error)
    setCityHint(nextCity.hint)
    if (!nextName.valid || !nextPhone.valid || !nextCity.valid) return
    onSubmit({ name: nextName.value, phone: nextPhone.e164, city: nextCity.value })
  }

  return (
    <OnboardingFormShell
      header={<RegistrationScreenHeader onBack={onBack} />}
      footer={
        <PrimaryButton label={saving ? "Зберігаємо…" : "Продовжити"} onClick={handleSubmit} disabled={!canSubmit || saving} />
      }
    >
      {loggedInAs ? (
        <div className="pomich-session-indicator">
          <span>Ви увійшли як: <strong>{loggedInAs}</strong></span>
          {onLogout ? (
            <button type="button" onClick={onLogout} className="pomich-session-indicator__logout">
              Вийти
            </button>
          ) : null}
        </div>
      ) : null}
      <label style={{ display: "grid", gap: 6 }}>
        <span className="pomich-form-label">Ім'я *</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (nameError) setNameError(undefined)
            if (nameHint) setNameHint(undefined)
          }}
          placeholder="Ваше ім'я"
          className={`pomich-form-input${nameError ? " is-error" : ""}`}
        />
        <FieldError error={nameError} hint={nameHint} />
      </label>
      <CitySelect
        value={city}
        onChange={(next) => {
          setCity(next)
          if (cityError) setCityError(undefined)
          if (cityHint) setCityHint(undefined)
        }}
        error={cityError}
        hint={cityHint}
      />
      <label style={{ display: "grid", gap: 6 }}>
        <span className="pomich-form-label">Телефон *</span>
        <PhoneInput
          value={phone}
          onChange={(next) => {
            setPhone(next)
            if (phoneError) setPhoneError(undefined)
            if (phoneHint) setPhoneHint(undefined)
          }}
          error={phoneError}
        />
        <FieldError hint={phoneHint && !phoneError ? phoneHint : phoneError ? phoneHint : undefined} />
      </label>
      {error && error !== phoneError ? <div className="pomich-form-error">{error}</div> : null}
    </OnboardingFormShell>
  )
}
