import { useState } from "react"

import { messageFromFetchError, updateCustomerProfile, type CustomerProfile, type OrderResponse } from "../../api/client"
import { getProfileChecklist, isCustomerVerified, profileChecklistSummary } from "../../lib/customerProfile"
import { roleLabel, type UserRole } from "../../lib/userAccount"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { verificationHelpText, verificationSteps } from "../../lib/verificationHelp"
import { getTelegramContext } from "../../telegram"

import { Header } from "../layout/Header"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import { PhoneInput } from "../ui/PhoneInput"
import { PrimaryButton } from "../ui/PrimaryButton"
import { VerificationPill } from "../ui/VerificationPill"

interface ClientCabinetProps {
  profile: CustomerProfile
  customerId: string
  customerToken?: string
  orders?: OrderResponse[]
  currentRole: UserRole
  onBack: () => void
  onStartOrder: () => void
  onSwitchRole: () => void
  onProfileUpdate?: (profile: CustomerProfile) => void
}

export default function ClientCabinet({
  profile,
  customerId,
  customerToken,
  orders = [],
  currentRole,
  onBack,
  onStartOrder,
  onSwitchRole,
  onProfileUpdate,
}: ClientCabinetProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [phoneError, setPhoneError] = useState<string>()
  const [form, setForm] = useState({
    name: profile.name?.trim() && profile.name !== "Клієнт POMICH" ? profile.name : "",
    phone: profile.phone || "",
    email: profile.email || "",
    city: profile.city || "",
    telegram: profile.telegram || "",
  })

  const name = profile.name?.trim() || "Клієнт POMICH"
  const checklist = getProfileChecklist(profile)
  const requiredItems = checklist.filter((item) => item.required)
  const requiredFilled = requiredItems.filter((item) => item.filled).length
  const progressPct = requiredItems.length ? Math.round((requiredFilled / requiredItems.length) * 100) : 100
  const helpText = verificationHelpText(profile)
  const steps = verificationSteps(profile)
  const telegramContext = getTelegramContext()
  const profileVerified = isCustomerVerified(profile)

  const openEdit = () => {
    setForm({
      name: profile.name?.trim() && profile.name !== "Клієнт POMICH" ? profile.name : "",
      phone: profile.phone || "",
      email: profile.email || "",
      city: profile.city || "",
      telegram: profile.telegram || "",
    })
    setSaveError(undefined)
    setPhoneError(undefined)
    setEditing(true)
  }

  const handleSave = async () => {
    const phoneValidation = validateUkraineMobilePhone(form.phone)
    if (!form.name.trim()) {
      setSaveError("Введіть ім'я")
      return
    }
    if (!phoneValidation.valid) {
      setPhoneError(phoneValidation.error)
      return
    }

    setSaving(true)
    setSaveError(undefined)
    setPhoneError(undefined)
    try {
      const saved = await updateCustomerProfile(
        customerId,
        {
          name: form.name.trim(),
          phone: phoneValidation.e164,
          email: form.email.trim(),
          city: form.city.trim() || "Київ",
          telegram: form.telegram.trim().replace(/^@/, ""),
        },
        customerToken,
      )
      onProfileUpdate?.(saved)
      setEditing(false)
    } catch (err) {
      setSaveError(messageFromFetchError(err, "Не вдалося зберегти профіль. Спробуйте ще раз."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pomich-cabinet-shell">
      <div className="pomich-cabinet-header">
        <Header
          title="Особистий кабінет"
          subtitle={`${roleLabel(currentRole)} · POMICH`}
          onBack={onBack}
          compactToggle
          actions={
            <button type="button" onClick={onSwitchRole} className="pomich-cabinet-chip-btn">
              Змінити роль
            </button>
          }
        />
      </div>

      <div className="pomich-cabinet-body">
        <div className="pomich-cabinet-inner">
          <div className="pomich-cabinet-card">
            {editing ? (
              <div className="pomich-cabinet-edit-form">
                <div className="pomich-cabinet-section-title">Редагування профілю</div>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Ім'я *</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Ваше ім'я"
                    className="pomich-form-input"
                  />
                </label>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Телефон *</span>
                  <PhoneInput
                    value={form.phone}
                    onChange={(next) => {
                      setForm((prev) => ({ ...prev, phone: next }))
                      if (phoneError) setPhoneError(undefined)
                    }}
                    error={phoneError}
                  />
                </label>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Email</span>
                  <input
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="email@example.com"
                    type="email"
                    className="pomich-form-input"
                  />
                </label>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Місто</span>
                  <input
                    value={form.city}
                    onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                    placeholder="Київ"
                    className="pomich-form-input"
                  />
                </label>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Telegram</span>
                  <input
                    value={form.telegram}
                    onChange={(e) => setForm((prev) => ({ ...prev, telegram: e.target.value }))}
                    placeholder="@username"
                    className="pomich-form-input"
                  />
                </label>
                {saveError ? <div className="pomich-form-error">{saveError}</div> : null}
                {!profileVerified ? (
                  <OtpVerificationPanel
                    profile={profile}
                    customerToken={customerToken}
                    isTelegram={telegramContext.isTelegram}
                    phone={form.phone}
                    email={form.email}
                    compact
                    onVerified={(saved) => onProfileUpdate?.(saved)}
                  />
                ) : null}
                <div className="pomich-cabinet-edit-actions">
                  <button type="button" onClick={() => setEditing(false)} className="pomich-cabinet-chip-btn" disabled={saving}>
                    Скасувати
                  </button>
                  <PrimaryButton label={saving ? "Зберігаємо…" : "Зберегти"} onClick={handleSave} disabled={saving} />
                </div>
              </div>
            ) : (
              <div className="pomich-cabinet-profile">
                <div className="pomich-cabinet-avatar" aria-hidden="true">
                  {name.trim().slice(0, 1).toUpperCase()}
                </div>
                <div className="pomich-cabinet-profile-meta">
                  <div className="pomich-cabinet-profile-name">{name}</div>
                  <div className="pomich-cabinet-profile-phone">{profile.phone || "Телефон не вказано"}</div>
                  {profile.email ? <div className="pomich-cabinet-profile-extra">{profile.email}</div> : null}
                  {profile.city ? <div className="pomich-cabinet-profile-extra">{profile.city}</div> : null}
                  {profile.telegram ? <div className="pomich-cabinet-profile-extra">@{profile.telegram.replace(/^@/, "")}</div> : null}
                  <div className="pomich-cabinet-profile-badges">
                    <VerificationPill profile={profile} />
                  </div>
                </div>
                <button type="button" onClick={openEdit} className="pomich-cabinet-chip-btn">
                  Редагувати
                </button>
              </div>
            )}
          </div>

          <div className="pomich-cabinet-card pomich-cabinet-verification-help">
            <div className="pomich-cabinet-section-title">Статус профілю</div>
            <p className="pomich-cabinet-help-text">{helpText}</p>
            <ol className="pomich-cabinet-help-steps">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {!profileVerified && !editing ? (
              <OtpVerificationPanel
                profile={profile}
                customerToken={customerToken}
                isTelegram={telegramContext.isTelegram}
                onVerified={(saved) => onProfileUpdate?.(saved)}
              />
            ) : null}
          </div>

          <div className="pomich-cabinet-grid">
            <div className="pomich-cabinet-card">
              <div className="pomich-cabinet-section-title">Заповнення профілю</div>
              <div className="pomich-cabinet-section-sub">{profileChecklistSummary(profile)}</div>
              <div className="pomich-cabinet-progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                <div className="pomich-cabinet-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="pomich-cabinet-checklist">
                {checklist.map((item) => (
                  <div key={item.key} className={`pomich-cabinet-checklist-item${item.filled ? " is-done" : ""}`}>
                    <span className="pomich-cabinet-checklist-label">
                      {item.label}
                      {item.required ? " *" : ""}
                    </span>
                    <span className="pomich-cabinet-checklist-mark" aria-hidden="true">
                      {item.filled ? "✓" : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pomich-cabinet-card">
              <div className="pomich-cabinet-section-title">Історія заявок</div>
              {orders.length === 0 ? (
                <div className="pomich-cabinet-empty">
                  Ще немає заявок. Натисніть «Викликати допомогу», коли потрібна допомога на дорозі.
                </div>
              ) : (
                orders.map((order) => (
                  <div key={order.id} className="pomich-cabinet-order-item">
                    <div className="pomich-cabinet-order-title">{order.service || "Послуга"} · #{order.id}</div>
                    <div className="pomich-cabinet-order-status">{order.status || "—"}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="pomich-cabinet-footer">
        <div className="pomich-cabinet-footer-inner">
          <PrimaryButton label="Викликати допомогу" onClick={onStartOrder} />
        </div>
      </div>
    </div>
  )
}
