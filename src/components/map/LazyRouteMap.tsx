import { Suspense, lazy, type ComponentProps } from "react"

const RouteMapLazy = lazy(() => import("./RouteMap"))

function MapPlaceholder({ full }: { full?: boolean }) {
  return (
    <div
      className="pomich-route-map pomich-route-map--loading"
      style={{
        height: full ? "100%" : 244,
        minHeight: full ? 0 : undefined,
        background: "var(--pomich-subtle, #e8edf2)",
        borderRadius: full ? 0 : 22,
      }}
      aria-hidden="true"
    />
  )
}

export default function LazyRouteMap(props: ComponentProps<typeof RouteMapLazy>) {
  return (
    <Suspense fallback={<MapPlaceholder full={props.full} />}>
      <RouteMapLazy {...props} />
    </Suspense>
  )
}
