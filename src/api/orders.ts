import { parseApiError, parseApiErrorDetails, fetchApi, getBaseUrl, authHeaders, adminHeaders } from "./transport"
import type { OrderResponse } from "./types"

export async function createOrder(payload: Record<string, unknown>, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Order request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function getOrder(orderId: string, accessToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    cache: 'no-store',
    headers: authHeaders(accessToken) ?? {},
  })

  if (!response.ok) {
    const parsed = await parseApiErrorDetails(response, 'Не вдалося завантажити замовлення.')
    throw Object.assign(new Error(parsed.message), { status: response.status, detail: parsed.code || parsed.message })
  }

  return response.json() as Promise<OrderResponse>
}

export async function getCustomerOrders(customerId: string, customerToken?: string, limit = 50) {
  const response = await fetch(
    `${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/orders?limit=${encodeURIComponent(String(limit))}`,
    {
      cache: 'no-store',
      headers: authHeaders(customerToken) ?? {},
    },
  )

  if (!response.ok) {
    throw new Error(await parseApiError(response, `Customer orders failed with ${response.status}`))
  }

  return response.json() as Promise<OrderResponse[]>
}

export async function submitOrderReview(
  orderId: string,
  payload: { role: 'customer' | 'partner'; rating: number; comment?: string; authorId?: string; providerId?: string },
  token?: string,
) {
  const response = await fetchApi(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeaders(token) ?? {}),
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const parsed = await parseApiErrorDetails(response, 'Не вдалося зберегти оцінку. Спробуйте ще раз.')
    throw Object.assign(new Error(parsed.message), { status: response.status, detail: parsed.code || parsed.message })
  }

  return response.json() as Promise<OrderResponse>
}

export async function cancelOrder(orderId: string, authToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: authHeaders(authToken) ?? {},
  })

  if (!response.ok) {
    throw new Error(`Order cancel request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function confirmOrderPrice(orderId: string, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/confirm-price`, {
    method: 'POST',
    headers: authHeaders(customerToken) ?? {},
  })

  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw Object.assign(new Error(`Order price confirm failed with ${response.status}`), { status: response.status, detail: error?.detail })
  }

  return response.json() as Promise<OrderResponse>
}

export async function retryDispatch(orderId: string, authToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/dispatch/retry`, {
    method: 'POST',
    headers: authHeaders(authToken) ?? {},
  })

  if (!response.ok) {
    throw new Error(`Dispatch retry request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function updateOrderStatus(orderId: string, status: string, adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(adminHeaders(adminToken) ?? {}) },
    body: JSON.stringify({ status }),
  })

  if (!response.ok) {
    throw new Error(`Order status request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}
