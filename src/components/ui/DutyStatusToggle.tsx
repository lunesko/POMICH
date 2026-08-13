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

export const PRESENCE_CONNECTION_FALLBACK = "Не вдалося оновити статус. Перевірте з'єднання."

export function presenceErrorMessage(detail?: string): string {
  if (!detail) return PRESENCE_CONNECTION_FALLBACK

  if (detail === "provider verification must be approved before going online") {
    return "Підтвердіть телефон у Telegram, щоб вийти на лінію."
  }
  if (detail === "provider profile must be registered before going online") {
    return "Спочатку заповніть профіль партнера."
  }
  if (
    detail === "provider_session_missing" ||
    detail === "customer_session_missing" ||
    detail === "customer_session_required" ||
    detail === "customer_session_invalid" ||
    detail === "customer_session_expired" ||
    detail === "provider_session_required" ||
    detail === "provider_session_invalid" ||
    detail === "provider_session_expired" ||
    detail === "provider_auth_missing" ||
    detail === "provider_not_linked" ||
    detail === "bearer_token_invalid" ||
    detail === "role_forbidden"
  ) {
    return "Сесію не відкрито. Оновіть сторінку або увійдіть знову."
  }
  if (detail === "provider_identity_mismatch") {
    return "Акаунт партнера не збігається. Оновіть сторінку та спробуйте ще раз."
  }
  if (detail === "provider_credentials_invalid" || detail === "provider_token_invalid") {
    return "Не вдалося увійти як партнер. Оновіть сторінку або увійдіть знову."
  }
  // Already localized client/API copy (do not replace with the fake "connection" toast).
  if (/[А-Яа-яІіЇїЄєҐґ]/.test(detail) && !/^Provider\b/i.test(detail)) {
    return detail
  }
  return PRESENCE_CONNECTION_FALLBACK
}
