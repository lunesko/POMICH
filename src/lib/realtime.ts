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

function buildEventsUrl(path: string, ticket?: string): string {
  const base = apiBaseUrl().replace(/\/$/, "")
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = new URL(`${base}${normalizedPath}`, window.location.origin)
  if (ticket) {
    url.searchParams.set("ticket", ticket)
  }
  return url.toString()
}

function buildWsUrl(path: string, ticket?: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = new URL(`${wsOriginFromApiBase()}${normalizedPath}`)
  if (ticket) {
    url.searchParams.set("ticket", ticket)
  }
  return url.toString()
}

function scopeFromRealtimePath(path: string): string | null {
  const normalized = path.startsWith("/") ? path : `/${path}`
  const match = normalized.match(/^\/(?:ws|events)\/(orders|customers|providers)\/([^/?#]+)/)
  if (!match) return null
  const kind = match[1] === "orders" ? "order" : match[1] === "customers" ? "customer" : "provider"
  try {
    return `${kind}:${decodeURIComponent(match[2])}`
  } catch {
    return `${kind}:${match[2]}`
  }
}

async function mintRealtimeTicket(scope: string, accessToken: string): Promise<string> {
  const base = apiBaseUrl().replace(/\/$/, "")
  const response = await fetch(`${base}/auth/realtime/ticket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scope }),
  })
  if (!response.ok) {
    throw new Error(`realtime_ticket_${response.status}`)
  }
  const payload = (await response.json()) as { ticket?: string }
  const ticket = String(payload.ticket || "").trim()
  if (!ticket) throw new Error("realtime_ticket_missing")
  return ticket
}

function handleRealtimePayload(
  eventType: string,
  data: unknown,
  onEvent: (eventType: string, data: unknown) => void,
): void {
  if (eventType === "connected" || eventType === "heartbeat") return
  if (eventType === "session.expired") {
    onEvent(eventType, data)
    return
  }
  onEvent(eventType, data)
}

/**
 * Subscribe to an SSE channel. Calls onEvent for meaningful payloads (not heartbeats).
 * Returns an unsubscribe function. On hard failure / browser without EventSource, calls onDisconnected once.
 */
export function subscribeSse(
  path: string,
  onEvent: (eventType: string, data: unknown) => void,
  options: RealtimeSubscriptionOptions & { ticket?: string } = {},
): () => void {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    options.onDisconnected?.()
    return () => undefined
  }

  let closed = false
  let source: EventSource | null = null
  let reconnectTimer: number | undefined
  let sawOpen = false
  let reconnectAttempt = 0

  const connect = () => {
    if (closed) return
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      reconnectTimer = window.setTimeout(connect, 5000)
      return
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      reconnectTimer = window.setTimeout(connect, 8000)
      return
    }
    source?.close()
    source = new EventSource(buildEventsUrl(path, options.ticket))

    source.onopen = () => {
      if (closed) return
      sawOpen = true
      reconnectAttempt = 0
      options.onConnected?.()
    }

    source.onmessage = (event) => {
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

    for (const name of REALTIME_EVENT_NAMES) {
      source.addEventListener(name, ((event: MessageEvent) => {
        if (closed) return
        let data: unknown = event.data
        try {
          data = JSON.parse(String(event.data))
        } catch {
          return
        }
        handleRealtimePayload(name, data, onEvent)
      }) as EventListener)
    }

    source.onerror = () => {
      if (closed) return
      source?.close()
      source = null
      if (!sawOpen && reconnectAttempt >= 2) {
        options.onDisconnected?.()
        return
      }
      reconnectAttempt += 1
      const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempt, 4), 15000)
      reconnectTimer = window.setTimeout(connect, delay)
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    source?.close()
    source = null
  }
}

const WS_CONNECT_TIMEOUT_MS = 4_000
const WS_RECONNECT_MS = 1_200
const MAX_WS_RECONNECT_FAILURES = 3
/** Server heartbeats every 15s — miss ~3 and treat the socket as a dead cat. */
const WS_HEARTBEAT_TIMEOUT_MS = 45_000
const WS_WATCHDOG_TICK_MS = 5_000

function subscribeRealtimeWithTicket(
  wsPath: string,
  ssePath: string,
  onEvent: (eventType: string, data: unknown) => void,
  options: RealtimeSubscriptionOptions & { ticket?: string },
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
  let watchdogTimer: number | undefined
  let lastFrameAt = 0
  let wsFailures = 0
  let usingSse = false

  const clearWatchdog = () => {
    if (watchdogTimer) window.clearInterval(watchdogTimer)
    watchdogTimer = undefined
  }

  const stopSse = () => {
    sseStop?.()
    sseStop = null
  }

  const startSse = () => {
    if (closed || usingSse) return
    usingSse = true
    clearWatchdog()
    stopSse()
    sseStop = subscribeSse(ssePath, onEvent, options)
  }

  const noteFrame = () => {
    lastFrameAt = Date.now()
  }

  const forceDeadSocket = (socket: WebSocket | null) => {
    clearWatchdog()
    if (!socket) return
    try {
      socket.close()
    } catch {
      // ignore
    }
  }

  const startWatchdog = (socket: WebSocket) => {
    clearWatchdog()
    noteFrame()
    watchdogTimer = window.setInterval(() => {
      if (closed || usingSse || ws !== socket) {
        clearWatchdog()
        return
      }
      if (Date.now() - lastFrameAt < WS_HEARTBEAT_TIMEOUT_MS) return
      forceDeadSocket(socket)
    }, WS_WATCHDOG_TICK_MS)
  }

  const connectWebSocket = () => {
    if (closed || usingSse) return
    if (typeof WebSocket === "undefined") {
      startSse()
      return
    }

    clearWatchdog()
    if (ws) {
      try {
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        ws.onopen = null
        ws.close()
      } catch {
        // ignore
      }
      ws = null
    }

    const socket = new WebSocket(buildWsUrl(wsPath, options.ticket))
    ws = socket
    let opened = false

    if (connectTimer) window.clearTimeout(connectTimer)
    connectTimer = window.setTimeout(() => {
      if (closed || opened || usingSse || ws !== socket) return
      forceDeadSocket(socket)
      ws = null
      startSse()
    }, WS_CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (closed || ws !== socket) return
      opened = true
      wsFailures = 0
      if (connectTimer) window.clearTimeout(connectTimer)
      startWatchdog(socket)
      options.onConnected?.()
    }

    socket.onmessage = (event) => {
      if (closed || ws !== socket) return
      noteFrame()
      let data: unknown = event.data
      try {
        data = JSON.parse(String(event.data))
      } catch {
        return
      }
      const eventType = (data as { type?: string })?.type || "message"
      if (eventType === "session.expired") {
        options.onDisconnected?.()
        forceDeadSocket(socket)
        return
      }
      handleRealtimePayload(eventType, data, onEvent)
    }

    socket.onerror = () => {
      if (closed || usingSse || ws !== socket) return
      if (connectTimer) window.clearTimeout(connectTimer)
      if (!opened) {
        forceDeadSocket(socket)
        ws = null
        startSse()
      }
    }

    socket.onclose = () => {
      if (connectTimer) window.clearTimeout(connectTimer)
      clearWatchdog()
      if (ws === socket) ws = null
      if (closed) return

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
    clearWatchdog()
    if (ws) {
      try {
        ws.onclose = null
        ws.close()
      } catch {
        // ignore
      }
    }
    ws = null
    stopSse()
  }
}

/**
 * Prefer WebSocket, fall back to SSE on handshake/connect failure or repeated disconnects.
 * Uses a short-lived realtime ticket in the URL instead of the bearer access token (F05).
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
  let stopInner: (() => void) | null = null

  const start = async () => {
    const scope = scopeFromRealtimePath(wsPath) || scopeFromRealtimePath(ssePath)
    let ticket: string | undefined
    if (options.accessToken && scope) {
      try {
        ticket = await mintRealtimeTicket(scope, options.accessToken)
      } catch {
        if (!closed) options.onDisconnected?.()
        return
      }
    }
    if (closed) return
    stopInner = subscribeRealtimeWithTicket(wsPath, ssePath, onEvent, { ...options, ticket })
  }

  void start()

  return () => {
    closed = true
    stopInner?.()
    stopInner = null
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
  scopeFromRealtimePath,
  mintRealtimeTicket,
  subscribeRealtime,
  subscribeSse,
  WS_CONNECT_TIMEOUT_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_WATCHDOG_TICK_MS,
  MAX_WS_RECONNECT_FAILURES,
}
