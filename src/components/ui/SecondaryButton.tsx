interface SecondaryButtonProps {
  label: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  className?: string
}

export function SecondaryButton({
  label,
  onClick,
  danger = false,
  disabled = false,
  className = "",
}: SecondaryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`pomich-flow-secondary-btn${danger ? " is-danger" : ""}${className ? ` ${className}` : ""}`}
    >
      {label}
    </button>
  )
}

export default SecondaryButton
