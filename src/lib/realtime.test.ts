import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { __realtimeTestHooks } from "./realtime"

const { buildEventsUrl, buildWsUrl, subscribeRealtime, subscribeSse, WS_CONNECT_TIMEOUT_MS } = __realtimeTestHooks

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState = MockWebSocket.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent("close"))
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event("open"))
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }
}

describe("realtime transport preference", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "/api")
    MockWebSocket.instances = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("builds ws url from api base with wss on https pages", () => {
    Object.defineProperty(window, "location", {
      value: { origin: "https://toll-icons-apollo-emission.trycloudflare.com" },
      configurable: true,
    })
    expect(buildWsUrl("/ws/orders/o1", "tok")).toBe(
      "wss://toll-icons-apollo-emission.trycloudflare.com/api/ws/orders/o1?access_token=tok",
    )
  })

  it("builds sse url with access_token query param", () => {
    Object.defineProperty(window, "location", {
      value: { origin: "https://example.com" },
      configurable: true,
    })
    expect(buildEventsUrl("/events/providers/p1", "tok")).toBe(
      "https://example.com/api/events/providers/p1?access_token=tok",
    )
  })

  it("prefers websocket and delivers events", () => {
    ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket

    const events: string[] = []
    const stop = subscribeRealtime(
      "/ws/orders/o1",
      "/events/orders/o1",
      (eventType) => events.push(eventType),
      { onConnected: () => events.push("connected-cb") },
    )

    const socket = MockWebSocket.instances[0]
    expect(socket.url).toContain("/api/ws/orders/o1")
    socket.emitOpen()
    socket.emitMessage({ type: "connected", channel: "order:o1" })
    socket.emitMessage({ type: "order.accepted", payload: { id: "o1" } })

    expect(events).toEqual(["connected-cb", "order.accepted"])
    stop()
  })

  it("falls back to sse when websocket handshake times out", () => {
    Object.defineProperty(window, "location", {
      value: { origin: "https://example.com" },
      configurable: true,
    })
    ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket

    const sseConnect = vi.fn()
    const originalEventSource = window.EventSource
    class MockEventSource {
      url: string
      onopen: ((ev: Event) => void) | null = null
      onmessage: ((ev: MessageEvent) => void) | null = null
      onerror: ((ev: Event) => void) | null = null
      constructor(url: string) {
        this.url = url
        sseConnect(url)
      }
      close() {}
      addEventListener() {}
    }
    ;(window as { EventSource: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource

    const stop = subscribeRealtime("/ws/orders/o2", "/events/orders/o2", () => undefined)
    expect(MockWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(WS_CONNECT_TIMEOUT_MS + 1)

    expect(sseConnect).toHaveBeenCalledWith("https://example.com/api/events/orders/o2")
    stop()
    ;(window as { EventSource: typeof EventSource }).EventSource = originalEventSource
  })

  it("falls back to sse when websocket is unavailable", () => {
    const prev = (globalThis as { WebSocket?: unknown }).WebSocket
    ;(globalThis as { WebSocket?: unknown }).WebSocket = undefined

    const sseConnect = vi.fn()
    class MockEventSource {
      constructor(url: string) {
        sseConnect(url)
      }
      close() {}
      addEventListener() {}
      onopen = null
      onmessage = null
      onerror = null
    }
    ;(window as { EventSource: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource

    const stop = subscribeSse("/events/orders/o3", () => undefined)
    expect(sseConnect).toHaveBeenCalled()
    stop()

    ;(globalThis as { WebSocket?: unknown }).WebSocket = prev
  })
})
