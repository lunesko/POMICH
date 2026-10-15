import { beforeEach, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import CookieNotice from "./CookieNotice"
import RememberSessionField from "./RememberSessionField"

beforeEach(() => { cleanup(); localStorage.clear() })

it("shows privacy consent on first open, links the policy and remembers acceptance", () => {
  const view = render(<CookieNotice />)
  expect(screen.getByRole("link", { name: "Читати" }).getAttribute("href")).toBe("/privacy")
  expect(screen.getByRole("link", { name: "Політикою конфіденційності" }).getAttribute("href")).toBe("/privacy")
  fireEvent.click(screen.getByRole("button", { name: "Погоджуюсь" }))
  expect(localStorage.getItem("pomichPrivacyConsent:v1")).toBe("accepted")
  expect(screen.queryByRole("dialog", { name: "Політика конфіденційності" })).toBeNull()
  view.unmount()
  render(<CookieNotice />)
  expect(screen.queryByRole("dialog", { name: "Політика конфіденційності" })).toBeNull()
})

it("explains the selected duration and defaults to an unchecked choice", () => {
  const view = render(<RememberSessionField checked={false} onChange={() => {}} />)
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
  expect(screen.getByText(/12 годин/)).toBeTruthy()
  view.rerender(<RememberSessionField checked onChange={() => {}} />)
  expect(screen.getByText(/30 днів/)).toBeTruthy()
})
