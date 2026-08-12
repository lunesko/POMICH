import type { ReactNode } from "react"

import type { OrderStatus } from "../../lib/constants"
import { StatusPill } from "../ui/StatusPill"
import { ThemeToggle } from "../ui/ThemeToggle"

interface HeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  status?: OrderStatus
  showThemeToggle?: boolean
  compactToggle?: boolean
  actions?: ReactNode
}

export function Header({ title, subtitle, onBack, status, showThemeToggle = true, compactToggle = false, actions }: HeaderProps) {
  return (
    <div className="pomich-form-header">
      <div className="pomich-cabinet-header-bar">
        <div className="pomich-cabinet-header-main">
          {onBack ? (
            <button type="button" aria-label="Назад" onClick={onBack} className="pomich-back-btn">←</button>
          ) : null}
          <div className="min-w-0">
            <div className="pomich-header-title">{title}</div>
            {subtitle ? <div className="pomich-header-subtitle">{subtitle}</div> : null}
          </div>
        </div>
        <div className="pomich-cabinet-header-actions">
          {showThemeToggle ? <ThemeToggle compact={compactToggle} /> : null}
          {status ? <StatusPill status={status} /> : null}
          {actions}
        </div>
      </div>
    </div>
  )
}

export default Header
