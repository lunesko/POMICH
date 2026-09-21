import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"

import { PomichThemeProvider } from "../../context/PomichThemeProvider"
import AppShell from "./AppShell"

vi.mock("../../hooks/useTelegramUx", () => ({
  useTelegramUx: () => ({ isTelegram: false }),
  useTelegramBackButton: () => undefined,
}))

function renderShell(ui: ReactNode) {
  return render(<PomichThemeProvider>{ui}</PomichThemeProvider>)
}

describe("AppShell compact header", () => {
  it("shows the user name on the left and Кабінет next to Роль on the right", async () => {
    const user = userEvent.setup()
    const onOpenCabinet = vi.fn()
    const onSwitchRole = vi.fn()

    renderShell(
      <AppShell
        compact
        role="customer"
        loggedInName="Роман"
        onRoleChange={() => undefined}
        onOpenCabinet={onOpenCabinet}
        onSwitchRole={onSwitchRole}
      >
        <div>content</div>
      </AppShell>,
    )

    expect(screen.getByText("Роман")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Роман$/i })).not.toBeInTheDocument()

    const cabinet = screen.getByRole("button", { name: /^Кабінет$/i })
    const role = screen.getByRole("button", { name: /Змінити роль|Роль/i })
    expect(cabinet.compareDocumentPosition(role) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(cabinet)
    expect(onOpenCabinet).toHaveBeenCalledTimes(1)
  })

  it("keeps Кабінет on the right even without a display name", () => {
    renderShell(
      <AppShell compact role="customer" onRoleChange={() => undefined} onOpenCabinet={() => undefined} onSwitchRole={() => undefined}>
        <div>content</div>
      </AppShell>,
    )

    expect(screen.getByRole("button", { name: /^Кабінет$/i })).toBeInTheDocument()
    expect(screen.queryByText("Кабінет", { selector: ".pomich-app-header-session__name" })).not.toBeInTheDocument()
  })
})
