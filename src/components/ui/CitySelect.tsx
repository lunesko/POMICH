import { ukraineCityOptions, DEFAULT_SERVICE_CITY } from "../../lib/ukraineCities"
import { FieldError } from "./FieldError"

interface CitySelectProps {
  value: string
  onChange: (city: string) => void
  error?: string
  hint?: string
  label?: string
  required?: boolean
  disabled?: boolean
  id?: string
}

const OPTIONS = ukraineCityOptions()

export function CitySelect({
  value,
  onChange,
  error,
  hint,
  label = "Оберіть місто",
  required = true,
  disabled,
  id = "pomich-city-select",
}: CitySelectProps) {
  const selected = value || ""
  return (
    <label style={{ display: "grid", gap: 6 }} htmlFor={id}>
      <span className="pomich-form-label">
        {label}
        {required ? " *" : ""}
      </span>
      <select
        id={id}
        value={selected}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`pomich-form-input pomich-city-select${error ? " is-error" : ""}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-feedback` : undefined}
      >
        <option value="" disabled>
          Оберіть місто
        </option>
        {OPTIONS.map((city) => (
          <option key={city} value={city}>
            {city === DEFAULT_SERVICE_CITY ? `${city} (за замовчуванням)` : city}
          </option>
        ))}
      </select>
      <FieldError id={`${id}-feedback`} error={error} hint={hint} />
    </label>
  )
}

export default CitySelect
