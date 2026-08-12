import { useMapEvents } from "react-leaflet"

import type { Point } from "../../lib/constants"

interface ClickToPickProps {
  onPick?: (point: Point) => void
}

export function ClickToPick({ onPick }: ClickToPickProps) {
  useMapEvents({
    click(event) {
      onPick?.({ lat: event.latlng.lat, lng: event.latlng.lng })
    },
  })
  return null
}

export default ClickToPick
