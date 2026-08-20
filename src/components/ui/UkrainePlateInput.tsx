import type { ChangeEvent } from "react"

import {
  formatUkrainePlateInput,
  plateInputValueFromStored,
  UA_PLATE_INPUT_HINT,
  UA_PLATE_PLACEHOLDER,
  validateUkrainePlate,
} from "../../lib/ukrainePlate"

interface UkrainePlateInputProps {
  value: string
  onChange: (plate: string) => void
  error?: string
  disabled?: boolean
  placeholder?: string
  showHint?: boolean
}

export function UkrainePlateInput({
  value,
  onChange,
  error,
  disabled,
  placeholder,
  showHint = true,
}: UkrainePlateInputProps) {
  const display = plateInputValueFromStored(value)
  const live = display ? validateUkrainePlate(display) : null
  const showLiveError = Boolean(display && live && !live.valid && display.replace(/\s/g, "").length >= 8)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(formatUkrainePlateInput(event.target.value))
  }

  return (
    <div className={`pomich-plate-input${error || showLiveError ? " is-error" : ""}`}>
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
          lang="uk"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={display}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder ?? UA_PLATE_PLACEHOLDER}
          className="pomich-plate__field"
          maxLength={10}
          aria-label="Номер авто"
          aria-invalid={Boolean(error || showLiveError)}
        />
      </div>
      {error ? <div className="pomich-form-error">{error}</div> : null}
      {!error && showLiveError && live?.error ? <div className="pomich-form-error">{live.error}</div> : null}
      {showHint && !error && !showLiveError ? (
        <div className="pomich-form-hint" style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--pomich-muted, #6B7280)", lineHeight: 1.4 }}>
          {UA_PLATE_INPUT_HINT}
        </div>
      ) : null}
    </div>
  )
}

export default UkrainePlateInput
