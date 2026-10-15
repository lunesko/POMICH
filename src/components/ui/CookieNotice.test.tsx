import { beforeEach, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import CookieNotice from "./CookieNotice"
import RememberSessionField from "./RememberSessionField"

beforeEach(() => { cleanup(); localStorage.clear() })

it("shows legal consent on first open, links terms and privacy, and remembers acceptance", () => {
  const view = render(<CookieNotice />)
  expect(screen.getByRole("link", { name: "Читати" }).getAttribute("href")).toBe("/terms")
  expect(screen.getByRole("link", { name: "Угодою користувача" }).getAttribute("href")).toBe("/terms")
  expect(screen.getByRole("link", { name: "Політикою конфіденційності" }).getAttribute("href")).toBe("/privacy")
  fireEvent.click(screen.getByRole("button", { name: "Погоджуюсь" }))
  expect(localStorage.getItem("pomichLegalConsent:v2")).toBe("accepted")
  expect(screen.queryByRole("dialog", { name: "Угода та конфіденційність" })).toBeNull()
  view.unmount()
  render(<CookieNotice />)
  expect(screen.queryByRole("dialog", { name: "Угода та конфіденційність" })).toBeNull()
})

it("explains the selected duration and defaults to an unchecked choice", () => {
  const view = render(<RememberSessionField checked={false} onChange={() => {}} />)
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
  expect(screen.getByText(/12 годин/)).toBeTruthy()
  view.rerender(<RememberSessionField checked onChange={() => {}} />)
  expect(screen.getByText(/30 днів/)).toBeTruthy()
})
