import { useEffect, useState } from "react"
import { type CustomerProfile } from "../../../api/client"
import { getProfileChecklist, customerProfileStatusLabel, customerProfileStatusTone, isCustomerProfileComplete, isCustomerVerified, profileChecklistItemStatus, profileChecklistSummary } from "../../../lib/customerProfile"
import { PhoneInput } from "../../ui/PhoneInput"
import { OtpVerificationPanel } from "../../ui/OtpVerificationPanel"
import { formatLocalPhoneDisplay, nationalDigitsFromPhone, phoneInputValueFromStored, validateUkraineMobilePhone } from "../../../lib/ukrainePhone"
import { CitySelect } from "../../ui/CitySelect"
import { DEFAULT_SERVICE_CITY, normalizeServiceCity } from "../../../lib/ukraineCities"
import { writeCityUserPicked, writePreferredCity } from "../../../lib/preferredCity"
import { BRAND, BORDER, DARK, SUBTLE, CARD, MUTED, GHOST, SURFACE_TONE } from "./flowTheme"

export default function CustomerTrustPanel({
  profile,
  saving,
  error,
  customerToken,
  isTelegram,
  onChange,
  onVerify,
  onVerified,
}: {
  profile: CustomerProfile
  saving: boolean
  error?: string
  customerToken?: string
  isTelegram?: boolean
  onChange: (patch: Partial<CustomerProfile>) => void
  onVerify: () => void
  onVerified: (profile: CustomerProfile) => void
}) {
  const [draft, setDraft] = useState({
    name: profile.name || "",
    phone: phoneInputValueFromStored(profile.phone),
    email: profile.email || "",
    city: normalizeServiceCity(profile.city),
  })

  useEffect(() => {
    setDraft((current) => {
      const next = {
        name: profile.name || "",
        phone: phoneInputValueFromStored(profile.phone),
        email: profile.email || "",
        city: normalizeServiceCity(profile.city),
      }
      const currentPhoneValid = validateUkraineMobilePhone(current.phone).valid
      const nextPhoneValid = validateUkraineMobilePhone(next.phone).valid
      if (currentPhoneValid && !nextPhoneValid) next.phone = current.phone
      if (current.name.trim() && !next.name.trim()) next.name = current.name
      if (current.email.trim() && !next.email.trim()) next.email = current.email
      if (!currentPhoneValid && nextPhoneValid) next.phone = next.phone
      return next
    })
  }, [profile.id, profile.name, profile.phone, profile.email, profile.city])

  const patchDraft = (patch: Partial<CustomerProfile>) => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
  }

  const checklist = getProfileChecklist({ ...profile, ...draft })
  const initials = (draft.name || profile.name || "POMICH").trim().slice(0, 1).toUpperCase()
  const phoneDisplay = draft.phone?.trim()
    ? `+380 ${formatLocalPhoneDisplay(nationalDigitsFromPhone(draft.phone))}`
    : profile.phone?.trim()
      ? `+380 ${formatLocalPhoneDisplay(nationalDigitsFromPhone(profile.phone))}`
      : "Не вказано"
  const nameDisplay = draft.name?.trim() || profile.name?.trim() || "Клієнт POMICH"
  const profileTone = customerProfileStatusTone({ ...profile, ...draft })
  const draftComplete = isCustomerProfileComplete({ ...profile, ...draft })
  const profileVerified = isCustomerVerified({ ...profile, ...draft })

  return (
    <div style={{ background: CARD, borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, minWidth: 0, alignItems: "flex-start" }}>
        <div style={{ width: 48, height: 48, borderRadius: 999, background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950, fontSize: 20, flex: "0 0 auto" }}>{initials}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: DARK, fontWeight: 950, fontSize: 15 }}>Ваш профіль</div>
          <div style={{ color: MUTED, fontSize: 12, fontWeight: 800, marginTop: 3 }}>{nameDisplay} · {phoneDisplay}</div>
          {!profileVerified ? (
            <div style={{ marginTop: 7 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 10px", background: profileTone.background, border: `1px solid ${profileTone.border}`, color: profileTone.color, fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: profileTone.color }} />
                {customerProfileStatusLabel({ ...profile, ...draft })}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label className="pomich-form-field">
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Ім'я *</span>
          <input value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} placeholder="Ваше ім'я" className="pomich-form-input" style={{ color: DARK }} />
        </label>
        <label className="pomich-form-field">
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Телефон *</span>
          <PhoneInput value={draft.phone} onChange={(phone) => patchDraft({ phone })} />
        </label>
        <label className="pomich-form-field">
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Email</span>
          <input value={draft.email} onChange={(event) => patchDraft({ email: event.target.value })} inputMode="email" placeholder="email@example.com" className="pomich-form-input" style={{ color: DARK }} />
        </label>
        <CitySelect
          value={draft.city || profile.city || DEFAULT_SERVICE_CITY}
          onChange={(city) => {
            patchDraft({ city })
            writePreferredCity(city)
            writeCityUserPicked(true)
          }}
          label="Місто для довідника СТО/АЗС"
        />
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 12, background: SURFACE_TONE }}>
        <div style={{ fontWeight: 950, fontSize: 13, color: DARK, marginBottom: 8 }}>{profileChecklistSummary({ ...profile, ...draft })}</div>
        <div className="pomich-form-field">
          {checklist.map((item) => (
            <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 800 }}>
              <span style={{ color: "var(--pomich-label)" }}>{item.label}{item.required ? " *" : ""}</span>
              <span style={{ color: item.filled ? BRAND : SUBTLE }}>{profileChecklistItemStatus(item)}</span>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onVerify} disabled={saving || !draftComplete} style={{ minHeight: 42, borderRadius: 14, border: "none", background: saving || !draftComplete ? GHOST : BRAND, color: saving || !draftComplete ? MUTED : "#fff", fontFamily: "inherit", fontWeight: 950, cursor: saving || !draftComplete ? "not-allowed" : "pointer", display: isTelegram ? "none" : undefined }}>
        {saving ? "Зберігаємо…" : "Зберегти профіль"}
      </button>
      {!isCustomerVerified(profile) && draftComplete ? (
        <OtpVerificationPanel
          profile={{ ...profile, ...draft }}
          customerToken={customerToken}
          isTelegram={isTelegram}
          phone={draft.phone}
          email={draft.email}
          compact
          onVerified={onVerified}
        />
      ) : null}
      {error ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 12, padding: 10, fontSize: 12, fontWeight: 850 }}>{error}</div> : null}
    </div>
  )
}
