

export const defaultBaseUrl = '/api'

export const providerErrorMessages: Record<string, string> = {
  provider_credentials_invalid: 'Невірний логін або пароль партнера.',
  provider_token_invalid: 'Недійсний токен партнера.',
  provider_session_required: 'Потрібен вхід партнера.',
  provider_session_invalid: 'Сесію партнера не відкрито. Оновіть сторінку або увійдіть знову.',
  provider_session_expired: 'Сесія партнера закінчилась. Оновіть сторінку або увійдіть знову.',
  provider_session_missing: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  provider_not_linked: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_session_required: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_session_invalid: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_session_expired: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_session_missing: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  bearer_token_invalid: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  role_forbidden: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_identity_mismatch: 'Сесія застаріла. Закрийте та відкрийте застосунок знову.',
  provider_identity_mismatch: 'Акаунт партнера не збігається. Оновіть сторінку та спробуйте ще раз.',
  'provider verification must be approved before going online':
    'Підтвердіть телефон у Telegram, щоб вийти на лінію.',
  'provider profile must be registered before going online': 'Спочатку заповніть профіль партнера.',
  rate_limit_exceeded: 'Забагато спроб. Спробуйте через 10 хвилин.',
  send_cooldown: 'Код уже надіслано нещодавно. Зачекайте близько хвилини й спробуйте знову.',
  invalid_channel: 'Невірний канал підтвердження.',
  telegram_unavailable: 'Telegram недоступний. Спробуйте email.',
  telegram_not_linked:
    'Відкрийте @pomich_ua_bot або @pomich_help_bot, надішліть /start. Код прийде в той самий бот — це підтвердження телефону, не нова реєстрація.',
  email_missing: 'Введіть email для підтвердження.',
  invalid_phone: 'Невірний номер телефону.',
  customer_not_found: 'Акаунт з цим номером не знайдено. Зареєструйтеся або перевірте номер.',
  login_failed: 'Не вдалося увійти. Перевірте номер і код.',
  code_not_found: 'Код не знайдено. Надішліть новий.',
  code_expired: 'Код прострочено. Надішліть новий.',
  code_invalid: 'Невірний код. Перевірте та спробуйте ще раз.',
  invalid_code_format: 'Код має містити 6 цифр.',
  telegram_send_failed: 'Не вдалося надіслати код у Telegram. Спробуйте ще раз або напишіть /start у @pomich_ua_bot чи @pomich_help_bot.',
  phone_already_registered: 'Цей номер уже зареєстровано. Увійдіть за номером або використайте інший.',
  REVIEW_ALREADY_SUBMITTED: 'Оцінку вже збережено.',
  ORDER_NOT_COMPLETED: 'Оцінку можна залишити лише після завершення заявки.',
  REVIEW_FORBIDDEN: 'Немає доступу до оцінки цієї заявки.',
  ORDER_NOT_FOUND: 'Заявку не знайдено.',
  ORDER_NOT_ASSIGNED_TO_PROVIDER: 'Це замовлення призначене іншому партнеру. Оновіть сторінку.',
  ORDER_ACCEPTED_TIMEOUT: 'Час очікування підтвердження ціни вийшов — заявку скасовано.',
  OFFER_EXPIRED: 'Пропозиція вже завершилась. Очікуйте нову заявку.',
  OFFER_NOT_FOUND: 'Пропозицію не знайдено.',
  OFFER_DECLINED: 'Цю пропозицію вже пропущено.',
  PRICE_REQUIRED: 'Вкажіть вартість послуги в гривнях.',
  ORDER_ALREADY_ACCEPTED: 'Замовлення вже прийняв інший виконавець.',
  PROVIDER_NOT_VERIFIED: 'Підтвердіть телефон, щоб приймати заявки.',
  'Internal Server Error': 'Помилка сервера. Спробуйте ще раз через хвилину.',
  service_unavailable: 'Сервер тимчасово недоступний (оновлення). Спробуйте через хвилину.',
  profile_storage_unavailable: 'Профіль тимчасово недоступний. Спробуйте пізніше.',
}

export function formatOtpRetryWait(seconds: number, code?: string): string {
  const safe = Math.max(1, Math.floor(seconds))
  if (code === 'rate_limit_exceeded' || safe >= 60) {
    const mins = Math.max(1, Math.ceil(safe / 60))
    return `Забагато спроб. Спробуйте через ${mins} хв.`
  }
  return `Код уже надіслано. Зачекайте ${safe} с і спробуйте знову.`
}

export class ApiRequestError extends Error {
  cause?: unknown
  status: number
  code?: string
  retryAfterSeconds?: number

