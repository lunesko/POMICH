import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import OrderSupport from "./OrderSupport"
import { createSupportCase, getSupportCases } from "../../api/client"
vi.mock("../../api/client", () => ({ createSupportCase: vi.fn(), getSupportCases: vi.fn(), messageFromFetchError: (e: Error) => e.message }))
beforeEach(() => vi.resetAllMocks())
describe("order support", () => {
  it("keeps the description after a failed request and allows a retry", async () => {
    vi.mocked(getSupportCases).mockResolvedValue([])
    vi.mocked(createSupportCase).mockRejectedValueOnce(new Error("Немає інтернету")).mockResolvedValueOnce({ id: "SUP-1", orderId: "PM-1", customerId: "c1", reason: "help_not_received", description: "Партнер не приїхав", status: "open", createdAt: "", updatedAt: "" })
    render(<OrderSupport orderId="PM-1" token="customer-token" />)
    fireEvent.click(screen.getByRole("button", { name: "Повідомити про проблему" }))
    const input = await screen.findByRole("textbox", { name: "Опишіть проблему" })
    fireEvent.change(input, { target: { value: "Партнер не приїхав" } })
    fireEvent.click(screen.getByRole("button", { name: "Надіслати звернення" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Немає інтернету")
    expect(input).toHaveValue("Партнер не приїхав")
    fireEvent.click(screen.getByRole("button", { name: "Надіслати звернення" }))
    expect(await screen.findByText(/Звернення SUP-1/)).toBeInTheDocument()
    expect(createSupportCase).toHaveBeenLastCalledWith("PM-1", { reason: "help_not_received", description: "Партнер не приїхав" }, "customer-token")
  })
  it("shows the saved resolution on reopen without offering a duplicate case", async () => {
    vi.mocked(getSupportCases).mockResolvedValue([{ id: "SUP-1", orderId: "PM-1", customerId: "c1", reason: "help_not_received", description: "Не надано допомогу", status: "resolved", resolution: "Питання вирішено", createdAt: "", updatedAt: "" }])
    render(<OrderSupport orderId="PM-1" token="customer-token" />)
    fireEvent.click(screen.getByRole("button", { name: "Повідомити про проблему" }))
    expect(await screen.findByText(/Відповідь: Питання вирішено/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("button", { name: "Надіслати звернення" })).not.toBeInTheDocument())
  })
})
