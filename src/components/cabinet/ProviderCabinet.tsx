import { BRAND } from "../../lib/constants"
import { roleLabel, type UserRole } from "../../lib/userAccount"
import type { DispatchOffer, ProviderAvailability } from "../../api/client"
import { VerificationPill } from "../ui/VerificationPill"
import { ThemeToggle } from "../ui/ThemeToggle"

interface ProviderCabinetProps {
  profile: ProviderAvailability
  offers?: DispatchOffer[]
  currentRole: UserRole
  isOnline: boolean
  onBack: () => void
  onGoOnline: () => void
  onGoOffline: () => void
  onSwitchRole: () => void
  onEditProfile?: () => void
}

export default function ProviderCabinet({
  profile,
  offers = [],
  currentRole,
  isOnline,
  onBack,
  onGoOnline,
  onGoOffline,
  onSwitchRole,
  onEditProfile,
}: ProviderCabinetProps) {
  const name = profile.name?.trim() || "Партнер POMICH"

  return (
    <div className="pomich-cabinet-shell">
      <div className="pomich-cabinet-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={onBack} className="pomich-back-btn" aria-label="Назад">←</button>
          <div style={{ flex: 1 }}>
            <div className="pomich-header-title">Кабінет партнера</div>
            <div className="pomich-header-subtitle">{roleLabel(currentRole)} · POMICH</div>
          </div>
          <ThemeToggle compact />
          <button type="button" onClick={onSwitchRole} className="pomich-ghost-btn" style={{ borderRadius: 999, padding: "8px 12px", fontSize: 12 }}>
            Змінити роль
          </button>
        </div>
      </div>

      <div style={{ padding: 16, display: "grid", gap: 14, maxWidth: 640, margin: "0 auto" }}>
        <div className="pomich-cabinet-card">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg, #2F80ED, #D6B400)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950, fontSize: 22 }}>
              {name.trim().slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 950, fontSize: 17 }}>{name}</div>
              <div className="pomich-header-subtitle" style={{ marginTop: 4 }}>{profile.phone || "Телефон не вказано"}</div>
              <div className="pomich-header-subtitle">{profile.vehicle || "Авто не вказано"}</div>
              <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <VerificationPill status={profile.verificationStatus} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "6px 10px", background: isOnline ? "var(--pomich-selected-bg)" : "var(--pomich-service-tone-default)", color: isOnline ? BRAND : "var(--pomich-muted)", fontSize: 12, fontWeight: 900, border: `1px solid var(--pomich-border)` }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: isOnline ? BRAND : "var(--pomich-subtle)" }} />
                  {isOnline ? "На лінії" : "Поза лінією"}
                </span>
              </div>
            </div>
            {onEditProfile ? (
              <button type="button" onClick={onEditProfile} className="pomich-ghost-btn" style={{ borderRadius: 999, padding: "8px 10px", fontSize: 12 }}>Редагувати</button>
            ) : null}
          </div>
        </div>

        <div className="pomich-cabinet-card">
          <div style={{ fontWeight: 950, fontSize: 15, marginBottom: 12 }}>Вхідні заявки</div>
          {offers.length === 0 ? (
            <div className="pomich-ghost-btn" style={{ borderRadius: 12, padding: 14, fontWeight: 700, fontSize: 13, textAlign: "left" }}>
              Ще немає вхідних заявок. Вийдіть на лінію, щоб бачити нові оффери поруч.
            </div>
          ) : (
            offers.map((offer) => (
              <div key={offer.id} className="pomich-ghost-btn" style={{ borderRadius: 12, padding: 14, marginBottom: 8, textAlign: "left" }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>{offer.service || "Послуга"} · {offer.distanceKm?.toFixed(1) ?? "—"} км</div>
                <div className="pomich-header-subtitle" style={{ marginTop: 4 }}>{offer.status}</div>
              </div>
            ))
          )}
        </div>

        <button type="button" onClick={isOnline ? onGoOffline : onGoOnline} style={{ minHeight: 52, border: "none", borderRadius: 14, background: BRAND, color: "#fff", fontWeight: 950, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
          {isOnline ? "Піти з лінії" : "Вийти на лінію"}
        </button>
      </div>
    </div>
  )
}
