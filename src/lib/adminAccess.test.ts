import { beforeEach, describe, expect, it } from 'vitest'

import { ADMIN_HASH, applyHiddenAdminEntry, isAdminEntryLocation, isHiddenAdminHash } from './adminAccess'

describe('adminAccess', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
  })

  it('detects the hidden admin hash', () => {
    window.location.hash = ADMIN_HASH
    expect(isHiddenAdminHash()).toBe(true)
    expect(isAdminEntryLocation()).toBe(true)
  })

  it('detects ?role=admin without hash', () => {
    window.history.pushState({}, '', '/?role=admin')
    expect(isHiddenAdminHash()).toBe(false)
    expect(isAdminEntryLocation()).toBe(true)
  })

  it('replaces #admin with ?role=admin', () => {
    window.location.hash = ADMIN_HASH
    applyHiddenAdminEntry()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('?role=admin')
    expect(window.location.hash).toBe('')
  })
})
