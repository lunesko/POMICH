

export default function SecondaryButton({ label, onClick, danger = false, disabled = false }: { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`pomich-flow-secondary-btn${danger ? " is-danger" : ""}`}
    >
      {label}
    </button>
  )
}
