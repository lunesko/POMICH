import { type ProviderAvailability } from "../../../api/client"
import { getProviderCapabilityLabel, toServiceKeys, providerStatusLabel, nearbyProvidersFor, distanceToProvider, type Point } from "../../../lib/constants"
import VerificationPill from "./VerificationPill"
import { BRAND, BORDER, DARK, CARD, MUTED, SELECTED, BG } from "./flowTheme"

export default function AvailabilityPanel({ pickup, providers, loading }: { pickup: Point; providers: ProviderAvailability[]; loading: boolean }) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const nearest = nearby[0]

  return (
    <div style={{ background: CARD, borderRadius: 14, border: `1px solid ${BORDER}`, padding: "10px 12px", display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 950, color: DARK, fontSize: 14 }}>{loading ? "Перевіряємо партнерів" : nearby.length > 0 ? `${nearby.length} на лінії поруч` : "Партнерів поруч не видно"}</div>
          <div style={{ color: MUTED, fontWeight: 700, fontSize: 11, marginTop: 2, lineHeight: 1.35 }}>
            {nearest
              ? typeof nearest.etaMinutes === "number"
                ? `Найближчий: ${nearest.name} · ~${nearest.etaMinutes} хв`
                : `Найближчий: ${nearest.name} · ${distanceToProvider(pickup, nearest).toFixed(1)} км`
              : "Можна створити заявку — диспетчер підключить вручну."}
          </div>
        </div>
        <div style={{ borderRadius: 999, padding: "5px 8px", background: nearby.length > 0 ? SELECTED : "var(--pomich-warn-bg)", color: nearby.length > 0 ? BRAND : "var(--pomich-warn-text)", fontSize: 11, fontWeight: 950 }}>
          {nearby.length > 0 ? "Live" : "Очікування"}
        </div>
      </div>
      {nearby.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {nearby.slice(0, 2).map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: BG, borderRadius: 14, padding: "10px 12px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: DARK, fontWeight: 900, fontSize: 13 }}>{item.name} · {item.vehicle ?? "Автодопомога"}</div>
                <div style={{ color: MUTED, fontSize: 12, fontWeight: 700, marginTop: 2 }}>{providerStatusLabel(item.status)} · {distanceToProvider(pickup, item).toFixed(1)} км</div>
                <div style={{ color: MUTED, fontSize: 11, fontWeight: 800, marginTop: 3 }}>{toServiceKeys(item.specialties).map(getProviderCapabilityLabel).join(" · ") || "Послуги уточнюються"}</div>
                <div style={{ marginTop: 7 }}><VerificationPill status={item.verificationStatus} /></div>
              </div>
              <div style={{ color: BRAND, fontWeight: 950, whiteSpace: "nowrap" }}>
                {typeof item.etaMinutes === "number"
                  ? `~${item.etaMinutes} хв`
                  : `${distanceToProvider(pickup, item).toFixed(1)} км`}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
