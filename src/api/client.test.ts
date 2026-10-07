import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, fetchApi, FETCH_NETWORK_ERROR_UA, FETCH_TIMEOUT_ERROR_UA } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('API transport errors', () => {
  it('keeps the original network error as cause', async () => {
    const cause = new TypeError('Failed to fetch')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause))
    const error = await fetchApi('/api/health').catch(e => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ cause, code: 'network_error', status: 0, message: FETCH_NETWORK_ERROR_UA })
  })

  it('distinguishes timeout from network errors', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })))
    const pending = fetchApi('/api/health', undefined, 20).catch(e => e)
    await vi.advanceTimersByTimeAsync(20)
    expect(await pending).toMatchObject({ code: 'request_timeout', message: FETCH_TIMEOUT_ERROR_UA })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes an already aborted caller signal to fetch', async () => {
    const controller = new AbortController()
    const cause = new DOMException('Aborted by caller', 'AbortError')
    controller.abort(cause)
    vi.stubGlobal('fetch', vi.fn((_input, init) => {
      expect(init.signal.aborted).toBe(true)
      return Promise.reject(init.signal.reason)
    }))
    expect(await fetchApi('/api/health', { signal: controller.signal }).catch(e => e))
      .toMatchObject({ cause, code: 'request_aborted' })
  })

  it('preserves HTTP status and headers for endpoint handlers', async () => {
    const response = new Response('{"detail":"service_unavailable"}', { status: 503, headers: { 'Retry-After': '5' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    expect(await fetchApi('/api/health')).toBe(response)
  })
})
