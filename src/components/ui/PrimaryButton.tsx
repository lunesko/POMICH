interface PrimaryButtonProps {
  label: string
  onClick?: () => void
  loading?: boolean
  disabled?: boolean
}

export function PrimaryButton({ label, onClick, loading = false, disabled = false }: PrimaryButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`pomich-primary-btn${isDisabled ? " is-disabled" : ""}`}
    >
      {loading ? "Створюємо заявку…" : label}
    </button>
  )
}
