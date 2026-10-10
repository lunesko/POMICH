import { afterEach, expect, it, vi } from "vitest"
import { fetchJsonWithDeadline } from "./fetchJsonWithDeadline"

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it("aborts a stalled geoservice response", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
  })))
  const result = fetchJsonWithDeadline("https://example.test/route", {}, 100)
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" })
  await vi.advanceTimersByTimeAsync(101)
  await rejected
})

it("clears the deadline after a successful response", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ route: [] }) }))
  await expect(fetchJsonWithDeadline("https://example.test/route")).resolves.toEqual({ route: [] })
  expect(vi.getTimerCount()).toBe(0)
})
