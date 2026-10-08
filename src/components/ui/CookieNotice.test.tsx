import { beforeEach, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import CookieNotice from "./CookieNotice"
import RememberSessionField from "./RememberSessionField"

beforeEach(() => { cleanup(); localStorage.clear() })
it("shows the notice, links the policy and remembers dismissal", () => {
  const view = render(<CookieNotice />)
  expect(screen.getByRole("link", { name: "Детальніше" }).getAttribute("href")).toBe("/privacy")
  fireEvent.click(screen.getByRole("button", { name: "Зрозуміло" }))
  expect(screen.queryByRole("complementary")).toBeNull()
  view.unmount()
  render(<CookieNotice />)
  expect(screen.queryByRole("complementary")).toBeNull()
})
it("explains the selected duration and defaults to an unchecked choice", () => {
  const view = render(<RememberSessionField checked={false} onChange={() => {}} />)
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
  expect(screen.getByText(/12 годин/)).toBeTruthy()
  view.rerender(<RememberSessionField checked onChange={() => {}} />)
  expect(screen.getByText(/30 днів/)).toBeTruthy()
})
