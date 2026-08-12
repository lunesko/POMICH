import type { ChangeEvent } from "react"

import {
  formatLocalPhoneDisplay,
  nationalDigitsFromPhone,
  parseUkrainePhoneInput,
  phoneInputValueFromStored,
  toE164,
  UA_PHONE_PLACEHOLDER,
} from "../../lib/ukrainePhone"

interface PhoneInputProps {
  value: string
  onChange: (e164: string) => void
  error?: string
  height?: number
  disabled?: boolean
}

export function PhoneInput({ value, onChange, error, height, disabled }: PhoneInputProps) {
  const normalizedValue = phoneInputValueFromStored(value)
  const national = nationalDigitsFromPhone(normalizedValue)
  const display = formatLocalPhoneDisplay(national)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = parseUkrainePhoneInput(event.target.value)
    onChange(parsed ? toE164(parsed) : "")
  }

  return (
    <div className={`pomich-phone-input${error ? " is-error" : ""}`}>
      <div className="pomich-phone-wrap" style={disabled ? { opacity: 0.7 } : undefined}>
        <div className="pomich-phone-prefix">+380</div>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={display}
          onChange={handleChange}
          disabled={disabled}
          placeholder={UA_PHONE_PLACEHOLDER}
          className="pomich-phone-field"
          style={height ? { height } : undefined}
        />
      </div>
      {error ? <div className="pomich-phone-error">{error}</div> : null}
    </div>
  )
}

export default PhoneInput
