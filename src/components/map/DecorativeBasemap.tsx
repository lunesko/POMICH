import { useState } from "react"

/** Seamless static Ukraine basemap — one raster, no Leaflet tile seams on iOS Safari. */
export default function DecorativeBasemap({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<"webp" | "jpg" | "css">("webp")

  if (mode === "css") {
    return (
      <div
        className={`pomich-decorative-basemap pomich-decorative-basemap--css ${className}`.trim()}
        aria-hidden="true"
      />
    )
  }

  return (
    <div className={`pomich-decorative-basemap ${className}`.trim()} aria-hidden="true">
      <img
        className="pomich-decorative-basemap__img"
        src={mode === "webp" ? "/maps/ukraine-basemap.webp" : "/maps/ukraine-basemap.jpg"}
        alt=""
        decoding="async"
        fetchPriority="high"
        onError={() => {
          setMode((current) => (current === "webp" ? "jpg" : "css"))
        }}
      />
    </div>
  )
}
