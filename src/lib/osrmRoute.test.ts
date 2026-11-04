import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOsrmRoute } from './osrmRoute'

afterEach(() => vi.unstubAllGlobals())

describe('server routing contract', () => {
  it('keeps coordinates in a same-origin POST body and accepts road data', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ source: 'osrm',
      coordinates: [[48.62, 22.28], [48.63, 22.29]], distanceMeters: 2000, durationSeconds: 300 }) }))
    vi.stubGlobal('fetch', fetch)
    const result = await fetchOsrmRoute({ lat: 48.62, lng: 22.28 }, { lat: 48.63, lng: 22.29 })
    expect(fetch.mock.calls[0][0]).toBe('/api/routing/route')
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({
      fromPoint: { lat: 48.62, lng: 22.28 }, toPoint: { lat: 48.63, lng: 22.29 } }) })
    expect(result?.durationSeconds).toBe(300)
  })
  it('returns no road geometry when routing is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ source: 'unavailable', coordinates: [] }) })))
    expect(await fetchOsrmRoute({ lat: 48, lng: 22 }, { lat: 49, lng: 23 })).toBeNull()
  })
})
