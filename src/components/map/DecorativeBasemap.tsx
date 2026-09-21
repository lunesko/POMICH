/** Seamless static Ukraine basemap — no Leaflet tiles, so no square seams on iOS Safari. */
export default function DecorativeBasemap({ className = "" }: { className?: string }) {
  return (
    <div className={`pomich-decorative-basemap ${className}`.trim()} aria-hidden="true">
      <img
        className="pomich-decorative-basemap__img"
        src="/maps/ukraine-basemap.webp"
        alt=""
        decoding="async"
        fetchPriority="low"
        onError={(event) => {
          const img = event.currentTarget
          if (img.dataset.fallbackTried === "1") {
            img.style.display = "none"
            return
          }
          img.dataset.fallbackTried = "1"
          if (img.src.endsWith(".webp")) {
            img.src = "/maps/ukraine-basemap.jpg"
            return
          }
          img.style.display = "none"
        }}
      />
    </div>
  )
}
