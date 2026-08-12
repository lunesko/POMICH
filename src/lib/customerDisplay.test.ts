import { describe, expect, it } from 'vitest'

import { formatCustomerCity, formatCustomerDisplayName } from './customerDisplay'

describe('customerDisplay', () => {
  it('prefers displayName from admin API', () => {
    expect(formatCustomerDisplayName({ id: 'guest-abc', name: 'enc:v1:foo', displayName: 'Олексій' })).toBe('Олексій')
  })

  it('formats guest sessions without encrypted blobs', () => {
    expect(formatCustomerDisplayName({ id: 'guest-d74b36e941e646d3', name: 'enc:v1:gAAAAA' })).toBe('Гість d74b36e9')
  })

  it('formats telegram clients', () => {
    expect(formatCustomerDisplayName({ id: 'tg-42', name: '', telegram: 'pomich_user' })).toBe('@pomich_user')
  })

  it('hides encrypted city values', () => {
    expect(formatCustomerCity('enc:v1:gAAAAA')).toBe('місто не вказано')
    expect(formatCustomerCity('Ужгород')).toBe('Ужгород')
  })
})
