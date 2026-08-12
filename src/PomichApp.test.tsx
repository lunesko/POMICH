import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CustomerApp from './CustomerApp'
import { PomichThemeProvider } from './context/PomichThemeProvider'
import { authSessionStorageKey, storeAuthSession } from './lib/auth'

function renderApp() {
  return render(
    <PomichThemeProvider>
      <CustomerApp />
    </PomichThemeProvider>,
  )
}

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

const TEST_CUSTOMER_TOKEN = 'pomich_auth_v1.test-customer-session'

const verifiedTestProfile = {
  id: 'guest-test',
  name: 'Тест',
  phone: '+380671112233',
  verificationStatus: 'verified' as const,
  verification: { phone: true, email: false, telegram: false },
}

function mockRegisteredCustomerFetch(extra?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }> | undefined) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const fromExtra = extra?.(url, init)
    if (fromExtra) return fromExtra
    if (url.includes('/auth/customer/guest/session')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          role: 'customer',
          subjectId: 'guest-test',
          customerId: 'guest-test',
          accessToken: TEST_CUSTOMER_TOKEN,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          profile: verifiedTestProfile,
          account: {
            customerId: 'guest-test',
            preferredRole: '',
            linkedProviderId: '',
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
          },
        }),
      })
    }
    if (url.includes('/customers/') && url.includes('/profile')) {
      return Promise.resolve({ ok: true, json: async () => verifiedTestProfile })
    }
    if (url.includes('/auth/customer/verify/')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, profile: verifiedTestProfile, channel: 'email', expiresAt: new Date(Date.now() + 600000).toISOString() }),
      })
    }
    if (url.includes('/users/') && url.includes('/account/role')) {
      const body = init?.body ? JSON.parse(String(init.body)) as { role?: string } : {}
      const role = body.role === 'provider' ? 'provider' : 'customer'
      return Promise.resolve({
        ok: true,
        json: async () => ({
          customerId: 'guest-test',
          preferredRole: role,
          linkedProviderId: role === 'provider' ? 'provider-guest-test' : '',
          rolesRegistered: [role],
          clientRegistered: role === 'customer',
          providerRegistered: false,
          needsOnboarding: false,
          profile: verifiedTestProfile,
        }),
      })
    }
    if (url.includes('/users/') && url.includes('/account')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          customerId: 'guest-test',
          preferredRole: 'customer',
          linkedProviderId: '',
          rolesRegistered: ['customer'],
          clientRegistered: true,
          providerRegistered: false,
          needsOnboarding: false,
          profile: verifiedTestProfile,
        }),
      })
    }
    if (url.endsWith('/providers')) {
      return Promise.resolve({ ok: true, json: async () => [] })
    }
    if (url.includes('/map/providers')) {
      return Promise.resolve({ ok: true, json: async () => [] })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('POMICH role-based flows', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.pushState({}, '', '/')
    window.localStorage.clear()
    window.sessionStorage.clear()
    delete (window as Window & { Telegram?: unknown }).Telegram
    vi.stubGlobal('fetch', mockRegisteredCustomerFetch())
  })

  async function openCustomerHome(user: ReturnType<typeof userEvent.setup>) {
    renderApp()
    await user.click(await screen.findByRole('button', { name: /Зареєструватися/i }))
    await user.click(await screen.findByRole('button', { name: /Я клієнт/i }))
    if (await screen.queryByText('Реєстрація клієнта')) {
      await user.click(screen.getByRole('button', { name: /Продовжити/i }))
    }
  }

  it('opens client registration directly from role deep link', async () => {
    window.history.pushState({}, '', '/?role=customer')
    renderApp()

    expect(await screen.findByText('Реєстрація клієнта')).toBeInTheDocument()
    expect(screen.queryByText(/Ласкаво просимо до/i)).not.toBeInTheDocument()
  })

  it('opens provider flow directly from role deep link', async () => {
    window.history.pushState({}, '', '/?role=provider')
    renderApp()

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()
    expect(screen.queryByText(/Ласкаво просимо до/i)).not.toBeInTheDocument()
  })

  it('starts with public landing browse mode', async () => {
    renderApp()

    expect(await screen.findByText(/Ласкаво просимо до/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Зареєструватися/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Послуги' })).toBeInTheDocument()
  })

  it('restores a registered client when clicking login instead of registration', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })

    renderApp()
    await user.click(await screen.findByRole('button', { name: /^Увійти$/i }))

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.queryByText('Реєстрація клієнта')).not.toBeInTheDocument()
    expect(screen.queryByText('Оберіть вашу роль')).not.toBeInTheDocument()
  })

  it('skips registration for returning client opened via role deep link', async () => {
    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })
    window.history.pushState({}, '', '/?role=customer')

    renderApp()

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.queryByText('Реєстрація клієнта')).not.toBeInTheDocument()
  })

  it('prefers telegram session over stale web guest token in Telegram WebApp', async () => {
    const tgProfile = { ...verifiedTestProfile, id: 'tg-42' }
    window.Telegram = {
      WebApp: {
        initData: 'telegram-init-data-stub',
        initDataUnsafe: { user: { id: 42, first_name: 'Vitaliy' } },
      },
    }
    storeAuthSession(authSessionStorageKey('customer', 'guest-stale'), {
      role: 'customer',
      subjectId: 'guest-stale',
      customerId: 'guest-stale',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/customer/telegram/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'tg-42',
            customerId: 'tg-42',
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: tgProfile,
            account: {
              customerId: 'tg-42',
              preferredRole: 'customer',
              linkedProviderId: '',
              rolesRegistered: ['customer'],
              clientRegistered: true,
              providerRegistered: false,
              needsOnboarding: false,
              profile: tgProfile,
            },
          }),
        })
      }
      if (url.includes('/map/providers') || url.endsWith('/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderApp()

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.queryByText('Реєстрація клієнта')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/customer/telegram/session'), expect.any(Object))
  })

  it('opens role selection from register and enters the customer flow', async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Евакуатор/i })).toBeInTheDocument()
  })

  it('returns to role selection when switching role from the header', async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Змінити роль/i }))

    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Я клієнт/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Надаю послуги/i })).toBeInTheDocument()
  })

  it('shows nearby providers before a customer creates an order', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.endsWith('/providers')) {
        return Promise.resolve({
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
        })
      }
      return undefined
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
      if (url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
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

    renderApp()

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

    expect(await screen.findByText('Партнер POMICH')).toBeInTheDocument()
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
    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
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
      return undefined
    }))

    renderApp()

    const partnerButtons = await screen.findAllByRole('button', { name: /Надаю послуги/i })
    await user.click(partnerButtons[0]!)
    expect(screen.getByText('Реєстрація партнера')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Вже маєте акаунт\? Увійти/i }))
    expect(screen.getByText('Вхід партнера')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Логін'))
    await user.type(screen.getByLabelText('Логін'), 'oleksandr')
    await user.type(screen.getByLabelText('Пароль'), 'provider-pass')
    await user.click(screen.getByRole('button', { name: /Увійти/i }))

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()
  })

  it('moves from service selection to the tow flow', async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    await user.click(screen.getByRole('button', { name: /Евакуатор/i }))

    expect(screen.getByText('Підтвердьте місце')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Підтвердити місце/i }))
    expect(screen.getByText('Отримайте ETA і ціну')).toBeInTheDocument()
  })

  it('submits an order and shows the success state', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRegisteredCustomerFetch((url) => {
      if (url.includes('/orders/PM-123456')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'PM-123456', status: 'searching', createdAt: '2026-08-09T00:00:00' }),
        })
      }
      if (url.includes('/orders')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'PM-123456', status: 'searching', createdAt: '2026-08-09T00:00:00' }),
        })
      }
      return undefined
    })
    vi.stubGlobal('fetch', fetchMock)

    await openCustomerHome(user)

    await user.click(screen.getByRole('button', { name: /Евакуатор/i }))
    await user.click(screen.getByRole('button', { name: /Підтвердити місце/i }))
    await user.click(screen.getByRole('button', { name: /Підтвердити заявку/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    expect(await screen.findByText(/Заявку створено/i)).toBeInTheDocument()
    expect(screen.getByText(/Замовлення #/i)).toBeInTheDocument()
  })

  it('opens the admin panel and updates an order status', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-session'
    const adminPayload = {
      totals: { clients: 1, providers: 1, dispatchProviders: 1, directoryProviders: 0, orders: 1, activeOrders: 1, completedOrders: 0 },
      providers: { online: 1, busy: 0, offline: 0, verified: 1, pendingVerification: 0 },
      clients: { verified: 1, registered: 1, disabled: 0 },
      orders: { searching: 1, assigned: 0, enRoute: 0, inProgress: 0 },
      activity: [{ type: 'order', id: 'PM-1', status: 'searching', service: 'tow', source: 'telegram', at: '2026-08-09T00:00:00' }],
    }
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
      if (url.includes('/admin/stats')) return Promise.resolve({ ok: true, json: async () => adminPayload })
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'dev', corsOrigins: ['*'], encryptionEnabled: false, databaseUrlConfigured: false, telegramConfigured: false, adminAccountsConfigured: true, providerAccountsConfigured: false, allowHttpPilot: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/orders/PM-1/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'PM-1', status: 'assigned', updatedAt: '2026-08-09T00:05:00' }),
        })
      }
      if (url.includes('/admin/orders') || url.endsWith('/orders')) {
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

    renderApp()

    expect(await screen.findByText('POMICH Admin')).toBeInTheDocument()
    expect(window.location.search).not.toContain('adminToken')
    await user.click(screen.getByRole('button', { name: /Заявки/i }))
    const statusButtons = await screen.findAllByRole('button', { name: /Виконавця призначено/i })
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
      if (url.includes('/admin/stats')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totals: { clients: 0, providers: 0, dispatchProviders: 0, directoryProviders: 0, orders: 0, activeOrders: 0, completedOrders: 0 },
            providers: { online: 0, busy: 0, offline: 0, verified: 0, pendingVerification: 0 },
            clients: { verified: 0, registered: 0, disabled: 0 },
            orders: { searching: 0, assigned: 0, enRoute: 0, inProgress: 0 },
            activity: [],
          }),
        })
      }
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/orders')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'dev', corsOrigins: ['*'], encryptionEnabled: false, databaseUrlConfigured: false, telegramConfigured: false, adminAccountsConfigured: true, providerAccountsConfigured: false, allowHttpPilot: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin')

    renderApp()

    expect(await screen.findByText('Захищена адмін-панель')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Пароль'), 'admin-pass')
    await user.click(screen.getByRole('button', { name: /Увійти/i }))

    expect(await screen.findByText('POMICH Admin')).toBeInTheDocument()
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
