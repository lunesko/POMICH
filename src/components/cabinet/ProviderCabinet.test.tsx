import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PomichThemeProvider } from '../../context/PomichThemeProvider'
import ProviderCabinet from './ProviderCabinet'

const providerProfile = {
  id: 'provider-oleksandr',
  name: 'Олександр',
  phone: '+380671112233',
  city: 'Ужгород',
  vehicle: 'Volkswagen Crafter',
  status: 'online' as const,
  verificationStatus: 'verified' as const,
  specialties: ['tow', 'fuel'],
  serviceRadiusKm: 12,
}

function renderCabinet(overrides?: Partial<Parameters<typeof ProviderCabinet>[0]>) {
  return render(
    <PomichThemeProvider>
      <ProviderCabinet
        providerId="provider-oleksandr"
        providerToken="pomich_auth_v1.provider-session"
        currentRole="provider"
        onBack={() => undefined}
        onSwitchRole={() => undefined}
        {...overrides}
      />
    </PomichThemeProvider>,
  )
}

describe('ProviderCabinet', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({ ok: true, json: async () => providerProfile })
      }
      if (url.includes('/providers/provider-oleksandr/offers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      if (url.endsWith('/providers')) {
        return Promise.resolve({ ok: true, json: async () => [providerProfile] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))
  })

  it('loads verified profile and shows online duty status', async () => {
    renderCabinet()

    expect(await screen.findByText('Олександр')).toBeInTheDocument()
    expect(screen.getByText('На лінії')).toBeInTheDocument()
    expect(screen.queryByText('Не перевірено')).not.toBeInTheDocument()
    expect(screen.getByText('Volkswagen Crafter')).toBeInTheDocument()
  })

  it('opens edit form and saves profile changes', async () => {
    const user = userEvent.setup()
    renderCabinet()

    await screen.findByText('Олександр')
    await user.click(screen.getByRole('button', { name: /^Редагувати$/i }))

    const nameInput = screen.getByPlaceholderText("Ваше ім'я")
    await user.clear(nameInput)
    await user.type(nameInput, 'Михайло')

    await user.click(screen.getByRole('button', { name: /^Зберегти$/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/providers/provider-oleksandr/profile'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  it('shows unverified status until OTP completes', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...providerProfile, verificationStatus: 'unverified', status: 'offline' }),
        })
      }
      if (url.includes('/providers/provider-oleksandr/offers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))

    renderCabinet()

    expect(await screen.findByText('Не перевірено')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Поза лінією')).toBeInTheDocument()
    })
    // Section title + OtpVerificationPanel both render this heading when unverified.
    expect(screen.getAllByText('Підтвердження телефону').length).toBeGreaterThanOrEqual(1)
  })
})
