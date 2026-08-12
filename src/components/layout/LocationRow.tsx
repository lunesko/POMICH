interface LocationRowProps {
  icon: string
  title: string
  subtitle: string
  active?: boolean
}

export function LocationRow({ icon, title, subtitle, active = false }: LocationRowProps) {
  return (
    <div className="pomich-location-row">
      <div className="pomich-location-row__icon" style={{ background: active ? "#E8F8F1" : "#F3F4F6" }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="pomich-location-row__title">{title}</div>
        <div className="pomich-location-row__subtitle">{subtitle}</div>
      </div>
    </div>
  )
}

export default LocationRow
