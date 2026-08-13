import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { OtpVerificationPanel } from "./OtpVerificationPanel"
import type { CustomerProfile } from "../../api/client"

const profile: CustomerProfile = {
  id: "guest-1",
  name: "Test",
  phone: "+380501112233",
  verificationStatus: "unverified",
}

describe("OtpVerificationPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("does not send OTP on mount (explicit trigger only)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          channel: "telegram",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          expiresInSeconds: 600,
          cooldownSeconds: 45,
        }),
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<OtpVerificationPanel profile={profile} customerToken="token" />)

    expect(await screen.findByRole("button", { name: /Надіслати код у Telegram/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it("ignores deprecated autoSendChannel and still requires button tap", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          channel: "telegram",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          expiresInSeconds: 600,
          cooldownSeconds: 45,
        }),
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(
      <OtpVerificationPanel
        profile={profile}
        customerToken="token"
        autoSendChannel="telegram"
      />,
    )

    expect(await screen.findByRole("button", { name: /Надіслати код у Telegram/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it("sends OTP only after explicit button tap", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("/auth/customer/verify/send")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            channel: "telegram",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            expiresInSeconds: 600,
            cooldownSeconds: 45,
          }),
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<OtpVerificationPanel profile={profile} customerToken="token" />)
    await user.click(screen.getByRole("button", { name: /Надіслати код у Telegram/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/customer/verify/send")
  })

  it("keeps manual resend with cooldown after send", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            channel: "telegram",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            expiresInSeconds: 600,
            cooldownSeconds: 45,
          }),
        }),
      ),
    )

    render(<OtpVerificationPanel profile={profile} customerToken="token" />)
    await user.click(screen.getByRole("button", { name: /Надіслати код у Telegram/i }))

    expect(await screen.findByRole("button", { name: /Повторно через|Надіслати код повторно/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Підтвердити/i })).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/6 цифр/i), "12345")
    expect(screen.getByRole("button", { name: /Підтвердити/i })).toBeDisabled()
  })

  it("shows inline phone save when phone missing instead of dead «Зберегти профіль» errors", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          channel: "telegram",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          expiresInSeconds: 600,
          cooldownSeconds: 45,
        }),
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(
      <OtpVerificationPanel
        profile={{ ...profile, phone: "" }}
        customerToken="token"
        isTelegram
      />,
    )

    expect(await screen.findByText(/Введіть номер і натисніть «Зберегти і надіслати код»/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Зберегти і надіслати код/i })).toBeInTheDocument()
    expect(screen.queryByText(/Спочатку введіть телефон і натисніть «Зберегти профіль»/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Спочатку введіть коректний номер телефону та натисніть «Зберегти профіль»/i)).not.toBeInTheDocument()
    expect(screen.getByText("Підтвердження телефону")).toBeInTheDocument()
    expect(screen.queryByText("Підтвердження профілю")).not.toBeInTheDocument()
    expect(screen.getByText(/не нова реєстрація/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it("saves phone and sends OTP from inline gate", async () => {
    const user = userEvent.setup()
    const onPhoneSaved = vi.fn()
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("/auth/customer/verify/send")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            channel: "telegram",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            expiresInSeconds: 600,
            cooldownSeconds: 45,
          }),
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <OtpVerificationPanel
        profile={{ ...profile, phone: "" }}
        customerToken="token"
        isTelegram
        onPhoneSaved={onPhoneSaved}
      />,
    )

    const phoneInput = screen.getByPlaceholderText("66 123 45 67")
    await user.type(phoneInput, "501112233")
    await user.click(screen.getByRole("button", { name: /Зберегти і надіслати код/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/customer/verify/send")
    expect(onPhoneSaved).toHaveBeenCalled()
    expect(await screen.findByPlaceholderText(/6 цифр/i)).toBeInTheDocument()
  })
})
