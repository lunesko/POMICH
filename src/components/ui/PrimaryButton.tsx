import type { ReactNode } from "react"
interface PrimaryButtonProps {
  label: ReactNode
  onClick?: () => void
  loading?: boolean
  loadingLabel?: ReactNode
  disabled?: boolean
}

export function PrimaryButton({
  label,
  onClick,
  loading = false,
  loadingLabel,
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
      {loading ? (loadingLabel ?? label) : label}
    </button>
  )
}
