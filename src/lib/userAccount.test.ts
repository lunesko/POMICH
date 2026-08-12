import { describe, expect, it } from 'vitest'

import type { CustomerProfile } from '../api/client'
import { isReturningClient, isStoredProfileNameMismatch, mergeAccountProfile, type UserAccountStatus } from './userAccount'

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
})
