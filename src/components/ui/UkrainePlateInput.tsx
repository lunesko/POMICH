import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent } from "react"

import {
  appendUkrainePlateChar,
  backspaceUkrainePlate,
  formatUkrainePlateInput,
  parseUkrainePlateInput,
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
  const compactLen = parseUkrainePlateInput(display).length
  const showLiveError = Boolean(display && live && !live.valid && compactLen >= 8)

  const commit = (next: string) => {
    onChange(formatUkrainePlateInput(next))
  }

  /** Prefer beforeinput so each Cyrillic key is appended to compact form, not reparsed from spaced DOM value. */
  const handleBeforeInput = (event: FormEvent<HTMLInputElement> & { nativeEvent: InputEvent }) => {
    if (disabled) return
    const inputEvent = event.nativeEvent
    const type = inputEvent.inputType || ""

    if (type === "insertText" || type === "insertCompositionText") {
      const data = inputEvent.data
      if (!data) return
      event.preventDefault()
      let next = display
      for (const char of data) {
        next = appendUkrainePlateChar(next, char)
      }
      commit(next)
      return
    }

    if (type === "insertFromPaste") {
      // Let onPaste handle paste explicitly.
      event.preventDefault()
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return
    event.preventDefault()
    const text = event.clipboardData.getData("text") || ""
    commit(formatUkrainePlateInput(display + text))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (event.key === "Backspace") {
      event.preventDefault()
      commit(backspaceUkrainePlate(display))
    }
  }

  // Fallback for browsers without reliable beforeinput.
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    commit(formatUkrainePlateInput(event.target.value))
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
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={display}
          onBeforeInput={handleBeforeInput}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? UA_PLATE_PLACEHOLDER}
          className="pomich-plate__field"
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
