import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import SupportCases from "./SupportCases"
import { getSupportCases, updateSupportCase, type SupportCase } from "../../api/client"
vi.mock("../../api/client", () => ({ getSupportCases: vi.fn(), updateSupportCase: vi.fn(), messageFromFetchError: () => "Error" }))
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })
it("refreshes the editor when another administrator updates the case", async () => {
  vi.useFakeTimers()
  const row: SupportCase = { id: "case-1", orderId: "order-1", customerId: "customer-1", reason: "other", description: "Synthetic report", status: "open", createdAt: "2026-10-26T10:00:00Z", updatedAt: "2026-10-26T10:00:00Z" }
  vi.mocked(getSupportCases).mockResolvedValue([row])
  await act(async () => { render(<SupportCases />) })
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsaved draft" } })
  vi.mocked(getSupportCases).mockResolvedValue([{ ...row, status: "resolved", resolution: "Resolved by another admin", updatedAt: "2026-10-26T10:01:00Z" }])
  await act(async () => { vi.advanceTimersByTime(15000) })
  expect(screen.getByRole("combobox")).toHaveValue("resolved")
  expect(screen.getByRole("textbox")).toHaveValue("Resolved by another admin")
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Зберегти звернення" })) })
  expect(updateSupportCase).toHaveBeenCalledWith("case-1", "resolved", "Resolved by another admin", undefined)
})
