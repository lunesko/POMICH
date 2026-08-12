import { beforeEach, describe, expect, it } from 'vitest'

import {
  authSessionStorageKey,
  clearAllAuthStorage,
  clearCustomerAuthStorage,
  clearExplicitLogout,
  guestSessionCustomerIdForRestore,
  isExplicitLogout,
  markExplicitLogout,
  purgeStaleCustomerSessions,
  readStoredCustomerAuthSession,
  storeAuthSession,
} from './auth'

describe('customer auth storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('prefers telegram customer id over stale web guest token', () => {
    storeAuthSession(authSessionStorageKey('customer', 'guest-roman'), {
      role: 'customer',
      subjectId: 'guest-roman',
      customerId: 'guest-roman',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.roman',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    window.localStorage.setItem('pomichCustomerId', 'guest-roman')

    storeAuthSession(authSessionStorageKey('customer', 'tg-42'), {
      role: 'customer',
      subjectId: 'tg-42',
      customerId: 'tg-42',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.vitaliy',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })

    const restored = readStoredCustomerAuthSession({ telegramChatId: '42' })

    expect(restored).toEqual({ customerId: 'tg-42', token: 'pomich_auth_v1.vitaliy' })
  })

  it('does not restore orphan session without persisted customer id', () => {
    window.sessionStorage.setItem(
      authSessionStorageKey('customer', 'guest-roman'),
      JSON.stringify({
        role: 'customer',
        subjectId: 'guest-roman',
        customerId: 'guest-roman',
        accessToken: 'pomich_auth_v1.roman',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }),
    )

    expect(readStoredCustomerAuthSession()).toBeUndefined()
  })

  it('does not reuse shared customer-web singleton for guest restore', () => {
    expect(guestSessionCustomerIdForRestore('customer-web')).toBeUndefined()
    expect(guestSessionCustomerIdForRestore('guest-abc123')).toBe('guest-abc123')
  })

  it('purges stale sessions for active customer', () => {
    storeAuthSession(authSessionStorageKey('customer', 'guest-roman'), {
      role: 'customer',
      subjectId: 'guest-roman',
      customerId: 'guest-roman',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.roman',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    storeAuthSession(authSessionStorageKey('customer', 'tg-42'), {
      role: 'customer',
      subjectId: 'tg-42',
      customerId: 'tg-42',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.vitaliy',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    window.localStorage.setItem('pomichCustomerId', 'guest-roman')

    purgeStaleCustomerSessions('tg-42')

    expect(window.localStorage.getItem('pomichCustomerId')).toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-roman'))).toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'tg-42'))).not.toBeNull()
  })

  it('clears all customer auth storage on role switch', () => {
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.test',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichBootstrapProfile', '{"name":"Test"}')

    clearCustomerAuthStorage()

    expect(window.localStorage.getItem('pomichCustomerId')).toBeNull()
    expect(window.sessionStorage.getItem('pomichBootstrapProfile')).toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-test'))).toBeNull()
  })

  it('preserves explicit logout flag across clearAllAuthStorage', () => {
    markExplicitLogout('829741830')
    clearAllAuthStorage()
    expect(isExplicitLogout('829741830')).toBe(true)
    clearExplicitLogout()
    expect(isExplicitLogout('829741830')).toBe(false)
  })

  it('clears provider and admin tokens on full logout', () => {
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.test',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    storeAuthSession(authSessionStorageKey('provider', 'provider-test'), {
      role: 'provider',
      subjectId: 'provider-test',
      providerId: 'provider-test',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.provider',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    window.sessionStorage.setItem('pomichProviderToken', 'legacy-provider')
    window.sessionStorage.setItem('pomichAdminToken', 'legacy-admin')
    window.localStorage.setItem('pomichCustomerId', 'guest-test')

    clearAllAuthStorage()

    expect(window.localStorage.getItem('pomichCustomerId')).toBeNull()
    expect(window.sessionStorage.getItem('pomichProviderToken')).toBeNull()
    expect(window.sessionStorage.getItem('pomichAdminToken')).toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-test'))).toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('provider', 'provider-test'))).toBeNull()
  })
})
