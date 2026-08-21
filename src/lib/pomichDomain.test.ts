import { describe, expect, it } from 'vitest'

import {
  calculateDistanceKm,
  calculatePrice,
  getStateTransition,
  sanitizeLocation,
  validateCustomerOrderInput,
  buildOrderFingerprint,
} from './pomichDomain'

describe('pomichDomain', () => {
  it('calculates a realistic distance and price for a tow request', () => {
    const distanceKm = calculateDistanceKm({ lat: 48.6208, lng: 22.2879 }, { lat: 48.6175, lng: 22.3056 })

    expect(distanceKm).toBeGreaterThan(0)
    expect(distanceKm).toBeLessThan(5)

    const result = calculatePrice('tow', distanceKm)
    expect(result.price).toBeGreaterThan(1000)
    expect(result.etaMinutes).toBeGreaterThan(0)
  })

  it('rejects invalid customer order input', () => {
    const invalid = validateCustomerOrderInput({
      service: 'tow',
      customerLocation: '',
      destination: '',
      distanceKm: 0,
    })

    expect(invalid).toEqual(
      expect.arrayContaining(['customerLocation', 'destination', 'distanceKm'])
    )
  })

  it('does not require destination for on-site services', () => {
    const valid = validateCustomerOrderInput({
      service: 'battery',
      customerLocation: 'вул. Собранецька, Ужгород',
      destination: '',
      distanceKm: 0.5,
    })

    expect(valid).not.toContain('destination')
    expect(valid).toEqual([])
  })

  it('still requires destination for tow', () => {
    const invalid = validateCustomerOrderInput({
      service: 'tow',
      customerLocation: 'вул. Собранецька, Ужгород',
      destination: '',
      distanceKm: 2.4,
    })

    expect(invalid).toEqual(['destination'])
  })

  it('prevents a partner from accepting an order twice in the same state', () => {
    const transition = getStateTransition('assigned', 'accept')
    expect(transition).toBe('assigned')

    const completedTransition = getStateTransition('tracking', 'complete')
    expect(completedTransition).toBe('completed')
  })

  it('masks locations for privacy before displaying them', () => {
    expect(sanitizeLocation('вул. Собранецька, 12/3, Ужгород')).toMatch(/Ужгород/)
    expect(sanitizeLocation('вул. Собранецька, 12/3, Ужгород')).not.toContain('12/3')
    expect(sanitizeLocation('12, Срібляста вулиця, Червениця')).toBe('Срібляста вулиця, Червениця')
    expect(sanitizeLocation('12, Срібляста вулиця, Червениця')).not.toMatch(/^,/)
  })

  it('builds a stable fingerprint for duplicate-request protection', () => {
    const first = buildOrderFingerprint('tow', 'customer-1', 'partner-1')
    const second = buildOrderFingerprint('tow', 'customer-1', 'partner-1')

    expect(first).toBe(second)
  })
})
