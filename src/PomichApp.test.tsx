import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CustomerApp from './CustomerApp'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div />,
  Polyline: () => <div />,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ invalidateSize: () => undefined, getContainer: () => document.createElement('div') }),
  useMapEvents: () => null,
}))

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}))

describe('POMICH role-based flows', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.pushState({}, '', '/')
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  async function openCustomerHome(user: ReturnType<typeof userEvent.setup>) {
    render(<CustomerApp />)
    await user.click(screen.getByRole('button', { name: /Викликати допомогу/i }))
  }

  it('starts with role selection and opens the customer flow', async () => {
    const user = userEvent.setup()
    render(<CustomerApp />)

    expect(screen.getByText('POMICH')).toBeInTheDocument()
    expect(screen.getByText('Оберіть вашу роль')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Викликати допомогу/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Керувати заявками/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Викликати допомогу/i }))

    expect(screen.getByText('Що сталося?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Евакуатор/i })).toBeInTheDocument()
  })

  it('shows nearby providers before a customer creates an order', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'provider-oleksandr',
          name: 'Олександр',
          status: 'online',
          vehicle: 'Volkswagen Transporter',
          etaMinutes: 12,
          location: { lat: 48.622, lng: 22.289 },
        },
        {
          id: 'provider-mykhailo',
          name: 'Михайло',
          status: 'online',
          vehicle: 'Renault Master',
          etaMinutes: 18,
          location: { lat: 48.612, lng: 22.303 },
        },
      ],
    }))

    await openCustomerHome(user)

    expect(await screen.findByText('2 на лінії поруч')).toBeInTheDocument()
    expect(screen.getByText(/Найближчий: Олександр/i)).toBeInTheDocument()
  })

  it('lets a provider go on duty before seeing offers', async () => {
    const user = userEvent.setup()
    const providerSessionToken = 'pomich_auth_v1.provider-session'
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/provider/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-oleksandr',
            providerId: 'provider-oleksandr',
            tokenType: 'Bearer',
            accessToken: providerSessionToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.endsWith('/providers')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'provider-oleksandr',
              name: 'Олександр',
              status: 'offline',
              registeredAt: '2026-08-09T00:00:00',
              verificationStatus: 'verified',
              specialties: ['tow', 'fuel'],
              serviceRadiusKm: 9,
            },
          ],
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'provider-oleksandr',
          name: 'Олександр',
          status: 'online',
          registeredAt: '2026-08-09T00:00:00',
          verificationStatus: 'verified',
          specialties: ['tow', 'fuel'],
          serviceRadiusKm: 9,
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?providerToken=partner-secret')

    render(<CustomerApp />)

    await user.click(screen.getByRole('button', { name: /Прийняти заявку/i }))
    expect(screen.getByText('Реєстрація партнера')).toBeInTheDocument()
    expect(screen.getByText('Ваші послуги')).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/provider/session'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-POMICH-Provider-Token': 'partner-secret' }),
        }),
      )
    })
    expect(window.location.search).not.toContain('providerToken')

    await user.click(screen.getByRole('button', { name: /Зберегти профіль/i }))

    expect(screen.getByText('Партнер POMICH')).toBeInTheDocument()
    expect(screen.getByText('Поза лінією')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Вийти на лінію/i }))

    expect(await screen.findByText('На лінії')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/providers/provider-oleksandr/presence'),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ Authorization: `Bearer ${providerSessionToken}` }),
        }),
      )
    })
  })

  it('lets a provider sign in with an account before registration', async () => {
    const user = userEvent.setup()
    const providerSessionToken = 'pomich_auth_v1.provider-account-session'
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/provider/login')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-oleksandr',
            providerId: 'provider-oleksandr',
            tokenType: 'Bearer',
            accessToken: providerSessionToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.endsWith('/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CustomerApp />)

    await user.click(screen.getByRole('button', { name: /Прийняти заявку/i }))
    expect(screen.getByText('Вхід партнера')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Логін'))
    await user.type(screen.getByLabelText('Логін'), 'oleksandr')
    await user.type(screen.getByLabelText('Пароль'), 'provider-pass')
    await user.click(screen.getByRole('button', { name: /Увійти/i }))

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/provider/login'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.not.objectContaining({ 'X-POMICH-Provider-Token': expect.any(String) }),
        }),
      )
    })
  })

  it('moves from service selection to the tow flow', async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    await user.click(screen.getByRole('button', { name: /Евакуатор/i }))

    expect(screen.getByText('Ваше місцезнаходження')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Підтвердити місце/i }))
    expect(screen.getByText('Куди доставити авто?')).toBeInTheDocument()
  })

  it('submits an order and shows the success state', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/orders/PM-123456')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'PM-123456', status: 'searching', createdAt: '2026-08-09T00:00:00' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 'PM-123456', status: 'searching', createdAt: '2026-08-09T00:00:00' }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await openCustomerHome(user)

    await user.click(screen.getByRole('button', { name: /Евакуатор/i }))
    await user.click(screen.getByRole('button', { name: /Підтвердити місце/i }))
    await user.click(screen.getByRole('button', { name: /Далі/i }))
    await user.click(screen.getByRole('button', { name: /Далі/i }))
    await user.click(screen.getByRole('button', { name: /Викликати за/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    expect(await screen.findByText(/Заявку створено/i)).toBeInTheDocument()
    expect(screen.getByText(/Замовлення #/i)).toBeInTheDocument()
  })

  it('opens the admin panel and updates an order status', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-session'
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/admin/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'admin',
            subjectId: 'admin',
            tokenType: 'Bearer',
            accessToken: adminSessionToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/orders/PM-1/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'PM-1', status: 'assigned', updatedAt: '2026-08-09T00:05:00' }),
        })
      }
      if (url.endsWith('/orders')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'PM-1',
              status: 'matching',
              service: 'tow',
              source: 'telegram',
              customerLocation: 'вул. Собранецька',
              destination: 'СТО',
              vehicleState: 'Авто не заводиться',
              chatId: '42',
              telegramUsername: 'driver_help',
              createdAt: '2026-08-09T00:00:00',
              statusHistory: [{ status: 'matching', at: '2026-08-09T00:00:00' }],
            },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin&adminToken=test-admin')

    render(<CustomerApp />)

    expect(await screen.findByText('Адмін панель')).toBeInTheDocument()
    expect(window.location.search).not.toContain('adminToken')
    expect(await screen.findAllByText('PM-1')).toHaveLength(2)
    expect(screen.getByText('Картка заявки')).toBeInTheDocument()

    const statusButtons = screen.getAllByRole('button', { name: /Виконавця призначено/i })
    await user.click(statusButtons[statusButtons.length - 1])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/orders/PM-1/status'),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ Authorization: `Bearer ${adminSessionToken}` }),
        }),
      )
    })
  })

  it('lets an admin sign in with an account without a bootstrap token', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-account-session'
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/admin/login')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'admin',
            subjectId: 'dispatcher',
            username: 'dispatcher',
            tokenType: 'Bearer',
            accessToken: adminSessionToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.endsWith('/orders')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.endsWith('/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin')

    render(<CustomerApp />)

    expect(await screen.findByText('Вхід диспетчера')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Пароль'), 'admin-pass')
    await user.click(screen.getByRole('button', { name: /Увійти/i }))

    expect(await screen.findByText('Адмін панель')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/admin/login'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.not.objectContaining({ 'X-POMICH-Admin-Token': expect.any(String) }),
        }),
      )
    })
  })
})
