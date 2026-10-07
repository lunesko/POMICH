import { useEffect, useRef, useState } from "react"
import { PROVIDER_START, type Point } from "../../../lib/constants"
import {
  canRequestGeoSilently,
  isTelegramMiniApp,
  readCachedGeoPosition,
  requestCurrentPosition,
  resolveGroundSpeedMps,
  shouldAcceptGeoUpdate,
  smoothSpeedMps,
  writeCachedGeoPosition,
} from "../../../lib/mapGeo"

/** Owns permission checks, the live watch, motion samples and manual retry. */
export default function useProviderGeolocation(enabled: boolean) {
  const [providerLocation, setProviderLocation] = useState<Point>(
    () => readCachedGeoPosition() ?? PROVIDER_START,
  )
  const [providerGeoLoading, setProviderGeoLoading] = useState(false)
  const [providerGeoError, setProviderGeoError] = useState<string | undefined>()
  const [providerRecenterTrigger, setProviderRecenterTrigger] = useState(0)
  const [providerSpeedMps, setProviderSpeedMps] = useState<number | null>(null)
  const [providerGeoWatchEpoch, setProviderGeoWatchEpoch] = useState(0)

  const providerLocationRef = useRef(providerLocation)
  const providerMotionSampleRef = useRef<{ point: Point; at: number } | null>(
    null,
  )
  const providerSpeedSmoothRef = useRef<number | null>(null)
  useEffect(() => {
    providerLocationRef.current = providerLocation
  }, [providerLocation])

  // Live GPS + speed HUD on the duty map even before «Вийти на лінію» — partners
  // need the dial while parked/offline, same as clients on the home map.
  const providerLiveNav = enabled

  useEffect(() => {
    if (
      !providerLiveNav ||
      typeof navigator === "undefined" ||
      !("geolocation" in navigator)
    )
      return

    let cancelled = false
    let watchId: number | undefined

    const startWatch = () => {
      if (cancelled || typeof watchId === "number") return
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const point = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          }
          const rawSpeed = resolveGroundSpeedMps(
            position,
            providerMotionSampleRef.current,
          )
          const smoothed = smoothSpeedMps(
            providerSpeedSmoothRef.current,
            rawSpeed,
          )
          providerSpeedSmoothRef.current = smoothed
          setProviderSpeedMps(smoothed)
          providerMotionSampleRef.current = {
            point,
            at:
              typeof position.timestamp === "number"
                ? position.timestamp
                : Date.now(),
          }
          if (
            !shouldAcceptGeoUpdate(
              providerLocationRef.current,
              point,
              position.coords.accuracy,
            )
          )
            return
          writeCachedGeoPosition(point)
          setProviderLocation(point)
        },
        (error) => {
          setProviderSpeedMps(null)
          providerSpeedSmoothRef.current = null
          if (error.code === error.PERMISSION_DENIED && !isTelegramMiniApp()) {
            setProviderGeoError(
              "Дозвольте доступ до геолокації в браузері або Telegram, потім натисніть «Оновити».",
            )
          }
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
      )
      if (cancelled) {
        navigator.geolocation.clearWatch(watchId)
        watchId = undefined
      }
    }

    const maybeStartWatch = () => {
      // Never start watchPosition without a silent browser grant — Telegram Mini App
      // alone used to re-prompt the OS geolocation dialog on every duty-map open.
      void canRequestGeoSilently().then((ok) => {
        if (cancelled || !ok) return
        startWatch()
      })
    }

    // Seed from auto cache; live watch only with a silent browser grant or Mini App WebView.
    requestCurrentPosition(
      (point) => {
        if (cancelled) return
        setProviderLocation(point)
        maybeStartWatch()
      },
      () => {
        if (cancelled) return
        if (providerLocationRef.current) maybeStartWatch()
      },
      { mode: "auto" },
    )

    return () => {
      cancelled = true
      if (typeof watchId === "number") navigator.geolocation.clearWatch(watchId)
      setProviderSpeedMps(null)
      providerSpeedSmoothRef.current = null
      providerMotionSampleRef.current = null
    }
    // Keep one watch across navigation/arrived/offer while providerLiveNav stays true.
  }, [providerLiveNav, providerGeoWatchEpoch])

  const retryProviderGeolocation = () => {
    setProviderGeoLoading(true)
    setProviderGeoError(undefined)
    requestCurrentPosition(
      (point) => {
        setProviderLocation(point)
        setProviderGeoLoading(false)
        setProviderRecenterTrigger((value) => value + 1)
        if (providerLiveNav) setProviderGeoWatchEpoch((value) => value + 1)
      },
      (message) => {
        setProviderGeoLoading(false)
        setProviderGeoError(message)
      },
      { mode: "explicit" },
    )
  }

  return {
    providerLocation,
    setProviderLocation,
    providerGeoLoading,
    providerGeoError,
    setProviderGeoError,
    providerRecenterTrigger,
    providerSpeedMps,
    setProviderGeoWatchEpoch,
    providerLocationRef,
    retryProviderGeolocation,
  }
}
