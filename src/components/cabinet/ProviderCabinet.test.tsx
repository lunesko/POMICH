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
    window.sessionStorage.clear()
    window.localStorage.clear()
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

    await user.click(screen.getAllByRole('button', { name: /^Зберегти$/i })[0])

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/providers/provider-oleksandr/profile'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  it('opens in edit mode when initialEditing is set', async () => {
    renderCabinet({ initialEditing: true })

    expect(await screen.findByPlaceholderText("Ваше ім'я")).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Зберегти$/i }).length).toBeGreaterThan(0)
  })

  it('opens setup instead of error when provider profile is missing', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-new',
            providerId: 'provider-guest-new',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-guest-new',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/provider-guest-new/profile')) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'not found' }) })
      }
      if (url.endsWith('/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    }))

    window.sessionStorage.setItem('pomichCustomerId', 'guest-new')
    window.sessionStorage.setItem('pomichAuthSession:customer:guest-new', JSON.stringify({
      role: 'customer',
      subjectId: 'guest-new',
      accessToken: 'pomich_auth_v1.customer-guest-new',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }))

    renderCabinet({ providerId: 'provider-guest-new' })

    expect(await screen.findByPlaceholderText("Ваше ім'я")).toBeInTheDocument()
    expect(screen.queryByText('Не вдалося завантажити профіль партнера.')).not.toBeInTheDocument()
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

  it('prefills edit form when opened with initialEditing and saves with feedback', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/providers/provider-oleksandr/profile') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...providerProfile, name: 'Михайло' }),
        })
      }
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({ ok: true, json: async () => providerProfile })
      }
      if (url.includes('/providers/provider-oleksandr/offers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderCabinet({ initialEditing: true, initialProfile: providerProfile })

    expect(await screen.findByDisplayValue('Олександр')).toBeInTheDocument()
    const nameInput = screen.getByPlaceholderText("Ваше ім'я")
    await user.clear(nameInput)
    await user.type(nameInput, 'Михайло')

    await user.click(screen.getAllByRole('button', { name: /^Зберегти$/i })[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/providers/provider-oleksandr/profile'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
    expect(await screen.findByText(/Профіль збережено/i)).toBeInTheDocument()
  })

  it('shows validation feedback when save is blocked', async () => {
    const user = userEvent.setup()
    const incomplete = { ...providerProfile, name: '', vehicle: '', specialties: [] as string[] }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({ ok: true, json: async () => incomplete })
      }
      if (url.includes('/providers/provider-oleksandr/offers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))

    renderCabinet({
      initialEditing: true,
      initialProfile: incomplete,
    })

    const saveButtons = await screen.findAllByRole('button', { name: /^Зберегти$/i })
    await user.click(saveButtons[0])

    expect(screen.getAllByText(/Вкажіть ім/i).length).toBeGreaterThan(0)
  })
})
