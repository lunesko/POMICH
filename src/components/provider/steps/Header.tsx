import { type OrderStatus } from "../../../lib/constants"
import { FormHeader } from "../../layout/FormContainer"
import StatusPill from "./StatusPill"

export default function Header({
  title,
  subtitle,
  onBack,
  status,
  showThemeToggle: _showThemeToggle,
  compactToggle: _compactToggle,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  status?: OrderStatus
  showThemeToggle?: boolean
  compactToggle?: boolean
}) {
  return (
    <FormHeader>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {onBack ? <button type="button" aria-label="Назад" onClick={onBack} className="pomich-back-btn">←</button> : null}
          <div style={{ minWidth: 0 }}>
            <div className="pomich-header-title">{title}</div>
            {subtitle ? <div className="pomich-header-subtitle">{subtitle}</div> : null}
          </div>
        </div>
        {status ? <StatusPill status={status} /> : null}
      </div>
    </FormHeader>
  )
}
