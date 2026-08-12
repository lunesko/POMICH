interface ServiceRadiusFieldProps {
  value: number
  onChange: (value: number) => void
}

const RADIUS_HELPER =
  "На якій відстані від вашого міста ви готові приймати заявки (км). Наприклад: 7 км — центр міста, 30 км — місто + околиці."

function clampRadius(value: number) {
  return Math.max(1, Math.min(100, value))
}

export function ServiceRadiusField({ value, onChange }: ServiceRadiusFieldProps) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="pomich-form-label">Радіус обслуговування</span>
      <div className="pomich-radius-wrap">
        <input
          className="pomich-form-input pomich-radius-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={value}
          onChange={(event) => onChange(clampRadius(Number(event.target.value) || 1))}
          style={{ flex: 1, minWidth: 0 }}
        />
        <span className="pomich-radius-suffix">км</span>
      </div>
      <span style={{ color: "var(--pomich-subtle)", fontSize: 11, fontWeight: 700, lineHeight: 1.45 }}>{RADIUS_HELPER}</span>
    </label>
  )
}

export default ServiceRadiusField
