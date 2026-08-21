import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PomichThemeProvider } from '../../context/PomichThemeProvider'
import ClientCabinet, { resolveCabinetHistoryCustomerId } from './ClientCabinet'

const profile = {
  id: 'guest-stale',
  name: 'Віталій',
  phone: '+380661007434',
  city: 'Ужгород',
  email: '',
  telegram: '',
  verificationStatus: 'verified' as const,
}

function makeToken(subjectId: string) {
  const body = btoa(JSON.stringify({ role: 'customer', sub: subjectId, iat: 1, exp: 9999999999 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `pomich_auth_v1.${body}.sig`
}

function renderCabinet(overrides?: Partial<Parameters<typeof ClientCabinet>[0]>) {
  return render(
    <PomichThemeProvider>
      <ClientCabinet
        profile={profile}
        customerId="guest-stale"
        customerToken={makeToken('tg-829741830')}
        currentRole="customer"
        onBack={() => undefined}
        onStartOrder={() => undefined}
        onSwitchRole={() => undefined}
        {...overrides}
      />
    </PomichThemeProvider>,
  )
}

describe('resolveCabinetHistoryCustomerId', () => {
  it('prefers auth token subject over prop customerId', () => {
    expect(resolveCabinetHistoryCustomerId('guest-stale', makeToken('tg-829741830'))).toBe('tg-829741830')
  })

  it('falls back to prop customerId without token', () => {
    expect(resolveCabinetHistoryCustomerId('guest-stale')).toBe('guest-stale')
  })
})

describe('ClientCabinet', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/customers/tg-829741830/orders')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'PM-1',
                service: 'tow',
                status: 'completed',
                createdAt: '2026-08-12T20:00:00Z',
                updatedAt: '2026-08-12T21:00:00Z',
              },
            ],
          })
        }
        if (url.includes('/customers/guest-stale/orders')) {
          return Promise.resolve({ ok: true, json: async () => [] })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }),
    )
  })

  it('loads order history using token subject, not stale guest id', async () => {
    renderCabinet()

    expect(await screen.findByText(/Евакуатор · #PM-1/i)).toBeInTheDocument()
    expect(screen.queryByText(/Ще немає заявок/i)).not.toBeInTheDocument()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/customers/tg-829741830/orders'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Bearer pomich_auth_v1.'),
          }),
        }),
      )
    })
  })

  it('opens history detail sheet with map and close action', async () => {
    const user = userEvent.setup()
    renderCabinet()

    await user.click(await screen.findByRole('button', { name: /Відкрити деталі заявки PM-1/i }))

    const dialog = await screen.findByRole('dialog', { name: /Деталі заявки з історії/i })
    expect(dialog).toHaveTextContent(/Створено|Час виконання/i)
    await user.click(screen.getByRole('button', { name: /^Закрити$/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Деталі заявки з історії/i })).not.toBeInTheDocument()
    })
  })

  it('renders compact call-to-action and profile actions', async () => {
    const onStartOrder = vi.fn()
    const user = userEvent.setup()
    renderCabinet({ onStartOrder })

    await screen.findByText('Віталій')
    expect(screen.getByRole('button', { name: /Викликати допомогу/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Змінити роль/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Редагувати$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Викликати допомогу/i }))
    expect(onStartOrder).toHaveBeenCalledTimes(1)
  })

  it('saves profile using token subject when guest id is stale', async () => {
    const user = userEvent.setup()
    const onProfileUpdate = vi.fn()
    const patchCalls: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/customers/tg-829741830/profile') && init?.method === 'PATCH') {
          patchCalls.push(url)
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'tg-829741830',
              name: 'Віталій',
              phone: '+380661007434',
              city: 'Ужгород',
              email: '',
              telegram: '',
            }),
          })
        }
        if (url.includes('/users/tg-829741830/account')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              profile: {
                id: 'tg-829741830',
                name: 'Віталій',
                phone: '+380661007434',
                city: 'Ужгород',
              },
            }),
          })
        }
        if (url.includes('/customers/tg-829741830/orders')) {
          return Promise.resolve({ ok: true, json: async () => [] })
        }
        if (url.includes('/customers/guest-stale/orders')) {
          return Promise.resolve({ ok: true, json: async () => [] })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }),
    )

    renderCabinet({ onProfileUpdate })

    await screen.findByText('Віталій')
    await user.click(screen.getByRole('button', { name: /^Редагувати$/i }))
    await user.click(screen.getByRole('button', { name: /Зберегти/i }))

    await waitFor(() => {
      expect(patchCalls.some((url) => url.includes('/customers/tg-829741830/profile'))).toBe(true)
      expect(onProfileUpdate).toHaveBeenCalled()
    })
    expect(screen.queryByText(/Цей номер уже зареєстровано/i)).not.toBeInTheDocument()
  })

  it('shows vehicle field in edit mode and saves vehicle with profile', async () => {
    const user = userEvent.setup()
    const onProfileUpdate = vi.fn()
    let patchBody: Record<string, unknown> | undefined

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/customers/tg-829741830/profile') && init?.method === 'PATCH') {
          patchBody = JSON.parse(String(init.body))
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'tg-829741830',
              name: 'Віталій',
              phone: '+380661007434',
              city: 'Ужгород',
              vehicle: 'Toyota Corolla',
              email: '',
              telegram: '',
            }),
          })
        }
        if (url.includes('/users/tg-829741830/account')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              profile: {
                id: 'tg-829741830',
                name: 'Віталій',
                phone: '+380661007434',
                city: 'Ужгород',
                vehicle: 'Toyota Corolla',
              },
            }),
          })
        }
        if (url.includes('/customers/tg-829741830/orders')) {
          return Promise.resolve({ ok: true, json: async () => [] })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }),
    )

    renderCabinet({ onProfileUpdate })

    await screen.findByText('Віталій')
    await user.click(screen.getByRole('button', { name: /^Редагувати$/i }))
    expect(screen.getByText('Редагування профілю')).toBeInTheDocument()
    const vehicleInput = screen.getByPlaceholderText('Toyota Corolla')
    await user.clear(vehicleInput)
    await user.type(vehicleInput, 'Toyota Corolla')
    await user.click(screen.getByRole('button', { name: /Зберегти/i }))

    await waitFor(() => {
      expect(patchBody?.vehicle).toBe('Toyota Corolla')
      expect(onProfileUpdate).toHaveBeenCalled()
    })
  })

  it('displays saved vehicle in profile view', async () => {
    renderCabinet({ profile: { ...profile, vehicle: 'Skoda Octavia' } })

    expect(await screen.findByText('Skoda Octavia')).toBeInTheDocument()
  })
})
