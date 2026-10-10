import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('customer browser creates an order and observes real provider lifecycle', async ({ page, context }) => {
  const seed = JSON.parse(readFileSync('test-results/e2e-session.json', 'utf8'))
  await context.addCookies([{ name: 'pomich_customer_session', value: seed.cookie,
    domain: '127.0.0.1', path: '/api/auth/browser/', httpOnly: true, sameSite: 'Lax' }])
  await page.addInitScript(customerId => {
    localStorage.setItem('pomichCustomerId', customerId)
    localStorage.setItem('pomichActiveAppRole', 'customer')
    sessionStorage.setItem(`pomichDraft:${customerId}`, JSON.stringify({ savedAt: Date.now(),
      screen: 'review', selectedService: 'battery', addressLabel: 'Uzhhorod, test location',
      pickup: { lat: 48.6208, lng: 22.2879 },
      serviceDetails: { version: 1, service: 'battery', answers: { symptom: 'unknown', help: 'unknown' } },
    }))
  }, seed.customer.subjectId)
  // No route interception: browser, HTTP auth, application and PostgreSQL are real.
  await page.goto('/?role=customer')
  const created = page.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'POST')
  await page.getByRole('button', { name: /Надіслати заявку|Викликати допомогу|Підтвердити виклик/ }).last().click()
  const response = await created
  expect(response.status()).toBe(201)
  const order = await response.json()
  const api = async (path: string, token: string, method = 'GET', body?: unknown) => page.evaluate(async ({ path, token, method, body }) => {
    const result = await fetch('/api' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: result.status, data: await result.json() }
  }, { path, token, method, body })
  const providerId = seed.provider.subjectId
  const offers = await api(`/providers/${providerId}/offers`, seed.provider.accessToken)
  expect(offers.status).toBe(200)
  const offer = offers.data.find((item: { orderId: string }) => item.orderId === order.id)
  expect(offer).toBeTruthy()
  expect((await api(`/providers/${providerId}/offers/${offer.id}/accept`, seed.provider.accessToken, 'POST', { proposedPrice: 700 })).status).toBe(200)
  await expect(page.getByText(/700/).first()).toBeVisible({ timeout: 30_000 })
  const confirmation = page.waitForResponse(response => response.url().endsWith(`/orders/${order.id}/confirm-price`))
  await page.getByRole('button', { name: /Підтвердити ціну/ }).click()
  expect((await confirmation).status()).toBe(200)
  for (const status of ['en_route', 'arrived', 'in_progress', 'completed']) {
    const transition = await api(`/providers/${providerId}/orders/${order.id}/status`, seed.provider.accessToken, 'PATCH', { status })
    expect(transition.status, `${status}: ${JSON.stringify(transition.data)}`).toBe(200)
  }
  await expect(page.getByText(/Заявку завершено|Допомогу надано|Завершено/).first()).toBeVisible({ timeout: 30_000 })
  const stored = await api(`/orders/${order.id}`, seed.customer.accessToken)
  expect(stored.data.status).toBe('completed')
  expect(stored.data.statusHistory.map((item: { status: string }) => item.status)).toContain('price_confirmed')
  const another = await api('/orders', seed.customer.accessToken, 'POST', {
    service: 'battery', customerCoordinates: { lat: 48.6208, lng: 22.2879 },
    serviceDetails: { version: 1, service: 'battery', answers: { symptom: 'unknown', help: 'unknown' } },
  })
  expect(another.status).toBe(201)
  await page.evaluate(orderId => localStorage.setItem('pomichActiveOrder', JSON.stringify({ orderId, status: 'searching', updatedAt: Date.now() })), another.data.id)
  await page.reload()
  await page.getByRole('button', { name: 'Скасувати заявку', exact: true }).click()
  const cancelled = page.waitForResponse(response => response.url().endsWith(`/orders/${another.data.id}/cancel`))
  await page.getByRole('alertdialog').getByRole('button', { name: 'Скасувати заявку', exact: true }).click()
  expect((await cancelled).status()).toBe(200)
  expect((await api(`/orders/${another.data.id}`, seed.customer.accessToken)).data.status).toBe('cancelled')
})
