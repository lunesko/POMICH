import { ApiRequestError, parseApiError, parseApiErrorDetails, FETCH_NETWORK_ERROR_UA, fetchApi, getBaseUrl, authHeaders } from "./transport"
import type { AuthSession, UserAccountStatus, CustomerProfile, CustomerVerifySendResponse, CustomerVerifyConfirmResponse } from "./types"

export async function getCustomerProfile(customerId: string, customerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/profile`, {
    headers: authHeaders(customerToken),
  })

  if (!response.ok) {
    throw new Error(`Customer profile request failed with ${response.status}`)
  }

  return response.json() as Promise<CustomerProfile>
}

export async function updateCustomerProfile(customerId: string, payload: Partial<CustomerProfile>, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, "Не вдалося зберегти профіль. Спробуйте ще раз."))
  }

  return response.json() as Promise<CustomerProfile>
}

export async function sendCustomerVerificationCode(
  payload: { channel: 'telegram' | 'email'; phone?: string; email?: string; telegramBotKind?: 'customer' | 'provider' },
  customerToken?: string,
) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/verify/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const details = await parseApiErrorDetails(response, 'Не вдалося надіслати код підтвердження.')
    throw new ApiRequestError(details.message, {
      status: response.status,
      code: details.code,
      retryAfterSeconds: details.retryAfterSeconds,
    })
  }

  return response.json() as Promise<CustomerVerifySendResponse>
}

export async function confirmCustomerVerificationCode(payload: { code: string }, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/verify/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Не вдалося підтвердити код.'))
  }

  return response.json() as Promise<CustomerVerifyConfirmResponse>
}

export async function sendCustomerPhoneLoginCode(phone: string) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/phone/login/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })

  if (!response.ok) {
    const details = await parseApiErrorDetails(response, 'Не вдалося надіслати код для входу.')
    throw new ApiRequestError(details.message, {
      status: response.status,
      code: details.code,
      retryAfterSeconds: details.retryAfterSeconds,
    })
  }

  return response.json() as Promise<CustomerVerifySendResponse>
}

export async function confirmCustomerPhoneLoginCode(payload: { phone: string; code: string }) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/phone/login/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Не вдалося увійти за кодом.'))
  }

  return response.json() as Promise<AuthSession>
}

export async function getUserAccount(customerId: string, customerToken?: string, initData?: string) {
  const headers: Record<string, string> = { ...(authHeaders(customerToken) ?? {}) }
  if (initData) headers['X-Telegram-Init-Data'] = initData

  const response = await fetchApi(`${getBaseUrl()}/users/${encodeURIComponent(customerId)}/account`, { headers })

  if (!response.ok) {
    throw new Error(await parseApiError(response, FETCH_NETWORK_ERROR_UA))
  }

  return response.json() as Promise<UserAccountStatus>
}

export async function setUserPreferredRole(customerId: string, role: 'customer' | 'provider', customerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/users/${encodeURIComponent(customerId)}/account/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify({ role }),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, "Не вдалося обрати роль. Спробуйте ще раз."))
  }

  return response.json() as Promise<UserAccountStatus>
}
