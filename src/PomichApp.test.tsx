import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import CustomerApp from './CustomerApp'
import type { AdminAuthAccount } from './api/client'
import { PomichThemeProvider } from './context/PomichThemeProvider'
import { authSessionStorageKey, EXPLICIT_LOGOUT_STORAGE_KEY, storeAuthSession } from './lib/auth'
import { applyPomichThemeToDocument } from './lib/theme'

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
  GeoJSON: () => <div />,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => {
    const noop = () => undefined
    const handler = { enable: noop, disable: noop }
    return {
      invalidateSize: noop,
      removeLayer: noop,
      getPane: () => document.createElement('div'),
      createPane: noop,
      setMinZoom: noop,
      setMaxBounds: noop,
      getContainer: () => document.createElement('div'),
      getSize: () => ({ x: 390, y: 700 }),
      getZoom: () => 13,
      getCenter: () => ({ lat: 48.62, lng: 22.28 }),
      flyTo: noop,
      fitBounds: noop,
      project: (coords: [number, number]) => ({ x: coords[0] * 1000, y: coords[1] * 1000 }),
      unproject: (coords: { x: number; y: number } | [number, number]) => {
        const x = Array.isArray(coords) ? coords[0] : coords.x
        const y = Array.isArray(coords) ? coords[1] : coords.y
        return { lat: y / 1000, lng: x / 1000 }
      },
      scrollWheelZoom: handler,
      dragging: handler,
      touchZoom: handler,
      doubleClickZoom: handler,
      boxZoom: handler,
      keyboard: handler,
    }
  },
  useMapEvents: () => null,
}))

vi.mock('leaflet', () => ({
  default: {
    divIcon: () => ({}),
    latLngBounds: () => ({ pad: () => ({}) }),
    tileLayer: () => ({
      addTo: () => ({}),
      setUrl: () => undefined,
    }),
  },
  divIcon: () => ({}),
  latLngBounds: () => ({ pad: () => ({}) }),
  tileLayer: () => ({
    addTo: () => ({}),
    setUrl: () => undefined,
  }),
}))

