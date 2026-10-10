import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
})

describe('order submission retries', () => {
  it('keeps the key across retries and reloads without storing private data', async () => {
    const first = await import('./orderSubmission')
    const payload = { customerId: 'guest-a', phone: 'private-phone', service: 'tow' }
    const key = await first.orderSubmissionKey(payload)
    expect(await first.orderSubmissionKey({ ...payload, telegramInitData: 'new-proof' })).toBe(key)
    vi.resetModules()
    const reloaded = await import('./orderSubmission')
    expect(await reloaded.orderSubmissionKey(payload)).toBe(key)
    expect(sessionStorage.getItem('pomich.order-submission.v1')).not.toContain('private-phone')
    reloaded.completeOrderSubmission(key)
    expect(await reloaded.orderSubmissionKey(payload)).not.toBe(key)
  })

  it('separates changed requests and customers', async () => {
    const { orderSubmissionKey } = await import('./orderSubmission')
    const key = await orderSubmissionKey({ customerId: 'a', service: 'tow' })
    expect(await orderSubmissionKey({ customerId: 'a', service: 'battery' })).not.toBe(key)
    expect(await orderSubmissionKey({ customerId: 'b', service: 'tow' })).not.toBe(key)
  })
})
