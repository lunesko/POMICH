interface PrimaryButtonProps {
  label: string
  onClick?: () => void
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
}

export function PrimaryButton({
  label,
  onClick,
  loading = false,
  loadingLabel = "Зачекайте…",
  disabled = false,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`pomich-primary-btn${isDisabled ? " is-disabled" : ""}`}
    >
      {loading ? loadingLabel : label}
    </button>
  )
}
