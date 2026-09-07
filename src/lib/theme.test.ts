import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyPomichThemeToDocument,
  clearPomichTelegramThemeOverrides,
  MAP_TILE_URLS,
  MAP_TILE_ATTRIBUTIONS,
  resolveMapTileConfig,
  POMICH_THEME_STORAGE_KEY,
  readStoredPomichTheme,
  resolveInitialPomichTheme,
  resolveMapUsesDarkTiles,
  readActivePomichTheme,
  syncPomichThemeToTelegramWebApp,
} from "./theme"

describe("pomich theme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-pomich-theme")
    window.localStorage.clear()
    delete (window as Window & { Telegram?: unknown }).Telegram
    for (const cssVar of [
      "--tg-theme-bg-color",
      "--tg-theme-text-color",
      "--tg-theme-secondary-bg-color",
      "--tg-theme-header-bg-color",
    ]) {
      document.documentElement.style.removeProperty(cssVar)
    }
  })

  it("reads stored theme preference", () => {
    window.localStorage.setItem(POMICH_THEME_STORAGE_KEY, "dark")
    expect(readStoredPomichTheme()).toBe("dark")
  })

  it("prefers stored theme over telegram color scheme", () => {
    window.localStorage.setItem(POMICH_THEME_STORAGE_KEY, "dark")
    expect(resolveInitialPomichTheme({ telegramColorScheme: "light" })).toBe("dark")
  })

  it("applies dark tokens to document root", () => {
    applyPomichThemeToDocument("dark")

    expect(document.documentElement.dataset.pomichTheme).toBe("dark")
    expect(getComputedStyle(document.documentElement).getPropertyValue("--pomich-bg").trim()).toBe("#090B0E")
    expect(getComputedStyle(document.documentElement).getPropertyValue("--pomich-text").trim()).toBe("#FFFFFF")
    expect(getComputedStyle(document.documentElement).getPropertyValue("--pomich-card-bg").trim()).toBe("#181C24")
  })

  it("clears telegram css overrides when pomich theme is active", () => {
    document.documentElement.style.setProperty("--tg-theme-bg-color", "#ffffff")
    applyPomichThemeToDocument("dark")
    clearPomichTelegramThemeOverrides()
    expect(document.documentElement.style.getPropertyValue("--tg-theme-bg-color")).toBe("")
  })

  it("syncs telegram webapp chrome colors for dark mode when Bot API >= 6.1", () => {
    const setHeaderColor = vi.fn()
    const setBackgroundColor = vi.fn()
    window.Telegram = {
      WebApp: {
        isVersionAtLeast: () => true,
        setHeaderColor,
        setBackgroundColor,
      },
    }

    syncPomichThemeToTelegramWebApp("dark")

    expect(setHeaderColor).toHaveBeenCalledWith("#090B0E")
    expect(setBackgroundColor).toHaveBeenCalledWith("rgba(9, 11, 14, 0.65)")
  })

  it("skips telegram chrome color APIs on Bot API 6.0", () => {
    const setHeaderColor = vi.fn()
    const setBackgroundColor = vi.fn()
    window.Telegram = {
      WebApp: {
        isVersionAtLeast: () => false,
        setHeaderColor,
        setBackgroundColor,
      },
    }

    syncPomichThemeToTelegramWebApp("dark")

    expect(setHeaderColor).not.toHaveBeenCalled()
    expect(setBackgroundColor).not.toHaveBeenCalled()
  })

  it("reads active theme from document root", () => {
    applyPomichThemeToDocument("dark")
    expect(readActivePomichTheme()).toBe("dark")
  })

  it("uses dark in-app tiles only when explicitly requested", () => {
    applyPomichThemeToDocument("dark")
    expect(resolveMapUsesDarkTiles({ mapTileTheme: "dark" })).toBe(true)
    expect(resolveMapUsesDarkTiles({ mapTileTheme: "light" })).toBe(false)
  })

  it("keeps landing hero maps on light tiles", () => {
    applyPomichThemeToDocument("dark")
    expect(resolveMapUsesDarkTiles({ decorative: true, mapTileTheme: "light" })).toBe(false)
  })

  it("follows dark UI for shell decorative maps", () => {
    applyPomichThemeToDocument("dark")
    expect(resolveMapUsesDarkTiles({ decorative: true, mapTileTheme: "auto", isDark: true })).toBe(true)
  })

  it("uses OSM tiles for Ukraine-wide mask maps", () => {
    applyPomichThemeToDocument("light")
    const tile = resolveMapTileConfig({ ukraineMask: true, mapTileTheme: "light" })
    expect(tile.url).toBe(MAP_TILE_URLS.light)
    expect(tile.attribution).toBe(MAP_TILE_ATTRIBUTIONS.osm)
  })

  it("keeps OSM for city ride maps without mask", () => {
    applyPomichThemeToDocument("light")
    const tile = resolveMapTileConfig({ ukraineMask: false, mapTileTheme: "light" })
    expect(tile.url).toBe(MAP_TILE_URLS.light)
    expect(tile.attribution).toBe(MAP_TILE_ATTRIBUTIONS.osm)
  })
})
