

export default function PrimaryButton({
  label,
  onClick,
  loading = false,
  disabled = false,
  loadingLabel = "Зачекайте…",
}: {
  label: string
  onClick?: () => void
  loading?: boolean
  disabled?: boolean
  loadingLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`pomich-primary-btn${disabled || loading ? " is-disabled" : ""}`}
    >
      {loading ? loadingLabel : label}
    </button>
  )
}
