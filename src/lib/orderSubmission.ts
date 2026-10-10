const storageKey = 'pomich.order-submission.v1'
type Submission = { fingerprint: string; key: string; expires: number }
let pending: Submission | undefined

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

// Persist only a digest and a random request key, never contact details or auth proofs.
export async function orderSubmissionKey(payload: Record<string, unknown>): Promise<string> {
  const data = { ...payload }
  for (const field of ['telegramInitData', 'telegramUsername', 'telegramFirstName', 'telegramUserId', 'chatId']) delete data[field]
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(data))))
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  try {
    const stored = sessionStorage.getItem(storageKey)
    if (stored) pending = JSON.parse(stored) as Submission
  } catch { /* In-memory retries still work when storage is unavailable. */ }
  if (!pending || pending.fingerprint !== fingerprint || pending.expires <= Date.now()) {
    pending = { fingerprint, key: crypto.randomUUID(), expires: Date.now() + 23 * 60 * 60 * 1000 }
    try { sessionStorage.setItem(storageKey, JSON.stringify(pending)) } catch { /* optional persistence */ }
  }
  return pending.key
}

export function completeOrderSubmission(key: string): void {
  if (pending?.key !== key) return
  pending = undefined
  try { sessionStorage.removeItem(storageKey) } catch { /* optional persistence */ }
}
