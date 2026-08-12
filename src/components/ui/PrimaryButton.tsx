import { BRAND } from "../../lib/constants"

interface PrimaryButtonProps {
  label: string
  onClick?: () => void
  loading?: boolean
  disabled?: boolean
}

export function PrimaryButton({ label, onClick, loading = false, disabled = false }: PrimaryButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{ width: "100%", minHeight: 48, padding: "14px 16px", borderRadius: 14, background: disabled || loading ? "#CBD5E1" : BRAND, color: "#fff", border: "none", fontSize: 15, fontWeight: 800, cursor: disabled || loading ? "not-allowed" : "pointer", fontFamily: "inherit" }}
    >
      {loading ? "Створюємо заявку…" : label}
    </button>
  )
}
