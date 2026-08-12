import type { ReactNode } from "react"

import type { Role } from "../../lib/constants"
import { ThemeToggle } from "../ui/ThemeToggle"

interface AppShellProps {
  children: ReactNode
  compact: boolean
  role: Role | null
  onRoleChange: (role: Role | null) => void
  onOpenCabinet?: () => void
  onSwitchRole?: () => void
  onLogout?: () => void
}

const roleLabels: Record<Exclude<Role, null>, string> = {
  customer: "Клієнт",
  provider: "Партнер",
  admin: "Адмін",
}

export function AppShell({ children, compact, role, onRoleChange, onOpenCabinet, onSwitchRole, onLogout }: AppShellProps) {
  if (compact) {
    return (
      <div className="pomich-tg-app flex flex-col">
        {role ? (
          <header className="pomich-tg-header flex h-11 shrink-0 items-center justify-between px-3 gap-2">
            <button type="button" onClick={() => onRoleChange(null)} className="pomich-app-header-menu-btn">
              ← Меню
            </button>
            <div className="pomich-app-header-role-label">{roleLabels[role]}</div>
            <div className="flex items-center gap-1.5 shrink-0">
              <ThemeToggle compact />
              {onOpenCabinet ? (
                <button type="button" onClick={onOpenCabinet} className="pomich-app-header-chip pomich-app-header-chip--compact">
                  Кабінет
                </button>
              ) : null}
              {onSwitchRole ? (
                <button type="button" onClick={onSwitchRole} className="pomich-app-header-chip pomich-app-header-chip--compact">
                  Роль
                </button>
              ) : null}
              {onLogout ? (
                <button type="button" onClick={onLogout} className="pomich-app-header-chip pomich-app-header-chip--compact pomich-app-header-chip--muted">
                  Вийти
                </button>
              ) : null}
            </div>
          </header>
        ) : null}
        <div className="pomich-tg-main min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    )
  }

  return (
    <div className="pomich-themed-shell min-h-dvh">
      {role ? (
        <header className="pomich-tg-header relative z-[1400] flex h-[62px] shrink-0 items-center justify-center px-6">
          <div className="flex w-full max-w-7xl items-center justify-between gap-4">
            <a href="/" className="pomich-app-header-brand text-xl">POMICH</a>
            <div className="flex items-center gap-2 overflow-x-auto">
              {[
                { key: "customer" as const, label: "Клієнт" },
                { key: "provider" as const, label: "Партнер" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onRoleChange(item.key)}
                  className={`pomich-app-header-chip pomich-app-header-chip--regular${role === item.key ? " is-active" : ""}`}
                >
                  {item.label}
                </button>
              ))}
              <ThemeToggle />
              {onOpenCabinet ? (
                <button type="button" onClick={onOpenCabinet} className="pomich-app-header-chip pomich-app-header-chip--regular">
                  Кабінет
                </button>
              ) : null}
              {onSwitchRole ? (
                <button type="button" onClick={onSwitchRole} className="pomich-app-header-chip pomich-app-header-chip--regular">
                  Змінити роль
                </button>
              ) : null}
              {onLogout ? (
                <button type="button" onClick={onLogout} className="pomich-app-header-chip pomich-app-header-chip--regular pomich-app-header-chip--muted">
                  Вийти
                </button>
              ) : null}
            </div>
          </div>
        </header>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}

export default AppShell
