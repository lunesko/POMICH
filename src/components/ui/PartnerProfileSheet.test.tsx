import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PartnerProfileSheet } from "./PartnerProfileSheet"

vi.mock("../../telegram", () => ({
  getTelegramContext: () => ({ isTelegram: false }),
}))

const provider = {
  id: "provider-oleksandr",
  name: "Олександр",
  status: "online" as const,
  rating: 4.9,
  distanceKm: 1.4,
  etaMinutes: 8,
  specialties: ["tow", "fuel"],
  vehicle: "Volkswagen Crafter",
}

describe("PartnerProfileSheet", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  })

  it("loads public profile with reviews and closes", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/providers/provider-oleksandr/public")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: "provider-oleksandr",
              name: "Олександр",
              rating: 4.9,
              ratingCount: 2,
              specialties: ["tow", "fuel"],
              vehicle: "Volkswagen Crafter",
              reviews: [
                { rating: 5, comment: "Швидко приїхав", at: "2026-08-01T12:00:00", service: "tow" },
                { rating: 4, comment: "", at: "2026-07-20T12:00:00", service: "fuel" },
              ],
            }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }),
    )

    render(<PartnerProfileSheet provider={provider} onClose={onClose} />)

    expect(await screen.findByText("Олександр")).toBeInTheDocument()
    expect(await screen.findByText("Швидко приїхав")).toBeInTheDocument()
    expect(screen.getByText(/1\.4 км/)).toBeInTheDocument()
    expect(screen.getByText(/~8 хв/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Закрити/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it("shows directory reviews without fetching public profile", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <PartnerProfileSheet
        provider={{ ...provider, id: "dir-1", providerKind: "directory", name: "СТО Мир" }}
        onClose={() => undefined}
      />,
    )

    expect(await screen.findByText("СТО Мир")).toBeInTheDocument()
    expect(await screen.findByText(/Це запис із довідника/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows empty reviews state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            id: "provider-oleksandr",
            name: "Олександр",
            reviews: [],
          }),
        }),
      ),
    )

    render(<PartnerProfileSheet provider={provider} onClose={() => undefined} />)

    expect(await screen.findByText(/Поки немає відгуків/i)).toBeInTheDocument()
  })

  it("renders as a full-width bottom sheet portal on mobile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            id: "provider-oleksandr",
            name: "Олександр",
            reviews: [],
          }),
        }),
      ),
    )

    render(<PartnerProfileSheet provider={provider} onClose={() => undefined} />)

    const dialog = await screen.findByRole("dialog", { name: /Профіль партнера Олександр/i })
    expect(dialog).toHaveClass("pomich-partner-profile-sheet")
    expect(dialog).not.toHaveClass("pomich-partner-profile-sheet--desktop")
    expect(dialog.parentElement).toBe(document.body)
    expect(document.body.style.overflow).toBe("hidden")
  })
})
