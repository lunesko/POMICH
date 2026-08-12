import { BORDER } from "../../lib/constants"

interface SecondaryButtonProps {
  label: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}

export function SecondaryButton({ label, onClick, danger = false, disabled = false }: SecondaryButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: "100%", minHeight: 46, padding: "12px 14px", borderRadius: 14, background: disabled ? "#F3F4F6" : danger ? "#FFF1F2" : "#F3F4F6", color: disabled ? "#9CA3AF" : danger ? "#BE123C" : "#374151", border: `1px solid ${danger ? "#FECDD3" : BORDER}`, fontSize: 14, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}
    >
      {label}
    </button>
  )
}