beforeAll(async () => {
  await Promise.all([
    import('./components/customer/CustomerFlow'),
    import('./components/provider/ProviderFlow'),
    import('./components/onboarding/OnboardingGate'),
    import('./components/cabinet/ClientCabinet'),
    import('./components/cabinet/ProviderCabinet'),
    import('./components/admin/AdminFlow'),
    import('./components/map/RouteMap'),
  ])
})

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
          profile: {
            id: 'guest-test',
            name: 'Клієнт POMICH',
            phone: '',
            verificationStatus: 'unverified',
          },
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
          linkedProviderId: "",
          rolesRegistered: role === "customer" ? ["customer"] : [],
          clientRegistered: role === "customer",
          providerRegistered: false,
          needsOnboarding: true,
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
    if (screen.queryByText('Реєстрація клієнта')) {
      await user.click(screen.getByRole('button', { name: /Продовжити/i }))
    }
    await screen.findByRole('button', { name: /Евакуатор/i })
  }

  it('shows stale web session on registration and allows logout', async () => {
    const user = userEvent.setup()
    storeAuthSession(authSessionStorageKey('customer', 'guest-roman'), {
      role: 'customer',
      subjectId: 'guest-roman',
      customerId: 'guest-roman',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: { id: 'guest-roman', name: 'Roman', phone: '+380671112233', verificationStatus: 'verified' },
    })
    window.localStorage.setItem('pomichCustomerId', 'guest-roman')
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify({ id: 'guest-roman', name: 'Roman', phone: '+380671112233' }))

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-roman',
            preferredRole: '',
            linkedProviderId: '',
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
            profile: { id: 'guest-roman', name: 'Roman', phone: '+380671112233', verificationStatus: 'verified' },
          }),
        })
      }
      return undefined
    }))

    renderApp()
    await user.click(await screen.findByRole('button', { name: /Зареєструватися/i }))
    await user.click(await screen.findByRole('button', { name: /Я клієнт/i }))

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.getByText(/Ви увійшли як:.*Roman/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Вийти$/i }))

    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()
    expect(window.localStorage.getItem('pomichCustomerId')).toBeNull()
  })

  it('opens client registration directly from role deep link', async () => {
    window.history.pushState({}, '', '/?role=customer')
    renderApp()

    expect(await screen.findByText('Реєстрація клієнта')).toBeInTheDocument()
    expect(screen.queryByText(/Допомога на дорозі — поруч/i)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(window.location.search).not.toContain('role=')
    })
  })

  it('opens provider flow directly from role deep link', async () => {
    window.history.pushState({}, '', '/?role=provider')
    renderApp()

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()
    expect(screen.queryByText(/Допомога на дорозі — поруч/i)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(window.location.search).not.toContain('role=')
    })
  })

  it('starts with public landing browse mode', async () => {
    renderApp()

    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Зареєструватися/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Послуги' })).toBeInTheDocument()
  })

  it('restores verified web session from landing login without OTP', async () => {
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
    expect(screen.queryByText(/Код надійде у Telegram/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Реєстрація клієнта')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-test'))).not.toBeNull()
  })

  it('preserves session when logged-in customer opens Меню then Увійти', async () => {
    const user = userEvent.setup()
    const romanProfile = {
      ...verifiedTestProfile,
      id: 'guest-roman',
      name: 'Roman',
      phone: '+380935718207',
    }
    window.localStorage.setItem('pomichCustomerId', 'guest-roman')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-roman')
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify(romanProfile))
    storeAuthSession(authSessionStorageKey('customer', 'guest-roman'), {
      role: 'customer',
      subjectId: 'guest-roman',
      customerId: 'guest-roman',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: romanProfile,
    })

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-roman',
            preferredRole: 'customer',
            linkedProviderId: '',
            rolesRegistered: ['customer'],
            clientRegistered: true,
            providerRegistered: false,
            needsOnboarding: false,
            profile: romanProfile,
          }),
        })
      }
      if (url.includes('/customers/') && url.includes('/profile')) {
        return Promise.resolve({ ok: true, json: async () => romanProfile })
      }
      return undefined
    }))

    window.history.pushState({}, '', '/?role=customer')
    renderApp()
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.getByText(/Ви увійшли як:.*Roman/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^POMICH$/i }))
    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()
    expect(window.localStorage.getItem('pomichCustomerId')).toBe('guest-roman')
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-roman'))).not.toBeNull()

    await user.click(await screen.findByRole('button', { name: /^Увійти$/i }))
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.getByText(/Ви увійшли як:.*Roman/i)).toBeInTheDocument()
    expect(screen.queryByText(/Код надійде у Telegram/i)).not.toBeInTheDocument()
  })

  it('shows phone login instead of registration when browser login has no stored session', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url, init) => {
      if (url.includes('/auth/customer/guest/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'guest-fresh',
            customerId: 'guest-fresh',
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: { id: 'guest-fresh', name: 'Клієнт POMICH', phone: '', verificationStatus: 'unverified' },
            account: {
              customerId: 'guest-fresh',
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
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-fresh',
            preferredRole: '',
            linkedProviderId: '',
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
          }),
        })
      }
      return undefined
    }))

    renderApp()
    await user.click(await screen.findByRole('button', { name: /^Увійти$/i }))

    expect(await screen.findByText(/Код надійде у Telegram/i)).toBeInTheDocument()
    expect(screen.queryByText('Реєстрація клієнта')).not.toBeInTheDocument()
  })

  it('shows phone login when login boot cannot restore stale web session', async () => {
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

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.reject(new Error('stale_session'))
      }
      if (url.includes('/auth/customer/guest/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'guest-fresh',
            customerId: 'guest-fresh',
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: { id: 'guest-fresh', name: 'Клієнт POMICH', phone: '', verificationStatus: 'unverified' },
            account: {
              customerId: 'guest-fresh',
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
      return undefined
    }))

    renderApp()
    await user.click(await screen.findByRole('button', { name: /^Увійти$/i }))

    expect(await screen.findByText(/Код надійде у Telegram/i)).toBeInTheDocument()
    expect(screen.queryByText('Реєстрація клієнта')).not.toBeInTheDocument()
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

  it('shows client registration for new Telegram user instead of phone login', async () => {
    window.history.pushState({}, '', '/?role=customer')
    window.Telegram = {
      WebApp: {
        initData: 'telegram-init-data-stub',
        initDataUnsafe: { user: { id: 829741830, first_name: 'Vitaliy', last_name: 'Test' } },
        isVersionAtLeast: (version: string) => Number(version.split('.')[0]) <= 8,
        requestContact: vi.fn(),
      },
    }

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/customer/telegram/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'tg-829741830',
            customerId: 'tg-829741830',
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: {
              id: 'tg-829741830',
              name: 'Vitaliy Test',
              phone: '',
              verificationStatus: 'unverified',
            },
            account: {
              customerId: 'tg-829741830',
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
      if (url.includes('/map/providers') || url.endsWith('/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderApp()

    expect(await screen.findByText('Реєстрація клієнта')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Vitaliy Test')).toBeInTheDocument()
    expect(screen.queryByText(/Код надійде у Telegram/i)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/customer/telegram/session'), expect.any(Object))
  })

  it('shows invite pending screen for unlinked Telegram provider bot user', async () => {
    window.history.pushState({}, '', '/?role=provider&tgBot=provider')
    window.Telegram = {
      WebApp: {
        initData: 'telegram-init-data-stub',
        initDataUnsafe: {
          start_param: 'partner',
          user: { id: 77, first_name: 'Partner', username: 'partner77' },
        },
      },
    }

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/customer/telegram/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'tg-77',
            customerId: 'tg-77',
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: {
              id: 'tg-77',
              name: 'Partner',
              phone: '',
              telegram: 'partner77',
              verificationStatus: 'unverified',
              preferredRole: 'provider',
              linkedProviderId: '',
              rolesRegistered: [],
              telegramBotKind: 'provider',
              telegramNotificationChannel: 'provider',
              customerIdentity: { type: 'telegram', telegramUserId: '77', username: 'partner77' },
            },
            account: {
              customerId: 'tg-77',
              preferredRole: 'provider',
              linkedProviderId: '',
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
              profile: {
                id: 'tg-77',
                name: 'Partner',
                phone: '',
                telegram: 'partner77',
                verificationStatus: 'unverified',
              },
            },
            telegramBotKind: 'provider',
            providerAccount: {
              linked: false,
              providerId: null,
              verificationStatus: 'unverified',
              canOpenProviderSession: false,
              authAccount: {
                id: null,
                username: null,
                status: 'missing',
                active: false,
                passwordResetRequired: false,
                required: true,
              },
            },
          }),
        })
      }
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ detail: 'provider_not_linked' }),
        })
      }
      if (url.includes('/map/providers') || url.endsWith('/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderApp()

    expect(await screen.findByText('Доступ очікує інвайт')).toBeInTheDocument()
    expect(screen.getByText("Ваш Telegram-профіль ще не прив'язаний")).toBeInTheDocument()
    expect(screen.getByText('77')).toBeInTheDocument()
    expect(screen.getByText('@partner77')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Відкрити клієнтський бот/i })).toHaveAttribute('href', 'https://t.me/pomich_ua_bot')
    expect(screen.queryByText('Реєстрація партнера')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/provider/self/session'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
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

  it('logs out in Telegram WebApp and stays on landing after reload', async () => {
    const user = userEvent.setup()
    const tgProfile = { ...verifiedTestProfile, id: 'tg-42', name: 'Vitaliy' }
    window.Telegram = {
      WebApp: {
        initData: 'telegram-init-data-stub',
        initDataUnsafe: { user: { id: 42, first_name: 'Vitaliy' } },
      },
    }

    const telegramSessionCalls: string[] = []
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/customer/telegram/session')) {
        telegramSessionCalls.push(url)
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

    const view = renderApp()

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(telegramSessionCalls.length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /^Вийти$/i }))

    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()
    expect(window.localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY)).toBe('tg-42')
    expect(screen.queryByText('Що сталося?')).not.toBeInTheDocument()

    view.unmount()
    telegramSessionCalls.length = 0
    renderApp()

    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()
    expect(screen.queryByText('Що сталося?')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(telegramSessionCalls).toHaveLength(0)
    })
  })

  it('restores registered Telegram client after logout when clicking login', async () => {
    const user = userEvent.setup()
    const tgProfile = { ...verifiedTestProfile, id: 'tg-829741830', name: 'Vitaliy', phone: '+380661007434' }
    window.Telegram = {
      WebApp: {
        initData: 'telegram-init-data-stub',
        initDataUnsafe: { user: { id: 829741830, first_name: 'Vitaliy' } },
      },
    }

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/customer/telegram/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'tg-829741830',
            customerId: 'tg-829741830',
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: tgProfile,
            account: {
              customerId: 'tg-829741830',
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

    await user.click(screen.getByRole('button', { name: /^Вийти$/i }))
    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()
    expect(window.localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY)).toBe('tg-829741830')

    await user.click(screen.getByRole('button', { name: /^Меню$/i }))
    await user.click(screen.getByRole('button', { name: /^Увійти$/i }))

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.queryByText('Реєстрація клієнта')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/customer/telegram/session'), expect.any(Object))
  })

  it('styles partner vehicle make select for dark theme', async () => {
    window.history.pushState({}, '', '/?role=provider')
    renderApp()

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()
    applyPomichThemeToDocument('dark')
    expect(document.documentElement.dataset.pomichTheme).toBe('dark')

    const vehicleMakeSelect = screen.getByRole('combobox', { name: /Марка авто/i })
    expect(vehicleMakeSelect).toHaveClass('pomich-form-input')
    expect(getComputedStyle(document.documentElement).getPropertyValue('--pomich-text').trim()).toBe('#FFFFFF')
    expect(getComputedStyle(document.documentElement).getPropertyValue('--pomich-surface').trim()).toBe('#12151A')
    expect(vehicleMakeSelect.querySelectorAll('option').length).toBeGreaterThan(1)
  })

  it('shows custom make input when partner selects Інше', async () => {
    const user = userEvent.setup()
    window.history.pushState({}, '', '/?role=provider')
    renderApp()

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()

    const vehicleMakeSelect = screen.getByRole('combobox', { name: /Марка авто/i })
    expect(screen.getByRole('option', { name: 'Scania' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Mercedes-Benz' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Mercedes Sprinter' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /^Модель$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Вкажіть марку/i })).not.toBeInTheDocument()

    await user.selectOptions(vehicleMakeSelect, 'Інше')

    const customMakeInput = screen.getByRole('textbox', { name: /Вкажіть марку/i })
    expect(customMakeInput).toBeInTheDocument()
    await user.type(customMakeInput, 'ZAZ')
    expect(customMakeInput).toHaveValue('ZAZ')
    expect(screen.getByRole('textbox', { name: /^Модель$/i })).toBeInTheDocument()
  })

  it('shows dependent model dropdown after make selection', async () => {
    const user = userEvent.setup()
    window.history.pushState({}, '', '/?role=provider')
    renderApp()

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /^Модель$/i })).not.toBeInTheDocument()

    const vehicleMakeSelect = screen.getByRole('combobox', { name: /Марка авто/i })
    await user.selectOptions(vehicleMakeSelect, 'Volkswagen')

    const vehicleModelSelect = screen.getByRole('combobox', { name: /^Модель$/i })
    expect(vehicleModelSelect).toBeEnabled()
    expect(vehicleModelSelect).toHaveClass('pomich-form-input')
    expect(screen.getByRole('option', { name: 'Transporter' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Crafter' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Інша модель' })).toBeInTheDocument()

    await user.selectOptions(vehicleModelSelect, 'Transporter')
    expect(vehicleModelSelect).toHaveValue('Transporter')

    await user.selectOptions(vehicleMakeSelect, 'Ford')
    expect(screen.getByRole('combobox', { name: /^Модель$/i })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Transit' })).toBeInTheDocument()
  })

  it('shows custom model input when partner selects Інша модель', async () => {
    const user = userEvent.setup()
    window.history.pushState({}, '', '/?role=provider')
    renderApp()

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()

    const vehicleMakeSelect = screen.getByRole('combobox', { name: /Марка авто/i })
    await user.selectOptions(vehicleMakeSelect, 'Mercedes-Benz')

    const vehicleModelSelect = screen.getByRole('combobox', { name: /^Модель$/i })
    await user.selectOptions(vehicleModelSelect, 'Інша модель')

    const customModelInput = screen.getByRole('textbox', { name: /Вкажіть модель/i })
    expect(customModelInput).toBeInTheDocument()
    await user.type(customModelInput, 'Sprinter 316')
    expect(customModelInput).toHaveValue('Sprinter 316')
  })

  it('switches customer home to dark theme when toggled', async () => {
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
    window.history.pushState({}, '', '/?role=customer')

    renderApp()
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(document.documentElement.dataset.pomichTheme).not.toBe('dark')

    await user.click(screen.getByRole('switch', { name: /Увімкнено світлу тему/i }))

    expect(document.documentElement.dataset.pomichTheme).toBe('dark')
    expect(window.localStorage.getItem('pomichLandingTheme')).toBe('dark')
    expect(getComputedStyle(document.documentElement).getPropertyValue('--pomich-bg').trim()).toBe('#090B0E')
  })

  it('opens role selection from register and enters the customer flow', async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Евакуатор/i })).toBeInTheDocument()
  })

  it('shows refresh geolocation control on customer home and requests location again', async () => {
    const user = userEvent.setup()
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 48.6208,
          longitude: 22.2879,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition)
    })
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition,
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
    })

    await openCustomerHome(user)

    expect(await screen.findByText('Поточне місце')).toBeInTheDocument()
    const refreshButton = screen.getByRole('button', { name: /Оновити геолокацію/i })
    expect(refreshButton).toBeInTheDocument()

    const initialCalls = getCurrentPosition.mock.calls.length
    await user.click(refreshButton)

    await waitFor(() => {
      expect(getCurrentPosition.mock.calls.length).toBeGreaterThan(initialCalls)
    })
    expect(refreshButton).toHaveTextContent('Оновити')
  })

  it('returns to role selection when switching role from the header', async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Змінити роль/i }))

    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Я клієнт/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Надаю послуги/i })).toBeInTheDocument()
    // Role switch must keep the signed-in customer identity (not wipe like logout).
    expect(window.localStorage.getItem('pomichCustomerId')).toBe('guest-test')
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-test'))).not.toBeNull()
  })

  it('reopens registered partner flow after role switch without asking to register again', async () => {
    const user = userEvent.setup()
    const providerRecord = {
      id: 'provider-guest-test',
      name: 'Партнер Тест',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      verification: { phone: true },
      specialties: ['tow', 'fuel'],
      serviceRadiusKm: 15,
      status: 'offline',
    }

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url, init) => {
      if (url.includes('/users/') && url.includes('/account/role')) {
        const body = init?.body ? JSON.parse(String(init.body)) as { role?: string } : {}
        const role = body.role === 'provider' ? 'provider' : 'customer'
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: role,
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['customer', 'provider'],
            clientRegistered: true,
            providerRegistered: true,
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
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['customer', 'provider'],
            clientRegistered: true,
            providerRegistered: true,
            needsOnboarding: false,
            profile: verifiedTestProfile,
          }),
        })
      }
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-test',
            providerId: 'provider-guest-test',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-self',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/provider-guest-test/offers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      if (url.includes('/providers/provider-guest-test/presence')) {
        return Promise.resolve({ ok: true, json: async () => providerRecord })
      }
      if (url.endsWith('/providers') || url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [providerRecord] })
      }
      return undefined
    }))

    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichLinkedProviderId', 'provider-guest-test')
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })

    await openCustomerHome(user)
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Змінити роль/i }))
    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-test'))).not.toBeNull()

    await user.click(screen.getByRole('button', { name: /Надаю послуги/i }))

    expect(await screen.findByText('Партнер POMICH', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
  })

  it('keeps registered partner after role switch when account API briefly omits providerRegistered', async () => {
    const user = userEvent.setup()
    const providerRecord = {
      id: 'provider-guest-test',
      name: 'Партнер Тест',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      verification: { phone: true },
      specialties: ['tow', 'fuel'],
      serviceRadiusKm: 15,
      status: 'offline',
    }

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url, init) => {
      if (url.includes('/users/') && url.includes('/account/role')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'provider',
            linkedProviderId: '',
            rolesRegistered: ['customer'],
            clientRegistered: true,
            providerRegistered: false,
            needsOnboarding: true,
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
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['customer', 'provider'],
            clientRegistered: true,
            providerRegistered: true,
            needsOnboarding: false,
            profile: verifiedTestProfile,
          }),
        })
      }
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-test',
            providerId: 'provider-guest-test',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-self',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/provider-guest-test/')) {
        return Promise.resolve({ ok: true, json: async () => providerRecord })
      }
      if (url.endsWith('/providers') || url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [providerRecord] })
      }
      return undefined
    }))

    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichLinkedProviderId', 'provider-guest-test')
    window.localStorage.setItem('pomichPartnerRegistered:provider-guest-test', '1')
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })

    await openCustomerHome(user)
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Змінити роль/i }))
    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Надаю послуги/i }))

    expect(await screen.findByText('Партнер POMICH', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
  })

  it('switches partner role to client without asking for client registration again', async () => {
    const user = userEvent.setup()
    const partnerProfile = {
      id: 'guest-test',
      name: 'Партнер Іван',
      phone: '+380671112233',
      city: 'Ужгород',
      verificationStatus: 'verified' as const,
      verification: { phone: true, email: false },
    }
    const providerRecord = {
      id: 'provider-guest-test',
      name: 'Партнер Іван',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      verification: { phone: true },
      specialties: ['tow', 'fuel'],
      serviceRadiusKm: 15,
      status: 'offline',
    }

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account/role')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'customer',
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['provider', 'customer'],
            clientRegistered: true,
            providerRegistered: true,
            needsOnboarding: false,
            profile: partnerProfile,
          }),
        })
      }
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'provider',
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['provider'],
            clientRegistered: false,
            providerRegistered: true,
            needsOnboarding: false,
            profile: partnerProfile,
          }),
        })
      }
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-test',
            providerId: 'provider-guest-test',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-self',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/provider-guest-test/')) {
        return Promise.resolve({ ok: true, json: async () => providerRecord })
      }
      if (url.endsWith('/providers') || url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [providerRecord] })
      }
      return undefined
    }))

    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichLinkedProviderId', 'provider-guest-test')
    window.localStorage.setItem('pomichPartnerRegistered:provider-guest-test', '1')
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify(partnerProfile))
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: partnerProfile,
    })
    storeAuthSession(authSessionStorageKey('provider', 'provider-guest-test'), {
      role: 'provider',
      subjectId: 'provider-guest-test',
      providerId: 'provider-guest-test',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.provider-self',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })

    window.history.replaceState({}, '', '/?role=provider')
    renderApp()
    expect(await screen.findByText('Партнер POMICH', {}, { timeout: 8000 })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Змінити роль/i }))
    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Я клієнт/i }))

    expect(await screen.findByText('Що сталося?', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація клієнта/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Потрібно завершити реєстрацію клієнта/i)).not.toBeInTheDocument()
  })

  it('role switch with linked provider and missing SQL row stays on duty and prefills completion form', async () => {
    const user = userEvent.setup()
    const linkedProfile = {
      ...verifiedTestProfile,
      name: 'Віталій',
      phone: '+380661007434',
      city: 'Ужгород',
    }
    const emptyProviderShell = {
      id: 'provider-guest-test',
      name: 'Віталій',
      phone: '+380661007434',
      city: 'Ужгород',
      vehicle: '',
      plate: '',
      status: 'offline',
      verificationStatus: 'verified',
      verification: { phone: true },
      specialties: [],
      serviceRadiusKm: 15,
    }

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url, init) => {
      if (url.includes('/users/') && url.includes('/account/role')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'provider',
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['customer'],
            clientRegistered: true,
            // SQL provider row missing → API reports not registered.
            providerRegistered: false,
            needsOnboarding: false,
            profile: linkedProfile,
          }),
        })
      }
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'customer',
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['customer'],
            clientRegistered: true,
            providerRegistered: false,
            needsOnboarding: false,
            profile: linkedProfile,
          }),
        })
      }
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-test',
            providerId: 'provider-guest-test',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-self',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/provider-guest-test/')) {
        return Promise.resolve({ ok: true, json: async () => emptyProviderShell })
      }
      if (url.includes('/customers/') && url.includes('/profile')) {
        return Promise.resolve({ ok: true, json: async () => linkedProfile })
      }
      if (url.endsWith('/providers') || url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return undefined
    }))

    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichLinkedProviderId', 'provider-guest-test')
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify(linkedProfile))
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: linkedProfile,
    })

    await openCustomerHome(user)
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Змінити роль/i }))
    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Надаю послуги/i }))

    // Linked returning partner must not land on blank first-time registration.
    expect(await screen.findByText('Партнер POMICH', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Завершити профіль/i }))
    expect(await screen.findByText(/Профіль партнера/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Віталій')).toBeInTheDocument()
    expect(screen.getByDisplayValue('66 100 74 34')).toBeInTheDocument()
    // Form plate must stay mounted (not a blank map-only shell).
    expect(screen.getByRole('button', { name: /Зберегти профіль/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Назад/i })).toBeInTheDocument()
    expect(document.querySelector('.pomich-screen-layout--form')).not.toBeNull()
  })

  it('opens partner duty go-online UI from ?screen=duty deep link', async () => {
    const user = userEvent.setup()
    const providerRecord = {
      id: 'provider-guest-test',
      name: 'Партнер Тест',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      verification: { phone: true },
      specialties: ['tow', 'fuel'],
      serviceRadiusKm: 15,
      status: 'offline',
    }

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'provider',
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['customer', 'provider'],
            clientRegistered: true,
            providerRegistered: true,
            needsOnboarding: false,
            profile: verifiedTestProfile,
          }),
        })
      }
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-test',
            providerId: 'provider-guest-test',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-self',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/provider-guest-test/presence')) {
        return Promise.resolve({ ok: true, json: async () => ({ ...providerRecord, status: 'online' }) })
      }
      if (url.includes('/providers/provider-guest-test/')) {
        return Promise.resolve({ ok: true, json: async () => providerRecord })
      }
      if (url.endsWith('/providers') || url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [providerRecord] })
      }
      return undefined
    }))

    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichLinkedProviderId', 'provider-guest-test')
    window.localStorage.setItem('pomichPartnerRegistered:provider-guest-test', '1')
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })

    window.history.pushState({}, '', '/?role=provider&tgBot=provider&screen=duty')
    renderApp()

    expect(await screen.findByText('Партнер POMICH', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
    // Deep link auto-attempts go-online once session is ready.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/providers/provider-guest-test/presence'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
    expect(await screen.findAllByText('На лінії')).not.toHaveLength(0)
  })

  it('opens partner cabinet from ?screen=cabinet deep link', async () => {
    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'provider',
            linkedProviderId: 'provider-guest-test',
            rolesRegistered: ['customer', 'provider'],
            clientRegistered: true,
            providerRegistered: true,
            needsOnboarding: false,
            profile: verifiedTestProfile,
          }),
        })
      }
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-test',
            providerId: 'provider-guest-test',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-self',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/provider-guest-test/')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'provider-guest-test',
            name: 'Партнер Тест',
            phone: '+380671112233',
            registeredAt: '2026-08-09T00:00:00',
            verificationStatus: 'verified',
            verification: { phone: true },
            specialties: ['tow'],
            status: 'offline',
          }),
        })
      }
      return undefined
    }))

    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichLinkedProviderId', 'provider-guest-test')
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })

    window.history.pushState({}, '', '/?role=provider&tgBot=provider&screen=cabinet')
    renderApp()

    expect(await screen.findByText('Кабінет партнера', {}, { timeout: 8000 })).toBeInTheDocument()
  })

  it('after logout, choosing partner opens phone login and restores registered partner', async () => {
    const user = userEvent.setup()
    const partnerProfile = {
      ...verifiedTestProfile,
      id: 'guest-vitaliy',
      name: 'Віталій',
      phone: '+380661007434',
    }
    const providerRecord = {
      id: 'provider-guest-vitaliy',
      name: 'Віталій',
      phone: '+380661007434',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      verification: { phone: true },
      specialties: ['tow', 'fuel'],
      serviceRadiusKm: 15,
      status: 'offline',
    }

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url, init) => {
      if (url.includes('/auth/customer/phone/login/send')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, channel: 'telegram', expiresAt: new Date(Date.now() + 600000).toISOString() }),
        })
      }
      if (url.includes('/auth/customer/phone/login/confirm')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'guest-vitaliy',
            customerId: 'guest-vitaliy',
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: partnerProfile,
            account: {
              customerId: 'guest-vitaliy',
              preferredRole: 'provider',
              linkedProviderId: 'provider-guest-vitaliy',
              rolesRegistered: ['customer', 'provider'],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
              profile: partnerProfile,
            },
          }),
        })
      }
      if (url.includes('/users/') && url.includes('/account/role')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-vitaliy',
            preferredRole: 'provider',
            linkedProviderId: 'provider-guest-vitaliy',
            rolesRegistered: ['customer', 'provider'],
            clientRegistered: true,
            providerRegistered: true,
            needsOnboarding: false,
            profile: partnerProfile,
          }),
        })
      }
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-vitaliy',
            preferredRole: 'provider',
            linkedProviderId: 'provider-guest-vitaliy',
            rolesRegistered: ['customer', 'provider'],
            clientRegistered: true,
            providerRegistered: true,
            needsOnboarding: false,
            profile: partnerProfile,
          }),
        })
      }
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-vitaliy',
            providerId: 'provider-guest-vitaliy',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-self',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/provider-guest-vitaliy/')) {
        return Promise.resolve({ ok: true, json: async () => providerRecord })
      }
      if (url.endsWith('/providers') || url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [providerRecord] })
      }
      return undefined
    }))

    renderApp()
    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()

    // Landing «Партнер» must open phone login (not blank registration).
    await user.click(screen.getAllByRole('button', { name: /Надаю послуги/i })[0])
    expect(await screen.findByText('Увійти')).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()

    const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement
    expect(phoneInput).toBeTruthy()
    await user.clear(phoneInput)
    await user.type(phoneInput, '661007434')
    await user.click(screen.getByRole('button', { name: /Надіслати код/i }))

    const codeInput = await screen.findByPlaceholderText(/6 цифр/i)
    await user.type(codeInput, '123456')
    await user.click(screen.getByRole('button', { name: /Підтвердити/i }))

    expect(await screen.findByText('Партнер POMICH', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
  })

  it('partner registration login CTA opens phone restore, not password dead-end', async () => {
    const user = userEvent.setup()
    window.history.pushState({}, '', '/?role=provider')
    renderApp()

    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Вже маєте акаунт\? Увійти/i }))

    expect(await screen.findByText('Увійти')).toBeInTheDocument()
    expect(screen.getByText(/Код надійде у Telegram/i)).toBeInTheDocument()
    expect(document.querySelector('input[type="tel"]')).toBeTruthy()
    expect(screen.queryByText('Вхід партнера')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Логін')).not.toBeInTheDocument()
  })

  it('phone_already_registered shows restore CTA and opens phone login', async () => {
    const user = userEvent.setup()
    window.history.pushState({}, '', '/?role=provider')

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url, init) => {
      if (url.includes('/auth/provider/self/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-guest-test',
            providerId: 'provider-guest-test',
            tokenType: 'Bearer',
            accessToken: 'pomich_auth_v1.provider-self',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes('/providers/') && url.includes('/profile') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ detail: 'phone_already_registered' }),
        })
      }
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'provider',
            linkedProviderId: '',
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
          }),
        })
      }
      if (url.endsWith('/providers') || url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return undefined
    }))

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
    expect(await screen.findByText('Реєстрація партнера')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/Ваше ім'я/i), 'Віталій')
    const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement
    await user.clear(phoneInput)
    await user.type(phoneInput, '661007434')
    await user.selectOptions(screen.getByRole('combobox', { name: /Марка авто/i }), 'Volkswagen')
    await user.selectOptions(screen.getByRole('combobox', { name: /^Модель$/i }), 'Crafter')

    const plateInput = screen.getByPlaceholderText(/AA 0000 AA/i)
    await user.clear(plateInput)
    await user.type(plateInput, 'BX5874HX')

    await user.click(screen.getByRole('button', { name: /Евакуатор/i }))
    await user.click(screen.getByRole('button', { name: /Зареєструватись/i }))

    expect(await screen.findByRole('button', { name: /Увійти за цим номером/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Увійти за цим номером/i }))

    expect(await screen.findByText('Увійти')).toBeInTheDocument()
    expect(document.querySelector('input[type="tel"]')).toBeTruthy()
    expect(screen.queryByText('Вхід партнера')).not.toBeInTheDocument()
  })

  it('logs out from header and clears stored auth', async () => {
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

    await openCustomerHome(user)
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Вийти$/i }))

    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()
    expect(window.localStorage.getItem('pomichCustomerId')).toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-test'))).toBeNull()
  })

  it('starts fresh registration after logout then login instead of reusing customer-web profile', async () => {
    const user = userEvent.setup()
    const romanProfile = {
      id: 'guest-roman',
      name: 'Roman',
      phone: '+380935718207',
      verificationStatus: 'verified' as const,
    }

    storeAuthSession(authSessionStorageKey('customer', 'guest-roman'), {
      role: 'customer',
      subjectId: 'guest-roman',
      customerId: 'guest-roman',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: romanProfile,
    })
    window.localStorage.setItem('pomichCustomerId', 'guest-roman')
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify(romanProfile))

    const guestSessionCalls: Array<string | undefined> = []
    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url, init) => {
      if (url.includes('/auth/customer/guest/session')) {
        const body = init?.body ? JSON.parse(String(init.body)) as { customerId?: string } : {}
        guestSessionCalls.push(body.customerId)
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'guest-fresh',
            customerId: 'guest-fresh',
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: { id: 'guest-fresh', name: 'Клієнт POMICH', phone: '', verificationStatus: 'unverified' },
            account: {
              customerId: 'guest-fresh',
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
      return undefined
    }))

    await openCustomerHome(user)
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Вийти$/i }))
    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /^Увійти$/i }))

    expect(guestSessionCalls.some((customerId) => customerId === 'customer-web')).toBe(false)
    expect(guestSessionCalls.length).toBeGreaterThan(0)
    expect(screen.queryByText('Roman')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ви увійшли як:.*Roman/i)).not.toBeInTheDocument()
  })

  it('shows logout button in client cabinet', async () => {
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

    await openCustomerHome(user)
    expect(await screen.findByText('Що сталося?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Кабінет$/i }))
    expect(await screen.findByText('Особистий кабінет')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Вийти$/i })).toBeInTheDocument()
  })

  it('enters customer flow when stored profile is complete but OTP is pending', async () => {
    const pendingProfile = { ...verifiedTestProfile, verificationStatus: 'pending' as const }
    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify(pendingProfile))
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: pendingProfile,
    })
    window.history.pushState({}, '', '/?role=customer')

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account') && !url.includes('/role')) {
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
            profile: pendingProfile,
          }),
        })
      }
      return undefined
    }))

    renderApp()

    expect((await screen.findAllByText('Підтвердження телефону')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Що сталося?')).not.toBeInTheDocument()
    expect(screen.queryByText('Реєстрація клієнта')).not.toBeInTheDocument()
  })

  it('shows registration for stale bootstrap without matching auth session', async () => {
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify({ ...verifiedTestProfile, id: 'guest-other-device' }))
    window.history.pushState({}, '', '/?role=customer')

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: '',
            linkedProviderId: '',
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
          }),
        })
      }
      return undefined
    }))

    renderApp()

    expect(await screen.findByText('Реєстрація клієнта')).toBeInTheDocument()
    expect(screen.queryByText('Що сталося?')).not.toBeInTheDocument()
  })

  it('shows OTP verification after client registration instead of entering app', async () => {
    const user = userEvent.setup()
    const unverifiedProfile = {
      id: 'guest-test',
      name: 'PowerGear',
      phone: '+380635236801',
      verificationStatus: 'unverified' as const,
    }

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url, init) => {
      if (url.includes('/users/') && url.includes('/account/role')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'guest-test',
            preferredRole: 'customer',
            linkedProviderId: '',
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
            profile: {
              id: 'guest-test',
              name: 'Клієнт POMICH',
              phone: '',
              verificationStatus: 'unverified',
            },
          }),
        })
      }
      if (url.includes('/customers/') && url.includes('/profile') && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => unverifiedProfile })
      }
      if (url.includes('/users/') && url.includes('/account') && !url.includes('/role')) {
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
            profile: unverifiedProfile,
          }),
        })
      }
      if (url.includes('/auth/customer/verify/send')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ channel: 'telegram', expiresAt: new Date(Date.now() + 600000).toISOString() }),
        })
      }
      return undefined
    }))

    renderApp()
    await user.click(await screen.findByRole('button', { name: /Зареєструватися/i }))
    await user.click(await screen.findByRole('button', { name: /Я клієнт/i }))
    expect(await screen.findByText('Реєстрація клієнта')).toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText(/Ваше ім'я/i))
    await user.type(screen.getByPlaceholderText(/Ваше ім'я/i), 'PowerGear')
    await user.type(screen.getByPlaceholderText(/66 123 45 67/i), '635236801')
    await user.click(screen.getByRole('button', { name: /Продовжити/i }))

    expect((await screen.findAllByText('Підтвердження телефону')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /Надіслати код у Telegram/i }))
    expect(await screen.findByPlaceholderText(/6 цифр/i)).toBeInTheDocument()
    expect(screen.queryByText('Що сталося?')).not.toBeInTheDocument()
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.some((call) => String(call[0]).includes('/auth/customer/verify/send'))).toBe(true)
    })
  })

  it('hides profile form on home when customer profile is verified', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify(verifiedTestProfile))
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
    expect(screen.queryByText('Ваш профіль')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Зберегти профіль/i })).not.toBeInTheDocument()
  })

  it('shows nearby providers before a customer creates an order', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/providers')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'provider-oleksandr',
              name: 'Олександр',
              status: 'online',
              verificationStatus: 'verified',
              vehicle: 'Volkswagen Transporter',
              etaMinutes: 12,
              location: { lat: 50.452, lng: 30.525 },
            },
            {
              id: 'provider-mykhailo',
              name: 'Михайло',
              status: 'online',
              verificationStatus: 'verified',
              vehicle: 'Renault Master',
              etaMinutes: 18,
              location: { lat: 50.448, lng: 30.521 },
            },
          ],
        })
      }
      return undefined
    }))

    await openCustomerHome(user)

    expect(await screen.findByText('2 на лінії поруч')).toBeInTheDocument()
    // Subtitle uses a middle-dot separator; match name from the live availability list.
    expect(await screen.findByText(/Олександр · Volkswagen Transporter/i)).toBeInTheDocument()
    expect(screen.getByText(/Михайло · Renault Master/i)).toBeInTheDocument()
  })

  it('lets a provider go on duty before seeing offers', async () => {
    const user = userEvent.setup()
    const providerSessionToken = 'pomich_auth_v1.provider-session'
    const completedProvider = {
      id: 'provider-oleksandr',
      name: 'Олександр',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      specialties: ['tow', 'fuel'],
      serviceRadiusKm: 9,
    }
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
          json: async () => [{ ...completedProvider, status: 'offline' }],
        })
      }
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...completedProvider, status: 'offline' }),
        })
      }
      if (url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...completedProvider, status: 'online' }),
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

    await user.click(screen.getByRole('switch', { name: /Поза лінією/i }))

    expect(await screen.findAllByText('На лінії')).not.toHaveLength(0)
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

  it('falls back to provider account login when legacy provider token is rejected', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/provider/session')) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ detail: 'provider_bootstrap_session_disabled' }),
        })
      }
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?providerToken=legacy-provider-token')

    renderApp()

    expect(await screen.findByText('Вхід партнера')).toBeInTheDocument()
    expect(await screen.findByText(/Партнерська сесія не відкрита/i)).toBeInTheDocument()
    expect(window.sessionStorage.getItem('pomichProviderToken')).toBeNull()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/provider/session'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-POMICH-Provider-Token': 'legacy-provider-token' }),
        }),
      )
    })
  })

  it('lets a provider request a password reset from account login', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/provider/session')) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ detail: 'provider_bootstrap_session_disabled' }),
        })
      }
      if (url.includes('/auth/provider/password-reset/request')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, queued: true }) })
      }
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?providerToken=legacy-provider-token&providerId=provider-oleksandr')

    renderApp()

    expect(await screen.findByText('Вхід партнера')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Забули пароль\? Запросити reset/i }))

    expect(await screen.findByText(/Запит на reset надіслано/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/provider/password-reset/request'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ login: 'provider-oleksandr', providerId: 'provider-oleksandr' }),
        }),
      )
    })
  })

  it('forces provider password update after temporary password login', async () => {
    const user = userEvent.setup()
    const providerSessionToken = 'pomich_auth_v1.provider-session'
    const completedProvider = {
      id: 'provider-oleksandr',
      name: 'Олександр',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      specialties: ['tow', 'fuel'],
      serviceRadiusKm: 9,
      status: 'offline',
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/provider/session')) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ detail: 'provider_bootstrap_session_disabled' }),
        })
      }
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
            username: 'provider-oleksandr',
            passwordResetRequired: true,
          }),
        })
      }
      if (url.includes('/auth/provider/password')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, providerId: 'provider-oleksandr', passwordResetRequired: false }),
        })
      }
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({ ok: true, json: async () => completedProvider })
      }
      if (url.endsWith('/providers')) {
        return Promise.resolve({ ok: true, json: async () => [completedProvider] })
      }
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?providerToken=legacy-provider-token')

    renderApp()

    expect(await screen.findByText('Вхід партнера')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Пароль'), 'temporary-pass')
    await user.click(screen.getByRole('button', { name: /^Увійти$/i }))

    expect(await screen.findByText('Оновіть пароль')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Кабінет$/i }))
    expect(await screen.findByText('Оновіть пароль')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Новий пароль'), 'provider-pass-2')
    await user.type(screen.getByLabelText('Повторіть пароль'), 'provider-pass-2')
    await user.click(screen.getByRole('button', { name: /Оновити пароль/i }))

    expect(await screen.findByText('Партнер POMICH')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/provider/password'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: `Bearer ${providerSessionToken}` }),
          body: expect.stringContaining('"newPassword":"provider-pass-2"'),
        }),
      )
    })
  })

  it('opens incoming offer details and accepts with price', async () => {
    const user = userEvent.setup()
    const providerSessionToken = 'pomich_auth_v1.provider-session'
    const watchPosition = vi.fn()
    const clearWatch = vi.fn()
    const navigatorStub = {
      ...navigator,
      geolocation: { getCurrentPosition: vi.fn(), watchPosition, clearWatch },
    }
    vi.stubGlobal('navigator', navigatorStub)
    const pendingOffer = {
      id: 'OF-TEST-1',
      orderId: 'ORD-TEST-1',
      providerId: 'provider-oleksandr',
      status: 'pending',
      service: 'tow',
      distanceKm: 4.2,
      vehicleState: 'Не заводиться',
      approximateLocation: 'вул. Швабська, Ужгород',
      customerComment: 'Потрібен евакуатор',
      customerCoordinates: { lat: 48.62, lng: 22.29 },
      expiresAt: new Date(Date.now() + 20000).toISOString(),
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url.includes('/users/') && url.includes('/account')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: 'provider-oleksandr',
            preferredRole: 'provider',
            linkedProviderId: 'provider-oleksandr',
            rolesRegistered: ['provider'],
            clientRegistered: false,
            providerRegistered: true,
            needsOnboarding: false,
          }),
        })
      }
      if (url.includes('/providers/provider-oleksandr/presence') && init?.method === 'PATCH') {
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
      }
      if (url.includes('/providers/provider-oleksandr/offers') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            offer: { ...pendingOffer, status: 'accepted' },
            order: { id: 'ORD-TEST-1', status: 'accepted', partnerProposedPrice: 1200 },
            provider: { id: 'provider-oleksandr', status: 'busy' },
          }),
        })
      }
      if (url.includes('/providers/provider-oleksandr/offers')) {
        return Promise.resolve({ ok: true, json: async () => [pendingOffer] })
      }
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'provider-oleksandr',
            name: 'Олександр',
            phone: '+380671112233',
            city: 'Ужгород',
            vehicle: 'Volkswagen Crafter',
            plate: 'BX5874HX',
            status: 'online',
            registeredAt: '2026-08-09T00:00:00',
            verificationStatus: 'verified',
            specialties: ['tow', 'fuel'],
            serviceRadiusKm: 9,
          }),
        })
      }
      if (url.includes('/map/orders/nearby')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{
            id: 'ORD-TEST-1',
            service: 'tow',
            customerLocation: 'вул. Швабська, Ужгород',
            vehicleState: 'Не заводиться',
            customerComment: 'Потрібен евакуатор',
            customerCoordinates: { lat: 48.62, lng: 22.29 },
            distanceKm: 4.2,
          }],
        })
      }
      if (url.endsWith('/providers') || /\/providers(\?|$)/.test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => [{
            id: 'provider-oleksandr',
            name: 'Олександр',
            status: 'online',
            registeredAt: '2026-08-09T00:00:00',
            verificationStatus: 'verified',
            specialties: ['tow', 'fuel'],
            serviceRadiusKm: 9,
          }],
        })
      }
      if (url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?providerToken=partner-secret')

    renderApp()

    const openBtn = await screen.findByRole('button', { name: /Відкрити заявку/i })
    await user.click(openBtn)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Деталі заявки/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    const inputs = screen.getAllByPlaceholderText('1200')
    await user.type(inputs[0], '1200')
    const acceptBtns = screen.getAllByRole('button', { name: /ПРИЙНЯТИ З ЦІНОЮ/i })
    await user.click(acceptBtns[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/providers/provider-oleksandr/offers/OF-TEST-1/accept'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"proposedPrice":1200'),
        }),
      )
    })
    expect(await screen.findByText('Очікуємо клієнта')).toBeInTheDocument()
  })

  it('shows partner name and proposed price after accept polling', async () => {
    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichBootstrapProfile', JSON.stringify(verifiedTestProfile))
    window.sessionStorage.setItem('pomichActiveOrder', JSON.stringify({ orderId: 'ORD-PRICE-1', status: 'accepted', updatedAt: Date.now() }))
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

    vi.stubGlobal('fetch', mockRegisteredCustomerFetch((url) => {
      if (url.includes('/users/') && url.includes('/account') && !url.includes('/role')) {
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
      if (url.includes('/orders/ORD-PRICE-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'ORD-PRICE-1',
            status: 'accepted',
            partnerProposedPrice: 1500,
            providerName: 'Віталій',
            assignedProvider: {
              id: 'provider-vitaliy',
              name: 'Віталій',
              vehicle: 'Ford Transit',
              plate: 'AO1234CH',
              etaMinutes: 8,
            },
          }),
        })
      }
      return undefined
    }))

    renderApp()

    expect(await screen.findByText('Партнер прийняв заявку', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.getByText('Віталій')).toBeInTheDocument()
    expect(screen.getAllByText(/1[\s\u00a0]?500\s*₴/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Підтвердити ціну/i })).toBeInTheDocument()
  }, 15000)

  it('shows provider cabinet with synced online status and editable profile', async () => {
    const user = userEvent.setup()
    const providerSessionToken = 'pomich_auth_v1.provider-session'
    let providerStatus = 'offline'
    const providerRecord = {
      id: 'provider-oleksandr',
      name: 'Олександр',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      specialties: ['tow', 'fuel'],
      serviceRadiusKm: 9,
      get status() {
        return providerStatus
      },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url.includes('/providers/provider-oleksandr/profile') && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ ...providerRecord, name: 'Михайло' }) })
      }
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({ ok: true, json: async () => providerRecord })
      }
      if (url.includes('/providers/provider-oleksandr/presence') && init?.method === 'PATCH') {
        providerStatus = 'online'
        return Promise.resolve({ ok: true, json: async () => ({ ...providerRecord, status: 'online' }) })
      }
      if (url.includes('/providers/provider-oleksandr/offers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      if (url.endsWith('/providers')) {
        return Promise.resolve({ ok: true, json: async () => [providerRecord] })
      }
      if (url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => providerRecord })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?providerToken=partner-secret')

    renderApp()

    expect(await screen.findByText('Партнер POMICH')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: /Поза лінією/i }))
    expect(await screen.findAllByText('На лінії')).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /^Кабінет$/i }))
    expect(await screen.findByText('Кабінет партнера')).toBeInTheDocument()
    expect(screen.getByText('Олександр')).toBeInTheDocument()
    expect(screen.getAllByText('На лінії').length).toBeGreaterThan(0)
    expect(screen.queryByText('Не перевірено')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Редагувати$/i }))
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
  })

  it('shows ukrainian toast when go-online fails', async () => {
    const user = userEvent.setup()
    const providerSessionToken = 'pomich_auth_v1.provider-session'
    const completedProvider = {
      id: 'provider-oleksandr',
      name: 'Олександр',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Volkswagen Crafter',
      plate: 'BX5874HX',
      status: 'offline',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      specialties: ['tow'],
    }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
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
          json: async () => [completedProvider],
        })
      }
      if (url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      if (url.includes('/providers/provider-oleksandr/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => completedProvider,
        })
      }
      if (url.includes('/presence')) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ detail: 'provider verification must be approved before going online' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))
    window.history.pushState({}, '', '/?providerToken=partner-secret')

    renderApp()

    expect(await screen.findByText('Партнер POMICH')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Вийти на лінію/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Підтвердіть телефон/i)
  })

  it('shows clear toast when go-online hits provider identity mismatch', async () => {
    const user = userEvent.setup()
    const providerSessionToken = 'pomich_auth_v1.provider-session'
    const completedProvider = {
      id: 'provider-tg-829741830',
      name: 'Віталій',
      phone: '+380671112233',
      city: 'Ужгород',
      vehicle: 'Ford Transit',
      plate: 'AO1234CH',
      status: 'offline',
      registeredAt: '2026-08-09T00:00:00',
      verificationStatus: 'verified',
      specialties: ['tow'],
    }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/provider/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'provider',
            subjectId: 'provider-tg-829741830',
            providerId: 'provider-tg-829741830',
            tokenType: 'Bearer',
            accessToken: providerSessionToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.endsWith('/providers')) {
        return Promise.resolve({
          ok: true,
          json: async () => [completedProvider],
        })
      }
      if (url.includes('/map/providers')) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      if (url.includes('/providers/provider-tg-829741830/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => completedProvider,
        })
      }
      if (url.includes('/presence')) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ detail: 'provider_identity_mismatch' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => completedProvider })
    }))
    window.history.pushState({}, '', '/?providerToken=partner-secret&providerId=provider-tg-829741830')

    renderApp()

    expect(await screen.findByText('Партнер POMICH')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Вийти на лінію/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Акаунт партнера не збігається')
  })

  it('lets a provider open phone restore from registration instead of password dead-end', async () => {
    const user = userEvent.setup()
    renderApp()

    const partnerButtons = await screen.findAllByRole('button', { name: /Надаю послуги/i })
    await user.click(partnerButtons[0]!)
    // Landing partner entry is phone login for returning partners.
    expect(await screen.findByText('Увійти')).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
    expect(document.querySelector('input[type="tel"]')).toBeTruthy()
  })

  it('moves from service selection to the tow flow', async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    await user.click(screen.getByRole('button', { name: /Евакуатор/i }))

    expect(screen.getByText('Де ви зараз?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Підтвердити місце/i }))
    expect(screen.getByText('Куди доставити авто?')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/СТО/i), 'СТО «Авторемонт»')
    await user.click(screen.getByRole('button', { name: /^Далі$/i }))
    expect(screen.getByText('Що з автомобілем?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Авто не заводиться/i }))
    await user.click(screen.getByRole('button', { name: /^Далі$/i }))
    expect(screen.getByText('Перевірте заявку')).toBeInTheDocument()
  })

  it('skips destination for on-site battery help', async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    await user.click(screen.getByRole('button', { name: /Акумулятор/i }))
    expect(screen.getByText('Де ви зараз?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Підтвердити місце/i }))
    expect(screen.getByText('Що з автомобілем?')).toBeInTheDocument()
    expect(screen.queryByText('Куди доставити авто?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Авто не заводиться/i }))
    await user.click(screen.getByRole('button', { name: /^Далі$/i }))
    expect(screen.getByText('Перевірте заявку')).toBeInTheDocument()
    expect(screen.getByText(/По місцю, нікуди їхати не потрібно/i)).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: /Акумулятор/i }))
    await user.click(screen.getByRole('button', { name: /Підтвердити місце/i }))
    await user.click(screen.getByRole('button', { name: /Авто не заводиться/i }))
    await user.click(screen.getByRole('button', { name: /^Далі$/i }))
    await user.click(screen.getByRole('button', { name: /Надіслати заявку/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    expect(await screen.findByText(/Заявку надіслано/i)).toBeInTheDocument()
    expect(await screen.findByText('Замовлення #PM-123456')).toBeInTheDocument()
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
      if (url.includes('/admin/ops-log')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            events: [],
            counts: { error: 0, warn: 0, info: 0, total: 0 },
            limit: 100,
          }),
        })
      }
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'dev', corsOrigins: ['*'], encryptionEnabled: false, databaseUrlConfigured: false, telegramConfigured: false, adminAccountsConfigured: true, providerAccountsConfigured: false, allowHttpPilot: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/orders/PM-1/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'PM-1', status: 'en_route', updatedAt: '2026-08-09T00:05:00' }),
        })
      }
      if (url.includes('/admin/orders') || url.endsWith('/orders')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'PM-1',
              status: 'assigned',
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
    const enRouteButtons = await screen.findAllByRole('button', { name: /Виконавець у дорозі/i })
    await user.click(enRouteButtons[enRouteButtons.length - 1])

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

  it('shows auth audit events and filters by event type', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-session'
    const opsUrls: string[] = []
    const auditProvider = {
      id: 'provider-a',
      name: 'Provider A',
      phone: '+380501112233',
      status: 'offline',
      vehicle: 'Iveco Daily',
      serviceRadiusKm: 12,
      specialties: ['tow'],
      verificationStatus: 'verified' as const,
      authAccount: {
        id: 'provider:provider-a',
        role: 'provider' as const,
        providerId: 'provider-a',
        username: 'provider-a',
        status: 'active' as const,
        hasPassword: true,
      },
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
      if (url.includes('/admin/stats')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totals: { clients: 0, providers: 1, dispatchProviders: 0, directoryProviders: 0, orders: 0, activeOrders: 0, completedOrders: 0 },
            providers: { online: 0, busy: 0, offline: 1, verified: 1, pendingVerification: 0 },
            clients: { verified: 0, registered: 0, disabled: 0 },
            orders: { searching: 0, assigned: 0, enRoute: 0, inProgress: 0 },
            activity: [],
          }),
        })
      }
      if (url.includes('/admin/ops-log')) {
        opsUrls.push(url)
        const disabledOnly = url.includes('eventType=AUTH_ACCOUNT_DISABLED')
        const resetOnly = url.includes('eventType=AUTH_ACCOUNT_PASSWORD_RESET_REQUESTED')
        const resetRequestEvent = {
          id: 'ops-reset-request',
          type: 'AUTH_ACCOUNT_PASSWORD_RESET_REQUESTED',
          at: '2026-08-23T10:03:00',
          severity: 'info',
          source: 'auth.provider.password-reset.request',
          message: 'Provider password reset requested',
          providerId: 'provider-a',
          code: 'provider:provider-a',
          accountRole: 'provider',
          accountStatus: 'active',
          requestedLogin: 'provider-a',
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            events: resetOnly
              ? [resetRequestEvent]
              : disabledOnly
              ? [
                  {
                    id: 'ops-disabled',
                    type: 'AUTH_ACCOUNT_DISABLED',
                    at: '2026-08-23T10:02:00',
                    severity: 'info',
                    source: 'admin.auth.accounts.delete',
                    message: 'Provider account disabled',
                    providerId: 'provider-a',
                    code: 'provider:provider-a',
                    accountRole: 'provider',
                    accountStatus: 'disabled',
                  },
                ]
              : [
                  {
                    id: 'ops-created',
                    type: 'AUTH_ACCOUNT_CREATED',
                    at: '2026-08-23T10:01:00',
                    severity: 'info',
                    source: 'providers.verification.review',
                    message: 'Provider auth account ready after verification',
                    providerId: 'provider-a',
                    code: 'provider:provider-a',
                    accountRole: 'provider',
                    accountStatus: 'active',
                  },
                  {
                    id: 'ops-disabled',
                    type: 'AUTH_ACCOUNT_DISABLED',
                    at: '2026-08-23T10:02:00',
                    severity: 'info',
                    source: 'admin.auth.accounts.delete',
                    message: 'Provider account disabled',
                    providerId: 'provider-a',
                    code: 'provider:provider-a',
                    accountRole: 'provider',
                    accountStatus: 'disabled',
                  },
                  resetRequestEvent,
                ],
            counts: {
              error: 0,
              warn: 0,
              info: disabledOnly || resetOnly ? 1 : 3,
              total: disabledOnly || resetOnly ? 1 : 3,
            },
            limit: 100,
          }),
        })
      }
      if (url.includes('/admin/auth/accounts/provider%3Aprovider-a/temporary-password')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'provider:provider-a',
            role: 'provider',
            providerId: 'provider-a',
            username: 'provider-a',
            status: 'active',
            hasPassword: true,
            passwordResetRequired: true,
            temporaryPassword: 'tmp-audit-pass',
            temporaryPasswordIssuedAt: '2026-08-23T10:04:00',
          }),
        })
      }
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [auditProvider] })
      if (url.includes('/admin/orders')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'dev', corsOrigins: ['*'], encryptionEnabled: false, databaseUrlConfigured: true, sqlStorageEnabled: true, storageBackend: 'sql', telegramConfigured: false, adminAccountsConfigured: true, providerAccountsConfigured: true, authAccountsSource: 'sql', allowHttpPilot: false, bootstrapAuthSessionsEnabled: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin&adminToken=test-admin')

    renderApp()

    expect(await screen.findByText('POMICH Admin')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Аудит/i }))
    expect(await screen.findByText('Аудит доступів')).toBeInTheDocument()
    expect(await screen.findByText('Provider auth account ready after verification')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Event type'), 'AUTH_ACCOUNT_DISABLED')

    expect(await screen.findByText('Provider account disabled')).toBeInTheDocument()
    await waitFor(() => {
      expect(opsUrls.some((url) => url.includes('auditOnly=true') && url.includes('eventType=AUTH_ACCOUNT_DISABLED'))).toBe(true)
    })
    await user.click(screen.getByRole('button', { name: /^Партнер$/i }))
    expect((await screen.findAllByText('Provider A')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^Тимчасовий пароль$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Аудит/i }))
    await user.selectOptions(screen.getByLabelText('Event type'), 'AUTH_ACCOUNT_PASSWORD_RESET_REQUESTED')
    expect(await screen.findByText('Provider password reset requested')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /^Видати пароль$/i }))
    expect(await screen.findByText('Запрошення для партнера')).toBeInTheDocument()
    expect(await screen.findByText('tmp-audit-pass')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/auth/accounts/provider%3Aprovider-a/temporary-password'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: `Bearer ${adminSessionToken}` }),
        }),
      )
    })
  })

  it('shows provider temporary password after admin approves verification', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-session'
    const clipboardWrite = vi.fn(() => Promise.resolve())
    const pendingProvider = {
      id: 'provider-new',
      name: 'Provider New',
      phone: '+380501112233',
      status: 'offline',
      vehicle: 'Iveco Daily',
      serviceRadiusKm: 12,
      specialties: ['tow'],
      verificationStatus: 'pending' as const,
    }
    let providerAccount: AdminAuthAccount = {
      id: 'provider:provider-new',
      role: 'provider',
      providerId: 'provider-new',
      username: 'provider-new',
      status: 'active',
      hasPassword: true,
      passwordResetRequired: true,
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
      if (url.includes('/admin/stats')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totals: { clients: 0, providers: 1, dispatchProviders: 0, directoryProviders: 0, orders: 0, activeOrders: 0, completedOrders: 0 },
            providers: { online: 0, busy: 0, offline: 1, verified: 0, pendingVerification: 1 },
            clients: { verified: 0, registered: 0, disabled: 0 },
            orders: { searching: 0, assigned: 0, enRoute: 0, inProgress: 0 },
            activity: [],
          }),
        })
      }
      if (url.includes('/admin/ops-log')) return Promise.resolve({ ok: true, json: async () => ({ events: [], counts: { error: 0, warn: 0, info: 0, total: 0 }, limit: 100 }) })
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/orders')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [pendingProvider] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'dev', corsOrigins: ['*'], encryptionEnabled: false, databaseUrlConfigured: true, sqlStorageEnabled: true, storageBackend: 'sql', telegramConfigured: false, adminAccountsConfigured: true, providerAccountsConfigured: false, allowHttpPilot: false, bootstrapAuthSessionsEnabled: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/auth/accounts/provider%3Aprovider-new/temporary-password')) {
        providerAccount = {
          ...providerAccount,
          passwordResetRequired: true,
          temporaryPasswordIssuedAt: '2026-08-22T18:00:00',
          temporaryPassword: 'tmp-provider-pass-2',
        }
        return Promise.resolve({ ok: true, json: async () => providerAccount })
      }
      if (url.includes('/admin/auth/accounts/provider%3Aprovider-new') && init?.method === 'DELETE') {
        providerAccount = { ...providerAccount, status: 'disabled' }
        return Promise.resolve({ ok: true, json: async () => providerAccount })
      }
      if (url.includes('/admin/auth/accounts/provider%3Aprovider-new') && init?.method === 'PATCH') {
        const payload = JSON.parse(String(init.body))
        providerAccount = { ...providerAccount, status: payload.status || providerAccount.status }
        return Promise.resolve({ ok: true, json: async () => providerAccount })
      }
      if (url.includes('/providers/provider-new/verification/review') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...pendingProvider,
            verificationStatus: 'verified',
            authAccountBootstrap: {
              id: providerAccount.id,
              providerId: providerAccount.providerId,
              username: providerAccount.username,
              status: providerAccount.status,
              created: true,
              activated: true,
              temporaryPassword: 'tmp-provider-pass',
              temporaryPasswordIssuedAt: '2026-08-22T18:00:00',
              passwordResetRequired: true,
            },
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText: clipboardWrite } })
    window.history.pushState({}, '', '/?role=admin&adminToken=test-admin')

    renderApp()

    expect(await screen.findByText('POMICH Admin')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Перевірка/i }))
    await user.click(await screen.findByRole('button', { name: /^Схвалити$/i }))

    expect(await screen.findByText('Запрошення для партнера')).toBeInTheDocument()
    expect(screen.getByText('tmp-provider-pass')).toBeInTheDocument()
    expect(screen.getByText('https://pomich.help/?role=provider')).toBeInTheDocument()
    expect(screen.getByText('2026-08-22T18:00:00')).toBeInTheDocument()
    expect(screen.getByText('зміна пароля обовʼязкова')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Скопіювати інвайт/i }))
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining('tmp-provider-pass'))
    expect(await screen.findByText('Скопійовано')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Тимчасовий пароль$/i }))
    expect(await screen.findByText('tmp-provider-pass-2')).toBeInTheDocument()
    expect(await screen.findByText(/Temporary password for provider-new: tmp-provider-pass-2/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Вимкнути account/i }))
    expect(await screen.findByText(/Provider account provider:provider-new вимкнено/i)).toBeInTheDocument()
    expect(await screen.findByText('disabled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Увімкнути account/i }))
    expect(await screen.findByText(/Provider account provider:provider-new увімкнено/i)).toBeInTheDocument()

    const logButtons = screen.getAllByRole('button', { name: /^Логи$/i })
    await user.click(logButtons[logButtons.length - 1])
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/providers/provider-new/verification/review'),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ Authorization: `Bearer ${adminSessionToken}` }),
        }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('providerId=provider-new'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${adminSessionToken}` }),
        }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/auth/accounts/provider%3Aprovider-new/temporary-password'),
        expect.objectContaining({ method: 'POST' }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/auth/accounts/provider%3Aprovider-new'),
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/auth/accounts/provider%3Aprovider-new'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  it('lets admin link a Telegram customer to a provider', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-session'
    const provider = {
      id: 'provider-tg-77',
      name: 'Partner 77',
      phone: '+380501112233',
      status: 'offline',
      vehicle: 'Iveco Daily',
      serviceRadiusKm: 12,
      specialties: ['tow'],
      verificationStatus: 'verified' as const,
    }
    let clientProfile = {
      id: 'tg-77',
      name: 'Telegram Partner',
      phone: '+380501112233',
      telegram: 'partner77',
      city: 'Київ',
      verificationStatus: 'verified' as const,
      linkedProviderId: '',
      preferredRole: 'customer' as const,
      rolesRegistered: ['customer' as const],
      telegramBotKind: 'provider' as const,
      telegramNotificationChannel: 'provider' as const,
      customerIdentity: { type: 'telegram' as const, telegramUserId: '77', username: 'partner77' },
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
      if (url.includes('/admin/stats')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totals: { clients: 1, providers: 1, dispatchProviders: 1, directoryProviders: 0, orders: 0, activeOrders: 0, completedOrders: 0 },
            providers: { online: 0, busy: 0, offline: 1, verified: 1, pendingVerification: 0 },
            clients: { verified: 1, registered: 1, disabled: 0 },
            orders: { searching: 0, assigned: 0, enRoute: 0, inProgress: 0 },
            activity: [],
          }),
        })
      }
      if (url.includes('/admin/clients/tg-77') && init?.method === 'PATCH') {
        const payload = JSON.parse(String(init.body))
        clientProfile = { ...clientProfile, ...payload }
        return Promise.resolve({ ok: true, json: async () => clientProfile })
      }
      if (url.includes('/admin/ops-log')) return Promise.resolve({ ok: true, json: async () => ({ events: [], counts: { error: 0, warn: 0, info: 0, total: 0 }, limit: 100 }) })
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [clientProfile] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [provider] })
      if (url.includes('/admin/orders')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'dev', corsOrigins: ['*'], encryptionEnabled: false, databaseUrlConfigured: true, sqlStorageEnabled: true, storageBackend: 'sql', telegramConfigured: true, adminAccountsConfigured: true, providerAccountsConfigured: true, allowHttpPilot: false, bootstrapAuthSessionsEnabled: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin&adminToken=test-admin')

    renderApp()

    expect(await screen.findByText('POMICH Admin')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Клієнти/i }))
    expect(await screen.findByText('Telegram / provider link')).toBeInTheDocument()
    expect(screen.getByText('77')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Linked provider'), 'provider-tg-77')
    await user.click(screen.getByRole('button', { name: /^Зберегти$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/clients/tg-77'),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ Authorization: `Bearer ${adminSessionToken}` }),
          body: expect.stringContaining('"linkedProviderId":"provider-tg-77"'),
        }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/clients/tg-77'),
        expect.objectContaining({
          body: expect.stringContaining('"preferredRole":"provider"'),
        }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/clients/tg-77'),
        expect.objectContaining({
          body: expect.stringContaining('"rolesRegistered":["customer","provider"]'),
        }),
      )
    })
  })

  it('opens admin login from #admin hash on initial load', async () => {
    window.history.pushState({}, '', '/#admin')

    renderApp()

    expect(await screen.findByText('Захищена адмін-панель')).toBeInTheDocument()
    expect(screen.queryByText(/Допомога на дорозі — поруч/i)).not.toBeInTheDocument()
    expect(window.location.search).toBe('?role=admin')
    expect(window.location.hash).toBe('')
  })

  it('opens admin login when hash changes to #admin', async () => {
    renderApp()
    expect(await screen.findByText(/Допомога на дорозі — поруч/i)).toBeInTheDocument()

    window.location.hash = '#admin'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(await screen.findByText('Захищена адмін-панель')).toBeInTheDocument()
    expect(window.location.search).toBe('?role=admin')
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
      if (url.includes('/admin/ops-log')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            events: [],
            counts: { error: 0, warn: 0, info: 0, total: 0 },
            limit: 100,
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

  it('lets an admin request a password reset from account login', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/admin/password-reset/request')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, queued: true }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin')

    renderApp()

    expect(await screen.findByText('Захищена адмін-панель')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Забули пароль\? Запросити reset/i }))

    expect(await screen.findByText(/Запит на reset надіслано/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/admin/password-reset/request'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ login: 'dispatcher' }),
        }),
      )
    })
  })

  it('requires an admin to complete temporary password reset before opening the dashboard', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-temp-session'
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/admin/login')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: 'admin',
            subjectId: 'admin-dispatcher',
            username: 'dispatcher',
            tokenType: 'Bearer',
            accessToken: adminSessionToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            passwordResetRequired: true,
          }),
        })
      }
      if (url.includes('/auth/admin/password')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, adminId: 'admin-dispatcher', passwordResetRequired: false }),
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
      if (url.includes('/admin/ops-log')) return Promise.resolve({ ok: true, json: async () => ({ events: [], counts: { error: 0, warn: 0, info: 0, total: 0 }, limit: 100 }) })
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/orders')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'dev', corsOrigins: ['*'], encryptionEnabled: false, databaseUrlConfigured: true, sqlStorageEnabled: true, storageBackend: 'sql', telegramConfigured: false, adminAccountsConfigured: true, providerAccountsConfigured: true, authAccountsSource: 'sql', allowHttpPilot: false, bootstrapAuthSessionsEnabled: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin')

    renderApp()

    await user.type(await screen.findByLabelText('Пароль'), 'temporary-pass')
    await user.click(screen.getByRole('button', { name: /Увійти/i }))
    expect(await screen.findByText('Оновіть пароль')).toBeInTheDocument()
    expect(screen.queryByText('POMICH Admin')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Новий пароль'), 'admin-pass-2')
    await user.type(screen.getByLabelText('Повторіть пароль'), 'admin-pass-2')
    await user.click(screen.getByRole('button', { name: /Оновити пароль/i }))

    expect(await screen.findByText('POMICH Admin')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/admin/password'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: `Bearer ${adminSessionToken}` }),
          body: JSON.stringify({ newPassword: 'admin-pass-2' }),
        }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/stats'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${adminSessionToken}` }),
        }),
      )
    })
    const storedSession = JSON.parse(window.sessionStorage.getItem(authSessionStorageKey('admin', 'admin')) || '{}')
    expect(storedSession.passwordResetRequired).toBe(false)
  })

  it('lets an admin manage SQL auth accounts from the admin panel', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-account-session'
    const authAccounts: AdminAuthAccount[] = [
      {
        id: 'admin-dispatcher',
        role: 'admin',
        username: 'dispatcher',
        status: 'active',
        hasPassword: true,
      },
    ]
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url.includes('/admin/ops-log')) return Promise.resolve({ ok: true, json: async () => ({ events: [], counts: { error: 0, warn: 0, info: 0, total: 0 }, limit: 100 }) })
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/orders')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'dev', corsOrigins: ['*'], encryptionEnabled: false, databaseUrlConfigured: true, sqlStorageEnabled: true, storageBackend: 'sql', telegramConfigured: false, adminAccountsConfigured: true, providerAccountsConfigured: true, adminAccountsActive: 1, adminAccountsTotal: 1, providerAccountsActive: 1, providerAccountsTotal: 2, authAccountsSource: 'sql', allowHttpPilot: false, bootstrapAuthSessionsEnabled: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/auth/accounts') && url.includes('/temporary-password')) {
        const updated: AdminAuthAccount = {
          ...authAccounts[1]!,
          passwordResetRequired: true,
          temporaryPasswordIssuedAt: '2026-08-22T18:00:00',
          temporaryPassword: 'tmp-provider-pass',
        }
        authAccounts[1] = updated
        return Promise.resolve({ ok: true, json: async () => updated })
      }
      if (url.includes('/admin/auth/accounts') && url.includes('/password')) {
        const updated: AdminAuthAccount = { ...authAccounts[1]!, hasPassword: true }
        authAccounts[1] = updated
        return Promise.resolve({ ok: true, json: async () => updated })
      }
      if (url.includes('/admin/auth/accounts') && init?.method === 'DELETE') {
        const updated: AdminAuthAccount = { ...authAccounts[1]!, status: 'disabled' }
        authAccounts[1] = updated
        return Promise.resolve({ ok: true, json: async () => updated })
      }
      if (url.endsWith('/admin/auth/accounts') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body))
        const created: AdminAuthAccount = {
          id: `provider:${payload.providerId}`,
          role: 'provider',
          username: payload.username,
          providerId: payload.providerId,
          email: '',
          phone: '',
          status: 'active',
          hasPassword: true,
        }
        authAccounts.push(created)
        return Promise.resolve({ ok: true, json: async () => created })
      }
      if (url.includes('/admin/auth/accounts')) {
        return Promise.resolve({ ok: true, json: async () => authAccounts })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin')

    renderApp()

    await user.type(await screen.findByLabelText('Пароль'), 'admin-pass')
    await user.click(screen.getByRole('button', { name: /Увійти/i }))
    expect(await screen.findByText('POMICH Admin')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Налаштування/i }))
    expect(await screen.findByText('Auth source')).toBeInTheDocument()
    expect(screen.getByText('sql')).toBeInTheDocument()
    expect(screen.getByText('1/1 active')).toBeInTheDocument()
    expect(screen.getByText('1/2 active')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Акаунти/i }))
    expect(await screen.findByText(/admin-dispatcher/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Логін акаунта'), 'managed-partner')
    await user.type(screen.getByLabelText('Provider ID'), 'provider-managed')
    await user.type(screen.getByLabelText('Пароль акаунта'), 'provider-pass')
    await user.click(screen.getByRole('button', { name: /Створити акаунт/i }))
    expect((await screen.findAllByText(/provider:provider-managed/i)).length).toBeGreaterThan(0)

    await user.type(screen.getByLabelText('Новий пароль provider:provider-managed'), 'provider-pass-2')
    const passwordButtons = screen.getAllByRole('button', { name: /Змінити пароль/i })
    await user.click(passwordButtons[passwordButtons.length - 1])
    expect(await screen.findByText(/Пароль для provider:provider-managed оновлено/i)).toBeInTheDocument()

    const temporaryButtons = screen.getAllByRole('button', { name: /Тимчасовий пароль/i })
    await user.click(temporaryButtons[temporaryButtons.length - 1])
    expect(await screen.findByText(/Temporary password for provider:provider-managed: tmp-provider-pass/i)).toBeInTheDocument()
    expect(await screen.findByText(/reset required/i)).toBeInTheDocument()

    const disableButtons = screen.getAllByRole('button', { name: /Вимкнути/i })
    await user.click(disableButtons[disableButtons.length - 1])
    expect(await screen.findByText(/Акаунт provider:provider-managed вимкнено/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/auth/accounts'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: `Bearer ${adminSessionToken}` }),
        }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/auth/accounts/provider%3Aprovider-managed/password'),
        expect.objectContaining({ method: 'POST' }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/auth/accounts/provider%3Aprovider-managed/temporary-password'),
        expect.objectContaining({ method: 'POST' }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/auth/accounts/provider%3Aprovider-managed'),
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  it('falls back to admin account login when bootstrap admin session is disabled', async () => {
    const user = userEvent.setup()
    const adminSessionToken = 'pomich_auth_v1.admin-account-session'
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/admin/session')) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ detail: 'admin_bootstrap_session_disabled' }),
        })
      }
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
      if (url.includes('/admin/ops-log')) return Promise.resolve({ ok: true, json: async () => ({ events: [], counts: { error: 0, warn: 0, info: 0, total: 0 }, limit: 100 }) })
      if (url.includes('/admin/clients')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/orders')) return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/admin/settings')) return Promise.resolve({ ok: true, json: async () => ({ runtime: 'production', corsOrigins: ['https://pomich.help'], encryptionEnabled: true, databaseUrlConfigured: true, telegramConfigured: true, adminAccountsConfigured: true, providerAccountsConfigured: true, allowHttpPilot: false, bootstrapAuthSessionsEnabled: false, sessionTtlSeconds: 86400 }) })
      if (url.includes('/map/providers')) return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?role=admin&adminToken=legacy-bootstrap-token')

    renderApp()

    expect(await screen.findByText('Захищена адмін-панель')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Пароль'), 'admin-pass')
    await user.click(screen.getByRole('button', { name: /Увійти/i }))

    expect(await screen.findByText('POMICH Admin')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/admin/login'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