  constructor(message: string, options?: { cause?: unknown; status?: number; code?: string; retryAfterSeconds?: number }) {
    super(message)
    this.name = 'ApiRequestError'
    this.cause = options?.cause
    this.status = options?.status ?? 0
    this.code = options?.code
    this.retryAfterSeconds = options?.retryAfterSeconds
  }
}

export function messageForErrorCode(code: string, retryAfterSeconds?: number): string {
  if (typeof retryAfterSeconds === 'number' && (code === 'rate_limit_exceeded' || code === 'send_cooldown')) {
    return formatOtpRetryWait(retryAfterSeconds, code)
  }
  return providerErrorMessages[code] ?? code
}

export async function parseApiError(response: Response, fallback: string): Promise<string> {
  const parsed = await parseApiErrorDetails(response, fallback)
  return parsed.message
}

export async function parseApiErrorDetails(
  response: Response,
  fallback: string,
): Promise<{ message: string; code?: string; retryAfterSeconds?: number }> {
  try {
    const body = await response.json()
    const detail = body?.detail
    if (typeof detail === 'string') {
      return { message: messageForErrorCode(detail), code: detail }
    }
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const code = typeof detail.code === 'string' ? detail.code : undefined
      const retryAfterSeconds =
        typeof detail.retryAfterSeconds === 'number'
          ? detail.retryAfterSeconds
          : typeof detail.retry_after_seconds === 'number'
            ? detail.retry_after_seconds
            : undefined
      if (code) {
        return {
          message: messageForErrorCode(code, retryAfterSeconds),
          code,
          retryAfterSeconds,
        }
      }
      if (typeof detail.message === 'string') {
        return { message: detail.message, retryAfterSeconds }
      }
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0]
      if (typeof first === 'string') {
        return { message: messageForErrorCode(first), code: first }
      }
      if (first && typeof first === 'object') {
        const msg = typeof first.msg === 'string' ? first.msg : typeof first.message === 'string' ? first.message : null
        if (msg) return { message: msg }
      }
    }
  } catch {
    // Response body is not JSON.
  }
  if (response.status === 429) {
    return { message: providerErrorMessages.send_cooldown, code: 'send_cooldown' }
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return { message: providerErrorMessages.service_unavailable, code: 'service_unavailable' }
  }
  if (response.status >= 500) {
    return { message: providerErrorMessages['Internal Server Error'], code: 'Internal Server Error' }
  }
  return { message: fallback }
}

export const FETCH_NETWORK_ERROR_UA = "Не вдалося з'єднатися з сервером. Спробуйте ще раз."

export const FETCH_TIMEOUT_ERROR_UA = 'Запит перевищив час очікування. Спробуйте ще раз.'

export const DEFAULT_API_TIMEOUT_MS = 25_000

export function messageFromFetchError(error: unknown, fallback = FETCH_NETWORK_ERROR_UA): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail?: unknown }).detail
    if (typeof detail === 'string' && providerErrorMessages[detail]) {
      return providerErrorMessages[detail]
    }
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError' || /aborted|timeout|timed out/i.test(error.message)) {
      return FETCH_TIMEOUT_ERROR_UA
    }
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return FETCH_NETWORK_ERROR_UA
    }
    if (providerErrorMessages[error.message]) {
      return providerErrorMessages[error.message]
    }
    return error.message
  }
  return fallback
}

export async function fetchApi(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const upstreamSignal = init?.signal
  const onUpstreamAbort = () => controller.abort(upstreamSignal?.reason)
  upstreamSignal?.addEventListener('abort', onUpstreamAbort, { once: true })
  if (upstreamSignal?.aborted) onUpstreamAbort()
  let timedOut = false
  const timeoutId = window.setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('timeout', 'AbortError'))
  }, timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    throw new ApiRequestError(timedOut ? FETCH_TIMEOUT_ERROR_UA : messageFromFetchError(error), {
      cause: error,
      code: timedOut ? 'request_timeout' : upstreamSignal?.aborted ? 'request_aborted' : 'network_error',
    })
  } finally {
    window.clearTimeout(timeoutId)
    upstreamSignal?.removeEventListener('abort', onUpstreamAbort)
  }
}

export function getBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || defaultBaseUrl
}

export function authHeaders(token: string | undefined): Record<string, string> | undefined {
  if (!token) return undefined
  return token.startsWith('pomich_auth_v1.') ? { Authorization: `Bearer ${token}` } : undefined
}

export function adminHeaders(adminToken?: string) {
  return authHeaders(adminToken)
}

export function providerHeaders(providerToken?: string) {
  return authHeaders(providerToken)
}

export function providerJsonHeaders(providerToken?: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(providerHeaders(providerToken) ?? {}) }
}
