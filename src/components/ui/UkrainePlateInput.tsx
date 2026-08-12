import type { ChangeEvent } from "react"

import {
  formatUkrainePlateInput,
  plateInputValueFromStored,
  UA_PLATE_PLACEHOLDER,
} from "../../lib/ukrainePlate"

interface UkrainePlateInputProps {
  value: string
  onChange: (plate: string) => void
  error?: string
  disabled?: boolean
  placeholder?: string
}

export function UkrainePlateInput({
  value,
  onChange,
  error,
  disabled,
  placeholder,
}: UkrainePlateInputProps) {
  const display = plateInputValueFromStored(value)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(formatUkrainePlateInput(event.target.value))
  }

  return (
    <div className={`pomich-plate-input${error ? " is-error" : ""}`}>
      <div className={`pomich-plate${disabled ? " is-disabled" : ""}`}>
        <div className="pomich-plate__strip" aria-hidden="true">
          <div className="pomich-plate__flag">
            <span className="pomich-plate__flag-blue" />
            <span className="pomich-plate__flag-yellow" />
          </div>
          <span className="pomich-plate__ua">UA</span>
        </div>
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={display}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder ?? UA_PLATE_PLACEHOLDER}
          className="pomich-plate__field"
          maxLength={10}
          aria-label="Номер авто"
        />
      </div>
      {error ? <div className="pomich-form-error">{error}</div> : null}
    </div>
  )
}

export default UkrainePlateInput
