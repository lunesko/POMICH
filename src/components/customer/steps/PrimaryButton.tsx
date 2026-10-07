

export default function PrimaryButton({
  label,
  onClick,
  loading = false,
  loadingLabel,
  disabled = false,
}: {
  label: string
  onClick?: () => void
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`pomich-primary-btn${disabled || loading ? " is-disabled" : ""}`}
    >
      {loading ? (loadingLabel ?? label) : label}
    </button>
  )
}
