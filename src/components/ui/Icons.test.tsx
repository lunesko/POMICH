import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PrimaryButton } from "./PrimaryButton"
import { StatusPill } from "./StatusPill"
import { SecondaryButton } from "./SecondaryButton"
import Icon from "./Icon"
import RatingStars from "./RatingStars"
import { OrderReviewPanel } from "./OrderReviewPanel"

afterEach(cleanup)

describe("SVG interface semantics", () => {
  it("keeps the call action's accessible name and behavior", () => {
    const click = vi.fn()
    const { container } = render(<SecondaryButton label={<><Icon name="phone" /> Подзвонити</>} onClick={click} />)
    fireEvent.click(screen.getByRole("button", { name: "Подзвонити" }))
    expect(click).toHaveBeenCalledOnce()
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    expect(container.querySelector("svg")).toHaveAttribute("focusable", "false")
  })

  it("preserves a contextual loading label and prevents repeated submission", () => {
    const { rerender } = render(<PrimaryButton label="Надсилаємо заявку…" loading />)
    expect(screen.getByRole("button", { name: "Надсилаємо заявку…" })).toBeDisabled()
    rerender(<PrimaryButton label="Зберегти" loading loadingLabel="Зберігаємо…" />)
    expect(screen.getByRole("button", { name: "Зберігаємо…" })).toBeDisabled()
  })

  it("distinguishes completion from an active order", () => {
    const { container, rerender } = render(<StatusPill status="completed" />)
    expect(screen.getByText("Заявку завершено")).toHaveClass("pomich-status-pill--completed")
    expect(container.querySelector("use")?.getAttribute("href")).toContain("#check")
    rerender(<StatusPill status="searching" />)
    expect(screen.getByText("Очікуємо партнера")).toHaveClass("pomich-status-pill--searching")
    rerender(<StatusPill status="cancelled" />)
    expect(screen.getByText("Заявку скасовано")).toHaveClass("pomich-status-pill--cancelled")
  })

  it("renders readable ratings and preserves review selection and submission", () => {
    const { container, unmount } = render(<RatingStars rating={4} />)
    expect(screen.getByRole("img", { name: "4 з 5" })).toBeTruthy()
    expect(container.querySelectorAll(".pomich-icon-use--filled")).toHaveLength(4)
    unmount()
    const submit = vi.fn()
    render(<OrderReviewPanel title="Відгук" onSubmit={submit} />)
    expect(screen.getByRole("button", { name: "Надіслати оцінку" })).toBeDisabled()
    fireEvent.click(screen.getByRole("radio", { name: "3 з 5" }))
    expect(screen.getByRole("radio", { name: "3 з 5" })).toHaveAttribute("aria-checked", "true")
    fireEvent.click(screen.getByRole("button", { name: "Надіслати оцінку" }))
    expect(submit).toHaveBeenCalledWith({ rating: 3, comment: "" })
  })
})
