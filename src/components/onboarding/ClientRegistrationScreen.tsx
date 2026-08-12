import { useState } from "react"

import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import FormContainer, { FormFooterBar, FormHeader } from "../layout/FormContainer"
import { PhoneInput } from "../ui/PhoneInput"
import { PrimaryButton } from "../ui/PrimaryButton"
import { ThemeToggle } from "../ui/ThemeToggle"

interface ClientRegistrationScreenProps {
  initialName?: string
  initialPhone?: string
  saving?: boolean
  error?: string
  onSubmit: (payload: { name: string; phone: string }) => void
  onBack?: () => void
}

export default function ClientRegistrationScreen({
  initialName = "",
  initialPhone = "",
  saving,
  error,
  onSubmit,
  onBack,
}: ClientRegistrationScreenProps) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [phoneError, setPhoneError] = useState<string>()

  const phoneValidation = validateUkraineMobilePhone(phone)
  const canSubmit = Boolean(name.trim() && phoneValidation.valid)

  const handleSubmit = () => {
    const validation = validateUkraineMobilePhone(phone)
    if (!validation.valid) {
      setPhoneError(validation.error)
      return
    }
    setPhoneError(undefined)
    onSubmit({ name: name.trim(), phone: validation.e164 })
  }

  return (
    <div className="pomich-themed-shell">
      <FormHeader>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {onBack ? (
              <button type="button" onClick={onBack} className="pomich-back-btn" aria-label="Назад">←</button>
            ) : null}
            <div>
              <div className="pomich-header-title">Реєстрація клієнта</div>
              <div className="pomich-header-subtitle">Ім'я та телефон для виклику допомоги</div>
            </div>
          </div>
          <ThemeToggle compact />
        </div>
      </FormHeader>

      <div style={{ flex: 1, overflow: "auto" }}>
        <FormContainer>
          <div className="pomich-form-card">
            <label style={{ display: "grid", gap: 6 }}>
              <span className="pomich-form-label">Ім'я *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше ім'я" className="pomich-form-input" />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="pomich-form-label">Телефон *</span>
              <PhoneInput
                value={phone}
                onChange={(next) => {
                  setPhone(next)
                  if (phoneError) setPhoneError(undefined)
                }}
                error={phoneError}
              />
            </label>
          </div>

          {error ? <div className="pomich-form-error">{error}</div> : null}
        </FormContainer>
      </div>

      <FormFooterBar>
        <PrimaryButton label={saving ? "Зберігаємо…" : "Продовжити"} onClick={handleSubmit} disabled={!canSubmit || saving} />
      </FormFooterBar>
    </div>
  )
}
