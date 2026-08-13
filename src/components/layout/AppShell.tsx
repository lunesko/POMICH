import type { ReactNode } from "react"

import type { Role } from "../../lib/constants"
import { ThemeToggle } from "../ui/ThemeToggle"

interface AppShellProps {
  children: ReactNode
  compact: boolean
  role: Role | null
  loggedInName?: string
  onRoleChange: (role: Role | null) => void
  onOpenCabinet?: () => void
  onSwitchRole?: () => void
  onLogout?: () => void
}

export function AppShell({ children, compact, role, loggedInName, onRoleChange, onOpenCabinet, onSwitchRole, onLogout }: { children: React.ReactNode; compact: boolean; role: Role | null; loggedInName?: string; onRoleChange: (role: Role | null) => void; onOpenCabinet?: () => void; onSwitchRole?: () => void; onLogout?: () => void }) {
  if (compact) {
    return (
      <div className="pomich-tg-app flex flex-col">
        {role ? (
          <header className="pomich-tg-header flex shrink-0 items-center justify-between px-3 gap-2 w-full overflow-visible">
            <button type="button" onClick={() => onRoleChange(null)} className="pomich-app-header-menu-btn">← Меню</button>
            {loggedInName ? (
              <div className="pomich-app-header-session min-w-0 flex-1 text-center">{loggedInName}</div>
            ) : (
              <div className="flex-1" aria-hidden="true" />
            )}
            <div className="flex items-center gap-1.5 shrink-0">
              <ThemeToggle compact />
              {onOpenCabinet ? (
                <button type="button" onClick={onOpenCabinet} className="pomich-app-header-chip pomich-app-header-chip--compact">Кабінет</button>
              ) : null}
              {onSwitchRole ? (
                <button type="button" onClick={onSwitchRole} className="pomich-app-header-chip pomich-app-header-chip--compact">Роль</button>
              ) : null}
              {onLogout ? (
                <button type="button" onClick={onLogout} className="pomich-app-header-chip pomich-app-header-chip--compact pomich-app-header-chip--muted">Вийти</button>
              ) : null}
            </div>
          </header>
        ) : null}
        <div className="pomich-tg-main pomich-app-main min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    )
  }

  return (
    <div className="pomich-themed-shell min-h-dvh">
      {role ? (
        <header className="pomich-tg-header flex shrink-0 items-center justify-center px-6 w-full overflow-visible">
          <div className="flex w-full max-w-7xl items-center justify-between gap-4 min-h-[var(--pomich-app-header-height)]">
            <button type="button" onClick={() => onRoleChange(null)} className="pomich-app-header-brand text-xl">POMICH</button>
            {loggedInName ? (
              <span className="pomich-app-header-session hidden md:inline">Ви увійшли як: {loggedInName}</span>
            ) : null}
            <div className="pomich-app-header-actions flex items-center gap-2 overflow-x-auto py-1">
              <ThemeToggle />
              {onOpenCabinet ? (
                <button type="button" onClick={onOpenCabinet} className="pomich-app-header-chip pomich-app-header-chip--regular">Кабінет</button>
              ) : null}
              {onSwitchRole ? (
                <button type="button" onClick={onSwitchRole} className="pomich-app-header-chip pomich-app-header-chip--regular">Змінити роль</button>
              ) : null}
              {onLogout ? (
                <button type="button" onClick={onLogout} className="pomich-app-header-chip pomich-app-header-chip--regular pomich-app-header-chip--muted">Вийти</button>
              ) : null}
            </div>
          </div>
        </header>
      ) : null}
      <div className="pomich-app-main min-h-0 flex-1">{children}</div>
    </div>
  )
}


export default AppShell
