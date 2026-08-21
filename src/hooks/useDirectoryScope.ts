import { useCallback, useEffect, useRef, useState } from "react"

import {
  getMapProviders,
  getMapSettlements,
  getNearestMapSettlement,
  type MapSettlement,
  type ProviderAvailability,
} from "../api/client"
import type { Point } from "../lib/constants"
import {
  directoryScopeMapTarget,
  nearestSettlementFromList,
  readDirectoryScope,
  settlementDistanceKm,
  validateGeoForDirectory,
  writeDirectoryScope,
  type DirectoryScopeMode,
} from "../lib/directoryScope"
import { isUkraineServiceCity, normalizeServiceCity, resolveServiceCityFromGeo, serviceCityCenter } from "../lib/ukraineCities"
import { readPreferredCity } from "../lib/preferredCity"

export type DirectoryGeoStatus = "idle" | "loading" | "ok" | "denied" | "error" | "occupied"

const MY_CITY_RADIUS_KM = 25
const NEAREST_CITY_MAX_KM = 35

export function useDirectoryScope(options?: { refreshMs?: number; enabled?: boolean }) {
  const refreshMs = options?.refreshMs ?? 0
  const enabled = options?.enabled ?? true
  const [scope, setScopeState] = useState<DirectoryScopeMode>(() => readDirectoryScope())
  const [resolvedCity, setResolvedCity] = useState<string | null>(null)
  const [cityCenter, setCityCenter] = useState<Point | null>(null)
  const [geoRadiusPoint, setGeoRadiusPoint] = useState<Point | null>(null)
  const [geoStatus, setGeoStatus] = useState<DirectoryGeoStatus>("idle")
  const [geoError, setGeoError] = useState<string | undefined>()
  const [providers, setProviders] = useState<ProviderAvailability[]>([])
  const [loading, setLoading] = useState(enabled)
  const [recenterTrigger, setRecenterTrigger] = useState(0)
  const settlementsRef = useRef<MapSettlement[]>([])
  const settlementsReadyRef = useRef<Promise<void>>(Promise.resolve())
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    settlementsReadyRef.current = getMapSettlements()
      .then((items) => {
        if (!cancelled) settlementsRef.current = Array.isArray(items) ? items : []
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])

  const bumpRecenter = useCallback(() => {
    setRecenterTrigger((value) => value + 1)
  }, [])

  const fetchProviders = useCallback(async (mode: DirectoryScopeMode, city: string | null) => {
    setLoading(true)
    try {
      if (mode === "all-ukraine") {
        const items = await getMapProviders({ scope: "all" })
        setProviders(Array.isArray(items) ? items : [])
        return
      }
      if (city) {
        const items = await getMapProviders({ city })
        setProviders(Array.isArray(items) ? items : [])
        return
      }
      setProviders([])
    } catch {
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchProvidersNear = useCallback(async (point: Point, radiusKm = MY_CITY_RADIUS_KM) => {
    setLoading(true)
    try {
      const items = await getMapProviders({
        lat: point.lat,
        lng: point.lng,
        radiusKm,
      })
      setProviders(Array.isArray(items) ? items : [])
    } catch {
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [])

  const resolveNearestSettlement = useCallback(async (lat: number, lng: number): Promise<MapSettlement | null> => {
    try {
      const fromApi = await getNearestMapSettlement(lat, lng)
      if (fromApi?.name) return fromApi
    } catch {
      // Fall back to cached/full list when API is unavailable.
    }

    await settlementsReadyRef.current

    let settlements = settlementsRef.current
    if (settlements.length === 0) {
      try {
        const items = await getMapSettlements()
        settlements = Array.isArray(items) ? items : []
        settlementsRef.current = settlements
      } catch {
        settlements = []
      }
    }

    return settlements.length > 0 ? nearestSettlementFromList(settlements, lat, lng) : null
  }, [])

  const applyGeoRadiusScope = useCallback(
    async (point: Point) => {
      setResolvedCity(null)
      setGeoRadiusPoint(point)
      setCityCenter(point)
      setGeoStatus("ok")
      setGeoError(undefined)
      await fetchProvidersNear(point, MY_CITY_RADIUS_KM)
    },
    [fetchProvidersNear],
  )

  const refetchProviders = useCallback(async () => {
    if (scope === "all-ukraine") {
      await fetchProviders("all-ukraine", null)
      return
    }
    if (resolvedCity) {
      await fetchProviders("my-city", resolvedCity)
      return
    }
    if (geoRadiusPoint) {
      await fetchProvidersNear(geoRadiusPoint, MY_CITY_RADIUS_KM)
    }
  }, [fetchProviders, fetchProvidersNear, geoRadiusPoint, resolvedCity, scope])

  const resolveCityFromGeo = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoStatus("error")
      setGeoError("Геолокація недоступна у цьому браузері.")
      return false
    }

    setGeoStatus("loading")
    setGeoError(undefined)
    setGeoRadiusPoint(null)

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude
          const lng = position.coords.longitude
          const occupiedMessage = validateGeoForDirectory(lat, lng)
          if (occupiedMessage) {
            setGeoStatus("occupied")
            setGeoError(occupiedMessage)
            resolve(false)
            return
          }

          const nearest = await resolveNearestSettlement(lat, lng)
          if (nearest?.name) {
            const distanceKm =
              typeof (nearest as { distanceKm?: number }).distanceKm === "number"
                ? (nearest as { distanceKm?: number }).distanceKm!
                : settlementDistanceKm(nearest, lat, lng)
            if (distanceKm != null && distanceKm > NEAREST_CITY_MAX_KM) {
              await applyGeoRadiusScope({ lat, lng })
              resolve(true)
              return
            }
            const serviceCity =
              resolveServiceCityFromGeo({ lat, lng }, nearest.name) ||
              (isUkraineServiceCity(nearest.name) ? normalizeServiceCity(nearest.name) : "")
            if (!serviceCity) {
              await applyGeoRadiusScope({ lat, lng })
              resolve(true)
              return
            }
            setResolvedCity(serviceCity)
            setGeoRadiusPoint(null)
            setCityCenter(serviceCityCenter(serviceCity) ?? nearest.center ?? { lat, lng })
            setGeoStatus("ok")
            setGeoError(undefined)
            resolve(true)
            return
          }

          await applyGeoRadiusScope({ lat, lng })
          resolve(true)
        },
        (error) => {
          setGeoStatus(error.code === error.PERMISSION_DENIED ? "denied" : "error")
          setGeoError(
            error.code === error.PERMISSION_DENIED
              ? "Дозвольте доступ до геолокації в браузері або Telegram."
              : "Не вдалося визначити місцезнаходження.",
          )
          resolve(false)
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
      )
    })
  }, [applyGeoRadiusScope, resolveNearestSettlement])

  const resolvePreferredCityFallback = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false
    const raw = readPreferredCity()
    if (!isUkraineServiceCity(raw)) return false
    const preferred = normalizeServiceCity(raw)
    setResolvedCity(preferred)
    setGeoRadiusPoint(null)
    setCityCenter(serviceCityCenter(preferred))
    setGeoStatus("ok")
    setGeoError(undefined)
    await fetchProviders("my-city", preferred)
    return true
  }, [fetchProviders])

  const applyScope = useCallback(
    async (next: DirectoryScopeMode, options?: { recenter?: boolean }) => {
      writeDirectoryScope(next)
      setScopeState(next)
      if (next === "all-ukraine") {
        setResolvedCity(null)
        setCityCenter(null)
        setGeoRadiusPoint(null)
        setGeoStatus("idle")
        setGeoError(undefined)
        if (options?.recenter !== false) bumpRecenter()
        await fetchProviders("all-ukraine", null)
        return
      }
      const ok = await resolveCityFromGeo()
      if (ok) {
        if (options?.recenter !== false) bumpRecenter()
        return
      }
      const fallbackOk = await resolvePreferredCityFallback()
      if (fallbackOk && options?.recenter !== false) bumpRecenter()
    },
    [bumpRecenter, fetchProviders, resolveCityFromGeo, resolvePreferredCityFallback],
  )

  const setScope = useCallback(
    (next: DirectoryScopeMode) => applyScope(next),
    [applyScope],
  )

  const retryGeo = useCallback(async () => {
    if (scope !== "my-city") return
    setGeoError(undefined)
    const ok = await resolveCityFromGeo()
    if (ok) {
      bumpRecenter()
      return
    }
    if (await resolvePreferredCityFallback()) bumpRecenter()
  }, [scope, bumpRecenter, resolveCityFromGeo, resolvePreferredCityFallback])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    if (initializedRef.current) return
    initializedRef.current = true
    const storedScope = readDirectoryScope()
    if (storedScope === "all-ukraine") {
      setScopeState("all-ukraine")
      void fetchProviders("all-ukraine", null)
      return
    }
    void applyScope(storedScope, { recenter: true })
  }, [applyScope, enabled, fetchProviders])

  useEffect(() => {
    if (!enabled || scope !== "my-city" || !resolvedCity) return
    void fetchProviders("my-city", resolvedCity)
  }, [enabled, scope, resolvedCity, fetchProviders])

  useEffect(() => {
    if (!enabled || !refreshMs || scope !== "all-ukraine") return
    const id = window.setInterval(() => {
      void fetchProviders("all-ukraine", null)
    }, refreshMs)
    return () => window.clearInterval(id)
  }, [enabled, refreshMs, scope, fetchProviders])

  const mapTarget = directoryScopeMapTarget(scope, cityCenter)

  return {
    scope,
    setScope,
    resolvedCity,
    cityCenter,
    geoRadiusPoint,
    geoStatus,
    geoError,
    providers,
    loading,
    recenterTrigger,
    mapTarget,
    retryGeo,
    geoLoading: geoStatus === "loading",
    fetchProvidersNear,
    refetchProviders,
  }
}
