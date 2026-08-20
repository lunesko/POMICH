import { beforeEach, describe, expect, it } from 'vitest'

import {
  authSessionStorageKey,
  clearAllAuthStorage,
  clearCustomerAuthStorage,
  clearExplicitLogout,
  clearProviderAuthStorage,
  dismissSessionMismatchNotice,
  guestSessionCustomerIdForRestore,
  isExplicitLogout,
  markExplicitLogout,
  markSessionMismatchNotice,
  purgeStaleCustomerSessions,
  readAuthSessionSubject,
  readStoredCustomerAuthSession,
  resolveSessionMismatchWarning,
  SESSION_MISMATCH_DISMISS_KEY,
  SESSION_MISMATCH_NOTICE_KEY,
  storeAuthSession,
  TELEGRAM_STALE_WEB_MISMATCH_MESSAGE,
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

  it('clears customer auth storage', () => {
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

  it('clears provider sessions on role switch without wiping customer identity', () => {
    storeAuthSession(authSessionStorageKey('customer', 'guest-test'), {
      role: 'customer',
      subjectId: 'guest-test',
      customerId: 'guest-test',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.test',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    storeAuthSession(authSessionStorageKey('provider', 'provider-guest-test'), {
      role: 'provider',
      subjectId: 'provider-guest-test',
      providerId: 'provider-guest-test',
      tokenType: 'Bearer',
      accessToken: 'pomich_auth_v1.provider',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    window.localStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-test')
    window.sessionStorage.setItem('pomichLinkedProviderId', 'provider-guest-test')
    window.sessionStorage.setItem('pomichProviderToken', 'legacy-provider')
    window.sessionStorage.setItem('pomichAdminToken', 'legacy-admin')

    clearProviderAuthStorage({ includeAdmin: true })

    expect(window.localStorage.getItem('pomichCustomerId')).toBe('guest-test')
    expect(window.sessionStorage.getItem('pomichCustomerId')).toBe('guest-test')
    expect(window.sessionStorage.getItem('pomichLinkedProviderId')).toBe('provider-guest-test')
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-test'))).not.toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('provider', 'provider-guest-test'))).toBeNull()
    expect(window.sessionStorage.getItem('pomichProviderToken')).toBeNull()
    expect(window.sessionStorage.getItem('pomichAdminToken')).toBeNull()
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
    window.localStorage.setItem('pomichPartnerRegistered:provider-test', '1')
    window.localStorage.setItem('pomichPartnerRegistered:provider-guest-test', '1')

    clearAllAuthStorage()

    expect(window.localStorage.getItem('pomichCustomerId')).toBeNull()
    expect(window.localStorage.getItem('pomichPartnerRegistered:provider-test')).toBeNull()
    expect(window.localStorage.getItem('pomichPartnerRegistered:provider-guest-test')).toBeNull()
    expect(window.sessionStorage.getItem('pomichProviderToken')).toBeNull()
    expect(window.sessionStorage.getItem('pomichAdminToken')).toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('customer', 'guest-test'))).toBeNull()
    expect(window.sessionStorage.getItem(authSessionStorageKey('provider', 'provider-test'))).toBeNull()
  })

  it('does not warn on plain web session after login', () => {
    expect(resolveSessionMismatchWarning('guest-vitaliy')).toBeUndefined()
  })

  it('warns only for telegram stale-web conflict and clears on logout', () => {
    window.localStorage.setItem('pomichCustomerId', 'guest-roman')
    expect(resolveSessionMismatchWarning('tg-42', '42')).toBe(TELEGRAM_STALE_WEB_MISMATCH_MESSAGE)

    markSessionMismatchNotice('telegram-stale-web')
    window.localStorage.removeItem('pomichCustomerId')
    expect(resolveSessionMismatchWarning('tg-42', '42')).toBe(TELEGRAM_STALE_WEB_MISMATCH_MESSAGE)

    dismissSessionMismatchNotice('tg-42')
    expect(window.localStorage.getItem(SESSION_MISMATCH_DISMISS_KEY)).toBe('tg-42')
    expect(resolveSessionMismatchWarning('tg-42', '42')).toBeUndefined()

    clearAllAuthStorage()
    expect(window.localStorage.getItem(SESSION_MISMATCH_DISMISS_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(SESSION_MISMATCH_NOTICE_KEY)).toBeNull()
  })
})

describe('readAuthSessionSubject', () => {
  it('reads sub from pomich_auth_v1 token body', () => {
    const body = btoa(JSON.stringify({ role: 'provider', sub: 'provider-tg-829741830', exp: 9999999999 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    const token = `pomich_auth_v1.${body}.fakesig`
    expect(readAuthSessionSubject(token)).toBe('provider-tg-829741830')
  })

  it('returns undefined for non-session tokens', () => {
    expect(readAuthSessionSubject('partner-secret')).toBeUndefined()
    expect(readAuthSessionSubject(undefined)).toBeUndefined()
  })
})
