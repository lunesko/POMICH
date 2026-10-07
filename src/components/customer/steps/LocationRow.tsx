import { SELECTED, GHOST } from "./flowTheme"

export default function LocationRow({ icon, title, subtitle, active = false }: { icon: string; title: string; subtitle: string; active?: boolean }) {
  return (
    <div className="pomich-location-row">
      <div className="pomich-location-row__icon" style={{ background: active ? SELECTED : GHOST }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="pomich-location-row__title">{title}</div>
        <div className="pomich-location-row__subtitle">{subtitle}</div>
      </div>
    </div>
  )
}
