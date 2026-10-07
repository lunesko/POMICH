import { providerErrorMessages, ApiRequestError, parseApiError, parseApiErrorDetails, fetchApi, getBaseUrl, authHeaders, adminHeaders, providerHeaders, providerJsonHeaders } from "./transport"
import type { OrderResponse, ProviderStatus, DispatchOffer, ProviderAvailability, ProviderPublicProfile } from "./types"

export async function getProviderOrders(providerId: string, providerToken?: string, limit = 50) {
  const response = await fetch(
    `${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/orders?limit=${encodeURIComponent(String(limit))}`,
    {
      cache: 'no-store',
      headers: authHeaders(providerToken) ?? {},
    },
  )

  if (!response.ok) {
    throw new Error(await parseApiError(response, `Provider orders failed with ${response.status}`))
  }

  return response.json() as Promise<OrderResponse[]>
}

export async function getProviderProfile(providerId: string, providerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/profile`, {
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    throw new ApiRequestError(await parseApiError(response, `Provider profile request failed with ${response.status}`), {
      status: response.status,
    })
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function getProviderPublicProfile(providerId: string, limit = 20, signal?: AbortSignal) {
  const response = await fetch(
    `${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/public?limit=${encodeURIComponent(String(limit))}`,
    signal ? { signal } : undefined,
  )

  if (!response.ok) {
    throw new Error(await parseApiError(response, `Provider public profile failed with ${response.status}`))
  }

  return response.json() as Promise<ProviderPublicProfile>
}

export async function reviewProviderVerification(providerId: string, payload: { status: 'verified' | 'rejected'; reviewNote?: string }, adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/verification/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(adminHeaders(adminToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Provider verification review failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function getProviderOffers(providerId: string, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/offers`, {
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    throw new Error(`Provider offers request failed with ${response.status}`)
  }

  return response.json() as Promise<DispatchOffer[]>
}

export async function acceptProviderOffer(
  providerId: string,
  offerId: string,
  providerToken?: string,
  payload?: { proposedPrice: number; priceNote?: string },
) {
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/offers/${encodeURIComponent(offerId)}/accept`, {
    method: 'POST',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify({
      proposedPrice: payload?.proposedPrice,
      priceNote: payload?.priceNote,
    }),
  })

  if (!response.ok) {
    const parsed = await parseApiErrorDetails(response, 'Не вдалося прийняти заявку.')
    throw Object.assign(new Error(parsed.message), { status: response.status, detail: parsed.code ? { code: parsed.code, message: parsed.message } : parsed.message })
  }

  return response.json() as Promise<{ offer: DispatchOffer; order: OrderResponse; provider: ProviderAvailability }>
}

export async function declineProviderOffer(providerId: string, offerId: string, providerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/offers/${encodeURIComponent(offerId)}/decline`, {
    method: 'POST',
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    const parsed = await parseApiErrorDetails(response, 'Не вдалося пропустити заявку.')
    throw Object.assign(new Error(parsed.message), { status: response.status, detail: parsed.code ? { code: parsed.code, message: parsed.message } : parsed.message })
  }

  return response.json() as Promise<DispatchOffer>
}

export async function updateProviderPresence(providerId: string, payload: { status: ProviderStatus; location?: { lat: number; lng: number }; etaMinutes?: number }, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/presence`, {
    method: 'PATCH',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let detail: string | undefined
    try {
      const error = await response.json()
      detail = typeof error?.detail === 'string' ? error.detail : undefined
    } catch {
      detail = undefined
    }
    const message =
      (detail && providerErrorMessages[detail]) ||
      (detail && /[А-Яа-яІіЇїЄєҐґ]/.test(detail) ? detail : undefined) ||
      "Не вдалося оновити статус. Перевірте з'єднання."
    throw Object.assign(new Error(message), { status: response.status, detail })
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function updateProviderOrderStatus(providerId: string, orderId: string, status: string, providerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify({ status }),
  })

  if (!response.ok) {
    const parsed = await parseApiErrorDetails(response, "Не вдалося оновити статус замовлення. Спробуйте ще раз.")
    const message =
      (parsed.message && parsed.message.startsWith('invalid order status transition')
        ? 'Цей статус уже змінено. Оновіть сторінку.'
        : undefined) ||
      parsed.message ||
      "Не вдалося оновити статус замовлення. Спробуйте ще раз."
    throw Object.assign(new Error(message), { status: response.status, detail: parsed.code || parsed.message })
  }

  return response.json() as Promise<OrderResponse>
}

export async function updateProviderProfile(providerId: string, payload: {
  name: string
  phone: string
  telegram?: string
  vehicle: string
  vehicleMake?: string
  vehicleModel?: string
  plate?: string
  city?: string
  specialties: string[]
  serviceRadiusKm: number
  location?: { lat: number; lng: number }
}, providerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/profile`, {
    method: 'PATCH',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const details = await parseApiErrorDetails(response, "Не вдалося зберегти профіль партнера.")
    throw new ApiRequestError(details.message, {
      status: response.status,
      code: details.code,
    })
  }

  return response.json() as Promise<ProviderAvailability>
}
