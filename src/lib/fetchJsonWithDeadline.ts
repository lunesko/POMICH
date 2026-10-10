/** Bounds both the response headers and body; works in browsers without AbortSignal.timeout. */
export async function fetchJsonWithDeadline<T>(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json() as T
  } finally {
    clearTimeout(timer)
  }
}
