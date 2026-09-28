import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConfirmDialogProvider, useConfirmDialog } from "./ConfirmDialog"

function Trigger() {
  const confirm = useConfirmDialog()
  return (
    <button type="button" onClick={async () => {
      const accepted = await confirm({ title: "Скасувати заявку?", description: "Партнер отримає сповіщення.", danger: true })
      if (accepted) document.body.dataset.confirmed = "yes"
    }}>
      Відкрити
    </button>
  )
}

describe("ConfirmDialog", () => {
  it("exposes an accessible alert dialog and resolves confirmation", async () => {
    delete document.body.dataset.confirmed
    render(<ConfirmDialogProvider><Trigger /></ConfirmDialogProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Відкрити" }))
    expect(screen.getByRole("alertdialog", { name: "Скасувати заявку?" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Підтвердити" }))
    expect(await screen.findByRole("button", { name: "Відкрити" })).toBeInTheDocument()
    expect(document.body.dataset.confirmed).toBe("yes")
  })

  it("closes on Escape without confirming", () => {
    delete document.body.dataset.confirmed
    render(<ConfirmDialogProvider><Trigger /></ConfirmDialogProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Відкрити" }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(document.body.dataset.confirmed).toBeUndefined()
  })
})
