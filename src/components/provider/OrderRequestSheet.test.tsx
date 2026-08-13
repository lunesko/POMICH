import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { OrderRequestSheet } from "./OrderRequestSheet"

vi.mock("../ui/PrimaryButton", () => ({
  PrimaryButton: ({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{label}</button>
  ),
}))

vi.mock("../ui/SecondaryButton", () => ({
  SecondaryButton: ({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{label}</button>
  ),
}))

describe("OrderRequestSheet", () => {
  it("keeps accept CTA visible and submits a valid price", async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    const onProposedPriceChange = vi.fn()

    render(
      <OrderRequestSheet
        pin={{
          id: "ord-1",
          offerId: "of-1",
          service: "battery",
          customerLocation: "Ужгород",
          distanceKm: 1.2,
          etaMinutes: 8,
        }}
        proposedPrice="900"
        saving={false}
        secondsLeft={25}
        onProposedPriceChange={onProposedPriceChange}
        onAccept={onAccept}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: /ПРИЙНЯТИ З ЦІНОЮ/i })).toBeInTheDocument()
    expect(screen.getByLabelText("Вартість послуги в гривнях")).toHaveValue("900")

    await user.click(screen.getByRole("button", { name: /ПРИЙНЯТИ З ЦІНОЮ/i }))
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledWith("900")
  })

  it("blocks accept without a price and focuses the input", async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    const onAcceptBlocked = vi.fn()

    render(
      <OrderRequestSheet
        pin={{
          id: "ord-2",
          offerId: "of-2",
          service: "tow",
          customerLocation: "Ужгород",
          distanceKm: 3,
        }}
        proposedPrice=""
        saving={false}
        secondsLeft={20}
        onProposedPriceChange={vi.fn()}
        onAccept={onAccept}
        onClose={vi.fn()}
        onAcceptBlocked={onAcceptBlocked}
      />,
    )

    await user.click(screen.getByRole("button", { name: /ПРИЙНЯТИ З ЦІНОЮ/i }))
    expect(onAccept).not.toHaveBeenCalled()
    expect(onAcceptBlocked).toHaveBeenCalledWith("price")
  })

  it("auto-blocks when offer already expired", () => {
    const onAcceptBlocked = vi.fn()
    render(
      <OrderRequestSheet
        pin={{
          id: "ord-3",
          offerId: "of-3",
          service: "fuel",
          customerLocation: "Ужгород",
          distanceKm: 2,
        }}
        proposedPrice="500"
        saving={false}
        secondsLeft={0}
        onProposedPriceChange={vi.fn()}
        onAccept={vi.fn()}
        onClose={vi.fn()}
        onAcceptBlocked={onAcceptBlocked}
      />,
    )

    expect(screen.getByRole("button", { name: /Час вийшов/i })).toBeInTheDocument()
    expect(onAcceptBlocked).toHaveBeenCalledWith("expired")
  })

  it("calls onDecline when partner skips the request", async () => {
    const user = userEvent.setup()
    const onDecline = vi.fn()

    render(
      <OrderRequestSheet
        pin={{
          id: "ord-4",
          service: "tow",
          customerLocation: "Ужгород",
          distanceKm: 2,
        }}
        proposedPrice=""
        saving={false}
        secondsLeft={30}
        onProposedPriceChange={vi.fn()}
        onAccept={vi.fn()}
        onDecline={onDecline}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: /Пропустити/i }))
    expect(onDecline).toHaveBeenCalledTimes(1)
  })
})
