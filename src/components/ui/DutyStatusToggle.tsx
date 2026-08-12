interface DutyStatusToggleProps {
  onDuty: boolean
  disabled?: boolean
  saving?: boolean
  onToggle: () => void
}

export function DutyStatusToggle({ onDuty, disabled = false, saving = false, onToggle }: DutyStatusToggleProps) {
  const isDisabled = disabled || saving

  return (
    <button
      type="button"
      role="switch"
      aria-checked={onDuty}
      aria-label={onDuty ? "На лінії — натисніть, щоб піти з лінії" : "Поза лінією — натисніть, щоб вийти на лінію"}
      disabled={isDisabled}
      onClick={onToggle}
      className={`pomich-duty-toggle${onDuty ? " is-on" : " is-off"}`}
    >
      <span className="pomich-duty-toggle__knob" aria-hidden="true" />
    </button>
  )
}

interface PresenceToastProps {
  message: string
}

export function PresenceToast({ message }: PresenceToastProps) {
  return (
    <div
      role="alert"
      className="pomich-presence-toast"
    >
      {message}
    </div>
  )
}

export function presenceErrorMessage(detail?: string): string {
  if (detail === "provider verification must be approved before going online") {
    return "Підтвердіть телефон у Telegram, щоб вийти на лінію."
  }
  if (detail === "provider profile must be registered before going online") {
    return "Спочатку заповніть профіль партнера."
  }
  if (detail === "provider_session_missing" || detail === "customer_session_missing") {
    return "Сесію не відкрито. Оновіть сторінку або увійдіть знову."
  }
  return "Не вдалося оновити статус. Перевірте з'єднання."
}
