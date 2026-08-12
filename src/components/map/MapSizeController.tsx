import { useEffect } from "react"
import { useMap } from "react-leaflet"

export function MapSizeController() {
  const map = useMap()

  useEffect(() => {
    const invalidate = () => map.invalidateSize(false)
    const timeoutId = window.setTimeout(invalidate, 0)
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(invalidate) : undefined
    observer?.observe(map.getContainer())

    return () => {
      window.clearTimeout(timeoutId)
      observer?.disconnect()
    }
  }, [map])

  return null
}

export default MapSizeController
