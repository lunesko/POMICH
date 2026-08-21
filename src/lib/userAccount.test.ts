import { beforeEach, describe, expect, it } from 'vitest'

import type { CustomerProfile } from '../api/client'
import { enrichPartnerAccountStatus, hydrateClientFromPartner, isReturningClient, isReturningPartner, isStoredProfileNameMismatch, mergeAccountProfile, mergePreservedAccountStatus, buildRoleSwitchPreservedAccount, type UserAccountStatus } from './userAccount'

const baseStatus: UserAccountStatus = {
  customerId: 'guest-test',
  preferredRole: 'customer',
  linkedProviderId: '',
  rolesRegistered: [],
  clientRegistered: false,
  providerRegistered: false,
  needsOnboarding: true,
}

const completeProfile: CustomerProfile = {
  id: 'guest-test',
  name: 'Тест',
  phone: '+380671112233',
  verificationStatus: 'pending',
}

describe('userAccount helpers', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
  })
  it('treats stored profile with name and phone as returning client', () => {
    expect(isReturningClient({ ...baseStatus, profile: completeProfile })).toBe(true)
  })

  it('merges bootstrap profile when API account omits it', () => {
    const merged = mergeAccountProfile(baseStatus, completeProfile)
    expect(merged.profile?.name).toBe('Тест')
    expect(isReturningClient(merged)).toBe(true)
  })

  it('fills incomplete server profile from bootstrap storage', () => {
    const incompleteServerProfile: CustomerProfile = {
      id: 'guest-test',
      name: 'Клієнт POMICH',
      phone: '',
      verificationStatus: 'unverified',
    }
    const merged = mergeAccountProfile({ ...baseStatus, profile: incompleteServerProfile }, completeProfile)
    expect(merged.profile?.phone).toBe('+380671112233')
    expect(isReturningClient(merged)).toBe(true)
  })

  it('prefers server profile over bootstrap merge', () => {
    const serverProfile = { ...completeProfile, name: 'Сервер' }
    const merged = mergeAccountProfile({ ...baseStatus, profile: serverProfile }, completeProfile)
    expect(merged.profile?.name).toBe('Сервер')
  })

  it('detects stored profile name mismatch on web', () => {
    expect(isStoredProfileNameMismatch('Roman', 'Vitaliy')).toBe(true)
    expect(isStoredProfileNameMismatch('Vitaliy', 'Vitaliy')).toBe(false)
    expect(isStoredProfileNameMismatch('Клієнт POMICH', 'Vitaliy')).toBe(false)
    expect(isStoredProfileNameMismatch(undefined, 'Vitaliy')).toBe(false)
  })

  it('treats linked provider id as returning partner', () => {
    expect(isReturningPartner({ ...baseStatus, linkedProviderId: 'provider-guest-test' })).toBe(true)
  })

  it('merges preserved partner flags when API drops providerRegistered', () => {
    const preserved: UserAccountStatus = {
      ...baseStatus,
      clientRegistered: true,
      providerRegistered: true,
      linkedProviderId: 'provider-guest-test',
      rolesRegistered: ['customer', 'provider'],
      needsOnboarding: false,
    }
    const staleApi: UserAccountStatus = {
      ...baseStatus,
      clientRegistered: true,
      providerRegistered: false,
      linkedProviderId: '',
      rolesRegistered: ['customer'],
      needsOnboarding: true,
    }
    const merged = mergePreservedAccountStatus(staleApi, preserved)
    expect(merged.providerRegistered).toBe(true)
    expect(merged.linkedProviderId).toBe('provider-guest-test')
    expect(isReturningPartner(merged)).toBe(true)
    expect(enrichPartnerAccountStatus(merged).needsOnboarding).toBe(false)
  })

  it('hydrates client profile from partner so role switch skips re-registration', () => {
    const partnerOnly: UserAccountStatus = {
      ...baseStatus,
      preferredRole: 'provider',
      linkedProviderId: 'provider-guest-test',
      providerRegistered: true,
      rolesRegistered: ['provider'],
      needsOnboarding: false,
      profile: {
        id: 'guest-test',
        name: 'Партнер Іван',
        phone: '+380671112233',
        verificationStatus: 'verified',
      },
    }
    const hydrated = hydrateClientFromPartner(partnerOnly)
    expect(isReturningClient(hydrated)).toBe(true)
    expect(hydrated.clientRegistered).toBe(true)
    expect(hydrated.rolesRegistered).toContain('customer')
    expect(hydrated.profile?.name).toBe('Партнер Іван')
  })

  it('keeps preserved partner profile when API returns an empty shell', () => {
    const preserved: UserAccountStatus = {
      ...baseStatus,
      preferredRole: 'provider',
      providerRegistered: true,
      linkedProviderId: 'provider-guest-test',
      rolesRegistered: ['provider'],
      needsOnboarding: false,
      profile: {
        id: 'guest-test',
        name: 'Партнер Іван',
        phone: '+380671112233',
        verificationStatus: 'verified',
      },
    }
    const staleApi: UserAccountStatus = {
      ...baseStatus,
      preferredRole: 'customer',
      providerRegistered: false,
      linkedProviderId: '',
      rolesRegistered: [],
      needsOnboarding: true,
      profile: {
        id: 'guest-test',
        name: 'Клієнт POMICH',
        phone: '',
        verificationStatus: 'unverified',
      },
    }
    const merged = mergePreservedAccountStatus(staleApi, preserved)
    expect(merged.providerRegistered).toBe(true)
    expect(merged.profile?.phone).toBe('+380671112233')
    expect(isReturningClient(hydrateClientFromPartner(merged))).toBe(true)
  })

  it('buildRoleSwitchPreservedAccount hydrates client from provider cache when account is null', () => {
    window.sessionStorage.setItem('pomichLinkedProviderId', 'provider-guest-test')
    window.sessionStorage.setItem(
      'pomichProviderProfileCache:provider-guest-test',
      JSON.stringify({
        id: 'provider-guest-test',
        name: 'Віталій Партнер',
        phone: '+380661007434',
        city: 'Ужгород',
        status: 'offline',
        verificationStatus: 'verified',
        specialties: ['tow'],
        serviceRadiusKm: 15,
      }),
    )
    window.localStorage.setItem('pomichCustomerId', 'guest-vitaliy')
    window.sessionStorage.setItem('pomichCustomerId', 'guest-vitaliy')

    const preserved = buildRoleSwitchPreservedAccount(null, 'guest-vitaliy')
    expect(preserved.linkedProviderId).toBe('provider-guest-test')
    expect(isReturningPartner(preserved)).toBe(true)
    expect(isReturningClient(preserved)).toBe(true)
    expect(preserved.profile?.name).toBe('Віталій Партнер')
    expect(preserved.profile?.phone).toBe('+380661007434')
  })
})
