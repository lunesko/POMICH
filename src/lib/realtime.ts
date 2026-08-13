/** Realtime helpers: WebSocket preferred, SSE fallback, polling via onDisconnected in callers. */

function apiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || "/api"
}

export type RealtimeSubscriptionOptions = {
  accessToken?: string
  onConnected?: () => void
  onDisconnected?: () => void
}

/** @deprecated use RealtimeSubscriptionOptions */
export type SseSubscriptionOptions = RealtimeSubscriptionOptions

const REALTIME_EVENT_NAMES = [
  "order.updated",
  "order.created",
  "order.accepted",
  "order.cancelled",
  "order.status",
  "order.price_confirmed",
  "order.dispatched",
  "order.reviewed",
  "offers.changed",
] as const

function wsOriginFromApiBase(): string {
  const base = apiBaseUrl().replace(/\/$/, "")
  const url = new URL(base, window.location.origin)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.origin + url.pathname.replace(/\/$/, "")
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

function buildWsUrl(path: string, accessToken?: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = new URL(`${wsOriginFromApiBase()}${normalizedPath}`)
  if (accessToken) {
    url.searchParams.set("access_token", accessToken)
  }
  return url.toString()
}

function handleRealtimePayload(
  eventType: string,
  data: unknown,
  onEvent: (eventType: string, data: unknown) => void,
): void {
  if (eventType === "connected" || eventType === "heartbeat") return
  onEvent(eventType, data)
}

/**
 * Subscribe to an SSE channel. Calls onEvent for meaningful payloads (not heartbeats).
 * Returns an unsubscribe function. On hard failure / browser without EventSource, calls onDisconnected once.
 */
export function subscribeSse(
  path: string,
  onEvent: (eventType: string, data: unknown) => void,
  options: RealtimeSubscriptionOptions = {},
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
      const eventType =
        event.type && event.type !== "message" ? event.type : (data as { type?: string })?.type || "message"
      handleRealtimePayload(eventType, data, onEvent)
    }

    source.onmessage = handleMessage
    REALTIME_EVENT_NAMES.forEach((name) => {
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

const WS_CONNECT_TIMEOUT_MS = 3000
const WS_RECONNECT_MS = 2000
const MAX_WS_RECONNECT_FAILURES = 3

/**
 * Prefer WebSocket, fall back to SSE on handshake/connect failure or repeated disconnects.
 */
export function subscribeRealtime(
  wsPath: string,
  ssePath: string,
  onEvent: (eventType: string, data: unknown) => void,
  options: RealtimeSubscriptionOptions = {},
): () => void {
  if (typeof window === "undefined") {
    options.onDisconnected?.()
    return () => undefined
  }

  let closed = false
  let ws: WebSocket | null = null
  let sseStop: (() => void) | null = null
  let connectTimer: number | undefined
  let reconnectTimer: number | undefined
  let wsFailures = 0
  let usingSse = false

  const stopSse = () => {
    sseStop?.()
    sseStop = null
  }

  const startSse = () => {
    if (closed || usingSse) return
    usingSse = true
    stopSse()
    sseStop = subscribeSse(ssePath, onEvent, options)
  }

  const connectWebSocket = () => {
    if (closed || usingSse) return
    if (typeof WebSocket === "undefined") {
      startSse()
      return
    }

    ws?.close()
    ws = new WebSocket(buildWsUrl(wsPath, options.accessToken))
    let opened = false

    if (connectTimer) window.clearTimeout(connectTimer)
    connectTimer = window.setTimeout(() => {
      if (closed || opened || usingSse) return
      ws?.close()
      ws = null
      startSse()
    }, WS_CONNECT_TIMEOUT_MS)

    ws.onopen = () => {
      if (closed) return
      opened = true
      wsFailures = 0
      if (connectTimer) window.clearTimeout(connectTimer)
      options.onConnected?.()
    }

    ws.onmessage = (event) => {
      if (closed) return
      let data: unknown = event.data
      try {
        data = JSON.parse(String(event.data))
      } catch {
        return
      }
      const eventType = (data as { type?: string })?.type || "message"
      handleRealtimePayload(eventType, data, onEvent)
    }

    ws.onerror = () => {
      if (closed || opened || usingSse) return
      if (connectTimer) window.clearTimeout(connectTimer)
      ws = null
      startSse()
    }

    ws.onclose = () => {
      if (connectTimer) window.clearTimeout(connectTimer)
      if (closed) return
      ws = null

      if (!opened) {
        if (!usingSse) startSse()
        return
      }

      options.onDisconnected?.()
      wsFailures += 1
      if (wsFailures >= MAX_WS_RECONNECT_FAILURES) {
        startSse()
        return
      }
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(connectWebSocket, WS_RECONNECT_MS)
    }
  }

  connectWebSocket()

  return () => {
    closed = true
    if (connectTimer) window.clearTimeout(connectTimer)
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
    stopSse()
  }
}

export function subscribeOrderEvents(
  orderId: string,
  onEvent: () => void,
  options: RealtimeSubscriptionOptions = {},
): () => void {
  const encoded = encodeURIComponent(orderId)
  return subscribeRealtime(
    `/ws/orders/${encoded}`,
    `/events/orders/${encoded}`,
    () => onEvent(),
    options,
  )
}

export function subscribeProviderEvents(
  providerId: string,
  accessToken: string,
  onEvent: () => void,
  options: Omit<RealtimeSubscriptionOptions, "accessToken"> = {},
): () => void {
  const encoded = encodeURIComponent(providerId)
  return subscribeRealtime(
    `/ws/providers/${encoded}`,
    `/events/providers/${encoded}`,
    () => onEvent(),
    { ...options, accessToken },
  )
}

/** @internal test hooks */
export const __realtimeTestHooks = {
  buildEventsUrl,
  buildWsUrl,
  subscribeRealtime,
  subscribeSse,
  WS_CONNECT_TIMEOUT_MS,
  MAX_WS_RECONNECT_FAILURES,
}
