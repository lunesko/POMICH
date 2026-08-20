import { useEffect, useState } from "react"
import { composePartnerVehicle, DEFAULT_SERVICE_RADIUS_KM, getProviderCapabilityLabel, partnerRegistrationServices, partnerVehicleSelectionIsComplete, BRAND } from "../../lib/constants"

const SELECTED = "var(--pomich-selected-bg)"
import type { PartnerRegistrationForm } from "../../lib/constants"
import type { ServiceKey } from "../../lib/pomichDomain"
import { validatePersonName } from "../../lib/personName"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../lib/ukraineCities"
import { isValidUkrainePlate, validateUkrainePlate } from "../../lib/ukrainePlate"
import { ScreenLayout } from "../layout/ScreenLayout"
import { Header } from "../layout/Header"
import FormContainer from "../layout/FormContainer"
import { PrimaryButton } from "../ui/PrimaryButton"
import { FieldError } from "../ui/FieldError"
import { PhoneInput } from "../ui/PhoneInput"
import { CitySelect } from "../ui/CitySelect"
import { PartnerVehicleFields } from "../provider/PartnerVehicleFields"
import { UkrainePlateInput } from "../ui/UkrainePlateInput"
import { ServiceRadiusField } from "../ui/ServiceRadiusField"

interface ProviderRegistrationStepProps {
  form: PartnerRegistrationForm
  saving: boolean
  error?: string
  /** Linked customer completing partner cabinet — not a brand-new account. */
  completingProfile?: boolean
  onChange: (patch: Partial<PartnerRegistrationForm>) => void
  onToggleSpecialty: (specialty: ServiceKey) => void
  onSubmit: () => void
  onLogin?: () => void
  onBack?: () => void
}

