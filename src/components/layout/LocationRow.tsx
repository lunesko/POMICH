import { DARK } from "../../lib/constants"

interface LocationRowProps {
  icon: string
  title: string
  subtitle: string
  active?: boolean
}

export function LocationRow({ icon, title, subtitle, active = false }: LocationRowProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "36px 1fr", gap: 11, alignItems: "center", padding: "11px 0" }}>
      <div style={{ width: 36, height: 36, borderRadius: 12, background: active ? "#E8F8F1" : "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: DARK, fontWeight: 900, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ color: "#6B7280", fontWeight: 700, fontSize: 12, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>
      </div>
    </div>
  )
}

export default LocationRow
