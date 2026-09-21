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
          if (img.dataset.fallback === "jpg") {
            // Both formats failed (often Git LFS pointer on server) — hide broken-icon glyph.
            img.style.display = "none"
            return
          }
          img.dataset.fallback = "jpg"
          img.src = "/maps/ukraine-basemap.jpg"
        }}
      />
    </div>
  )
}
