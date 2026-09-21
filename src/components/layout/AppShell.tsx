import type { ReactNode } from "react"

import type { Role } from "../../lib/constants"
import { useTelegramBackButton, useTelegramUx } from "../../hooks/useTelegramUx"
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

export function AppShell({
  children,
  compact,
  role,
  loggedInName,
  onRoleChange,
  onOpenCabinet,
  onSwitchRole,
  onLogout,
}: AppShellProps) {
  const { isTelegram } = useTelegramUx()
  const showTelegramBack = Boolean(compact && role && isTelegram)
  const showSessionName = Boolean(loggedInName && !isTelegram)
  // Always keep an explicit «Кабінет» chip — name alone was too easy to miss.
  const showCabinetChip = Boolean(onOpenCabinet)
  // Compact chrome: logout only inside cabinet.
  const showLogoutChip = Boolean(onLogout && !compact)

  useTelegramBackButton({
    visible: showTelegramBack,
    onClick: () => onRoleChange(null),
  })

  if (compact) {
    return (
      <div className="pomich-tg-app flex flex-col">
        {role ? (
          <header className="pomich-tg-header w-full">
            <div className="pomich-app-header-bar">
              {!showTelegramBack ? (
                <button
                  type="button"
                  onClick={() => onRoleChange(null)}
                  className="pomich-app-header-menu-btn"
                  aria-label="Меню"
                  title="Меню"
                >
                  ←
                </button>
              ) : null}
              {showSessionName ? (
                <div className="pomich-app-header-session" title={loggedInName}>
                  <span className="pomich-app-header-session__name">{loggedInName}</span>
                </div>
              ) : (
                <div className="min-w-0 flex-1" aria-hidden="true" />
              )}
              <div className="pomich-app-header-actions-cluster" role="toolbar" aria-label="Дії">
                <ThemeToggle compact />
                {showCabinetChip ? (
                  <button
                    type="button"
                    onClick={onOpenCabinet}
                    className="pomich-app-header-chip pomich-app-header-chip--compact"
                    title="Кабінет"
                    aria-label="Кабінет"
                  >
                    Кабінет
                  </button>
                ) : null}
                {onSwitchRole ? (
                  <button
                    type="button"
                    onClick={onSwitchRole}
                    className="pomich-app-header-chip pomich-app-header-chip--compact"
                    title="Змінити роль"
                    aria-label="Змінити роль"
                  >
                    Роль
                  </button>
                ) : null}
              </div>
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
        <header className="pomich-tg-header w-full">
          <div className="pomich-app-header-bar" style={{ maxWidth: "80rem", marginInline: "auto", paddingInline: "1.5rem" }}>
            <button type="button" onClick={() => onRoleChange(null)} className="pomich-app-header-brand text-xl">
              POMICH
            </button>
            {loggedInName ? (
              <span className="pomich-app-header-session hidden md:inline">
                <span className="pomich-app-header-session__name">Ви увійшли як: {loggedInName}</span>
              </span>
            ) : null}
            <div className="pomich-app-header-actions-cluster">
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
              {showLogoutChip ? (
                <button
                  type="button"
                  onClick={onLogout}
                  className="pomich-app-header-chip pomich-app-header-chip--regular pomich-app-header-chip--muted"
                >
                  Вийти
                </button>
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