export function ProviderRegistrationStep({
  form,
  saving,
  error,
  completingProfile = false,
  onChange,
  onToggleSpecialty,
  onSubmit,
  onLogin,
  onBack,
}: ProviderRegistrationStepProps) {
  const [nameError, setNameError] = useState<string>()
  const [nameHint, setNameHint] = useState<string>()
  const [phoneError, setPhoneError] = useState<string>()
  const [phoneHint, setPhoneHint] = useState<string>()
  const [cityError, setCityError] = useState<string>()
  const [cityHint, setCityHint] = useState<string>()
  const [plateError, setPlateError] = useState<string>()

  const composedVehicle = composePartnerVehicle(form.vehicleMake, form.vehicleModel, form.vehicleMakeOther)
  const nameValidation = validatePersonName(form.name)
  const phoneValidation = validateUkraineMobilePhone(form.phone)
  const cityValidation = validateServiceCity(form.city || DEFAULT_SERVICE_CITY)
  const canSubmit = Boolean(
    nameValidation.valid &&
    phoneValidation.valid &&
    cityValidation.valid &&
    partnerVehicleSelectionIsComplete(form.vehicleMake, form.vehicleMakeOther, form.vehicleModel) &&
    composedVehicle.trim() &&
    isValidUkrainePlate(form.plate) &&
    form.specialties.length > 0,
  )

  useEffect(() => {
    if (!error) return
    if (error.includes("номер") || error.includes("phone_already")) {
      setPhoneError(error)
      setPhoneHint("Увійдіть з цим номером або вкажіть інший")
    }
  }, [error])

  const handleSubmit = () => {
    const nextName = validatePersonName(form.name)
    const nextPhone = validateUkraineMobilePhone(form.phone)
    const nextCity = validateServiceCity(form.city || DEFAULT_SERVICE_CITY)
    const nextPlate = validateUkrainePlate(form.plate)
    setNameError(nextName.error)
    setNameHint(nextName.hint)
    setPhoneError(nextPhone.valid ? undefined : nextPhone.error)
    setPhoneHint(nextPhone.valid ? undefined : "Мобільний номер України: 9 цифр після +380")
    setCityError(nextCity.error)
    setCityHint(nextCity.hint)
    setPlateError(nextPlate.valid ? undefined : nextPlate.error)
    if (!nextName.valid || !nextPhone.valid || !nextCity.valid || !nextPlate.valid) return
    onSubmit()
  }

  const title = completingProfile ? "Профіль партнера" : "Реєстрація партнера"
  const subtitle = completingProfile
    ? "Підтвердіть дані з акаунту клієнта та додайте авто й послуги"
    : "Заповніть профіль і оберіть послуги, які надаєте"
  const submitLabel = saving
    ? "Зберігаємо профіль…"
    : completingProfile
      ? "Зберегти профіль"
      : "Зареєструватись"

  return (
    <ScreenLayout
      className="pomich-screen-layout--form"
      footer={<PrimaryButton label={submitLabel} onClick={handleSubmit} disabled={!canSubmit || saving} />}
    >
      <Header title={title} subtitle={subtitle} onBack={onBack} />
      <FormContainer>
        <div className="pomich-form-card">
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Ім'я</span>
            <input
              value={form.name}
              onChange={(event) => {
                onChange({ name: event.target.value })
                if (nameError) setNameError(undefined)
                if (nameHint) setNameHint(undefined)
              }}
              placeholder="Ваше ім'я"
              className={`pomich-form-input${nameError ? " is-error" : ""}`}
            />
            <FieldError error={nameError} hint={nameHint} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Телефон</span>
            <PhoneInput
              value={form.phone}
              onChange={(phone) => {
                onChange({ phone })
                if (phoneError) setPhoneError(undefined)
                if (phoneHint) setPhoneHint(undefined)
              }}
              error={phoneError}
            />
            <FieldError hint={phoneHint} />
          </label>
          <CitySelect
            value={form.city || DEFAULT_SERVICE_CITY}
            onChange={(city) => {
              onChange({ city })
              if (cityError) setCityError(undefined)
              if (cityHint) setCityHint(undefined)
            }}
            error={cityError}
            hint={cityHint}
          />
        </div>

        <div className="pomich-form-card">
          <PartnerVehicleFields form={form} onChange={onChange} />
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Номер</span>
            <UkrainePlateInput
              value={form.plate}
              onChange={(plate) => {
                onChange({ plate })
                if (plateError) setPlateError(undefined)
              }}
              error={plateError}
            />
          </label>
          <ServiceRadiusField value={form.serviceRadiusKm} onChange={(serviceRadiusKm) => onChange({ serviceRadiusKm })} />
        </div>

        <div className="pomich-form-card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 950, color: "var(--pomich-text)" }}>Ваші послуги</div>
              <div className="pomich-header-subtitle">{form.specialties.length} обрано</div>
            </div>
            <div style={{ background: form.specialties.length > 0 ? SELECTED : "var(--pomich-warn-bg)", color: form.specialties.length > 0 ? BRAND : "var(--pomich-warn-text)", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 950 }}>
              {form.specialties.length > 0 ? "Готово" : "Оберіть"}
            </div>
          </div>
          <div className="pomich-service-grid">
            {partnerRegistrationServices.map((service) => {
              const selected = form.specialties.includes(service.key)
              return (
                <button
                  key={service.key}
                  type="button"
                  onClick={() => onToggleSpecialty(service.key)}
                  className={`pomich-service-card${selected ? " is-selected" : " pomich-service-card--pastel"}`}
                  data-pastel={selected ? undefined : "true"}
                  style={selected ? undefined : { background: service.tone, color: "var(--pomich-service-pastel-ink)" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 18 }}>{service.emoji}</span>
                    <span style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.2 }}>{getProviderCapabilityLabel(service.key)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {onLogin ? (
          <button type="button" onClick={onLogin} className="pomich-link-btn" style={{ width: "100%" }}>
            {error && /phone_already_registered|вже зареєстровано|уже зареєстровано/i.test(error)
              ? "Увійти за цим номером"
              : "Вже маєте акаунт? Увійти"}
          </button>
        ) : null}

        {error && error !== phoneError ? <div className="pomich-form-error">{error}</div> : null}
      </FormContainer>
    </ScreenLayout>
  )
}
