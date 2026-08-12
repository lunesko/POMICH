import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authSessionStorageKey,
  clearCustomerAuthStorage,
  detectStoredCustomerMismatch,
  guestSessionCustomerIdForRestore,
  isExplicitLogout,
  markExplicitLogout,
  storeAuthSession,
} from './auth'
import {
  clearActiveOrder,
  enrichProfileWithTelegram,
  persistActiveOrder,
  readActiveOrder,
  readBootstrapProfileForCustomer,
  resolveCustomerAuthSession,
} from './customerSession'

describe('customerSession', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('drops bootstrap profile when customer id mismatches', () => {
    window.sessionStorage.setItem(
      'pomichBootstrapProfile',
      JSON.stringify({ id: 'guest-roman', name: 'Roman', phone: '+380935718207' }),
    )

    expect(readBootstrapProfileForCustomer('tg-829741830')).toBeUndefined()
    expect(window.sessionStorage.getItem('pomichBootstrapProfile')).toBeNull()
  })

  it('detects stale web guest id in Telegram context', () => {
    window.localStorage.setItem('pomichCustomerId', 'guest-roman')
    expect(detectStoredCustomerMismatch('829741830')).toBe(true)
  })

  it('persists and restores active order snapshot', () => {
    persistActiveOrder('PM-123', 'accepted')
    expect(readActiveOrder()).toEqual(expect.objectContaining({ orderId: 'PM-123', status: 'accepted' }))
    clearActiveOrder()
    expect(readActiveOrder()).toBeUndefined()
  })

  it('creates fresh guest session when only customer-web default remains', async () => {
    const guestSessionCalls: Array<string | undefined> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/customer/guest/session')) {
        const body = init?.body ? JSON.parse(String(init.body)) as { customerId?: string } : {}
        guestSessionCalls.push(body.customerId)
        return {
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'guest-new',
            customerId: 'guest-new',
            accessToken: 'pomich_auth_v1.new',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: { id: 'guest-new', name: 'Клієнт POMICH', phone: '', verificationStatus: 'unverified' },
            account: {
              customerId: 'guest-new',
              preferredRole: '',
              linkedProviderId: '',
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
            },
          }),
        }
      }
      if (url.includes('/users/') && url.includes('/account')) {
        return {
          ok: true,
          json: async () => ({
            customerId: 'guest-new',
            preferredRole: '',
            linkedProviderId: '',
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
          }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await resolveCustomerAuthSession({ initData: undefined, chatId: undefined, user: undefined })

    expect(resolved.customerId).toBe('guest-new')
    expect(guestSessionCalls).toEqual([undefined])
    expect(guestSessionCustomerIdForRestore('customer-web')).toBeUndefined()
  })

  it('prefers telegram session API over stored token when initData is present', async () => {
    storeAuthSession(authSessionStorageKey('customer', 'tg-829741830'), {
      role: 'customer',
      subjectId: 'tg-829741830',
      customerId: 'tg-829741830',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.stale',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    window.sessionStorage.setItem(
      'pomichBootstrapProfile',
      JSON.stringify({ id: 'guest-roman', name: 'Roman', phone: '+380935718207' }),
    )

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/customer/telegram/session')) {
        return {
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'tg-829741830',
            customerId: 'tg-829741830',
            accessToken: 'pomich_auth_v1.fresh',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: { id: 'tg-829741830', name: 'Виталий', phone: '+380661007434' },
            account: {
              customerId: 'tg-829741830',
              preferredRole: 'customer',
              linkedProviderId: '',
              rolesRegistered: ['customer'],
              clientRegistered: true,
              providerRegistered: false,
              needsOnboarding: false,
              profile: { id: 'tg-829741830', name: 'Виталий', phone: '+380661007434' },
            },
          }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await resolveCustomerAuthSession({
      initData: 'telegram-init-data',
      chatId: '829741830',
      user: { id: 829741830, first_name: 'Виталий' },
    })

    expect(resolved.customerId).toBe('tg-829741830')
    expect(resolved.token).toBe('pomich_auth_v1.fresh')
    expect(resolved.profile?.name).toBe('Виталий')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/customer/telegram/session'), expect.any(Object))
    expect(window.sessionStorage.getItem('pomichBootstrapProfile')).toBeNull()
  })

  it('skips telegram auto-login when user explicitly logged out', async () => {
    markExplicitLogout('829741830')

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/customer/telegram/session')) {
        throw new Error('telegram session should not be called after logout')
      }
      if (url.includes('/auth/customer/guest/session')) {
        const body = init?.body ? JSON.parse(String(init.body)) as { customerId?: string } : {}
        return {
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'guest-logged-out',
            customerId: 'guest-logged-out',
            accessToken: 'pomich_auth_v1.guest',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: { id: 'guest-logged-out', name: 'Клієнт POMICH', phone: '', verificationStatus: 'unverified' },
            account: {
              customerId: 'guest-logged-out',
              preferredRole: '',
              linkedProviderId: '',
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
            },
          }),
        }
      }
      if (url.includes('/users/') && url.includes('/account')) {
        return {
          ok: true,
          json: async () => ({
            customerId: 'guest-logged-out',
            preferredRole: '',
            linkedProviderId: '',
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
          }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await resolveCustomerAuthSession({
      initData: 'telegram-init-data',
      chatId: '829741830',
      user: { id: 829741830, first_name: 'Виталий' },
    })

    expect(resolved.customerId).toBe('guest-logged-out')
    expect(resolved.token).toBe('pomich_auth_v1.guest')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/auth/customer/telegram/session'), expect.any(Object))
    expect(isExplicitLogout('829741830')).toBe(true)
  })

  it('restores telegram profile on explicit sign-in after logout', async () => {
    markExplicitLogout('829741830')

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/customer/telegram/session')) {
        return {
          ok: true,
          json: async () => ({
            role: 'customer',
            subjectId: 'tg-829741830',
            customerId: 'tg-829741830',
            accessToken: 'pomich_auth_v1.fresh',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: { id: 'tg-829741830', name: 'Виталий', phone: '+380661007434' },
            account: {
              customerId: 'tg-829741830',
              preferredRole: 'customer',
              linkedProviderId: '',
              rolesRegistered: ['customer'],
              clientRegistered: true,
              providerRegistered: false,
              needsOnboarding: false,
              profile: { id: 'tg-829741830', name: 'Виталий', phone: '+380661007434' },
            },
          }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await resolveCustomerAuthSession(
      { initData: 'telegram-init-data', chatId: '829741830', user: { id: 829741830, first_name: 'Виталий' } },
      { explicitSignIn: true },
    )

    expect(resolved.customerId).toBe('tg-829741830')
    expect(resolved.profile?.phone).toBe('+380661007434')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/customer/telegram/session'), expect.any(Object))
  })

  it('fills empty profile name from telegram first_name', () => {
    const profile = enrichProfileWithTelegram(
      { id: 'tg-1', name: 'Клієнт POMICH', phone: '' },
      { chatId: '1', user: { id: 1, first_name: 'Виталий' } },
      'tg-1',
    )
    expect(profile.name).toBe('Виталий')
  })

  it('clearCustomerAuthStorage removes client name cache', () => {
    window.localStorage.setItem('pomichClientName', 'Roman')
    clearCustomerAuthStorage()
    expect(window.localStorage.getItem('pomichClientName')).toBeNull()
  })
})
