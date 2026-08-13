/** SSE helpers with reconnect. EventSource cannot send Authorization headers — use access_token query. */

function apiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || "/api"
}

export type SseSubscriptionOptions = {
  accessToken?: string
  onConnected?: () => void
  onDisconnected?: () => void
}

function buildEventsUrl(path: string, accessToken?: string): string {
  const base = apiBaseUrl().replace(/\/$/, "")
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = new URL(`${base}${normalizedPath}`, window.location.origin)
  if (accessToken) {
    url.searchParams.set("access_token", accessToken)
  }
  return url.toString()
}

/**
 * Subscribe to an SSE channel. Calls onEvent for meaningful payloads (not heartbeats).
 * Returns an unsubscribe function. On hard failure / browser without EventSource, calls onDisconnected once.
 */
export function subscribeSse(
  path: string,
  onEvent: (eventType: string, data: unknown) => void,
  options: SseSubscriptionOptions = {},
): () => void {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    options.onDisconnected?.()
    return () => undefined
  }

  let closed = false
  let source: EventSource | null = null
  let reconnectTimer: number | undefined
  let sawOpen = false

  const connect = () => {
    if (closed) return
    source?.close()
    source = new EventSource(buildEventsUrl(path, options.accessToken))

    source.onopen = () => {
      if (closed) return
      sawOpen = true
      options.onConnected?.()
    }

    source.onerror = () => {
      if (closed) return
      options.onDisconnected?.()
      source?.close()
      source = null
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(connect, sawOpen ? 2000 : 4000)
    }

    const handleMessage = (event: MessageEvent) => {
      if (closed) return
      let data: unknown = event.data
      try {
        data = JSON.parse(String(event.data))
      } catch {
        // keep raw string
      }
      const eventType = event.type && event.type !== "message" ? event.type : (data as { type?: string })?.type || "message"
      if (eventType === "connected") return
      onEvent(eventType, data)
    }

    source.onmessage = handleMessage
    // Named events from server: event: order.updated
    ;[
      "order.updated",
      "order.created",
      "order.accepted",
      "order.cancelled",
      "order.status",
      "order.price_confirmed",
      "order.dispatched",
      "order.reviewed",
      "offers.changed",
    ].forEach((name) => {
      source?.addEventListener(name, handleMessage as EventListener)
    })
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    source?.close()
    source = null
  }
}

export function subscribeOrderEvents(
  orderId: string,
  onEvent: () => void,
  options: SseSubscriptionOptions = {},
): () => void {
  return subscribeSse(`/events/orders/${encodeURIComponent(orderId)}`, () => onEvent(), options)
}

export function subscribeProviderEvents(
  providerId: string,
  accessToken: string,
  onEvent: () => void,
  options: Omit<SseSubscriptionOptions, "accessToken"> = {},
): () => void {
  return subscribeSse(
    `/events/providers/${encodeURIComponent(providerId)}`,
    () => onEvent(),
    { ...options, accessToken },
  )
}
