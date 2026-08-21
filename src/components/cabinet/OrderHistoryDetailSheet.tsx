import { Suspense, lazy, useEffect } from "react"
import { createPortal } from "react-dom"

import type { OrderResponse } from "../../api/client"
import { getServiceLabel, type Point } from "../../lib/constants"
import type { ServiceKey } from "../../lib/pomichDomain"
import { formatCabinetOrderStatus, formatCabinetReviewStars } from "../customer/OrderTerminalStep"
import ServiceIcon from "../ui/ServiceIcon"
import { SecondaryButton } from "../ui/SecondaryButton"

const LazyRouteMap = lazy(() => import("../map/RouteMap"))

export type OrderHistoryViewer = "customer" | "partner"

function parseTime(value?: string): number | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

/** Duration from accept/create to complete/cancel when timestamps exist. */
export function formatOrderDuration(order: OrderResponse): string | undefined {
  const start =
    parseTime(order.acceptedAt) ??
    parseTime(order.statusHistory?.find((item) => item.status === "accepted")?.at) ??
    parseTime(order.createdAt)
  const end =
    parseTime(order.cancelledAt) ??
    parseTime(order.statusHistory?.find((item) => item.status === "completed" || item.status === "cancelled")?.at) ??
    (order.status === "completed" || order.status === "cancelled" ? parseTime(order.updatedAt) : undefined)
  if (typeof start !== "number" || typeof end !== "number" || end < start) return undefined
  const totalMinutes = Math.max(1, Math.round((end - start) / 60000))
  if (totalMinutes < 60) return `${totalMinutes} хв`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours} год ${minutes} хв` : `${hours} год`
}

function formatDateTime(value?: string): string | undefined {
  const ms = parseTime(value)
  if (typeof ms !== "number") return undefined
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms))
  } catch {
    return value
  }
}

function toPoint(value?: { lat?: number; lng?: number } | null): Point | undefined {
  if (!value) return undefined
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
  return { lat, lng }
}

/** Place partner approach point ~distanceKm from client for display when GPS snapshot is missing. */
export function estimatePartnerApproachPoint(client: Point, distanceKm: number, bearingDeg = 300): Point {
  const meters = Math.max(80, distanceKm * 1000)
  const bearing = (bearingDeg * Math.PI) / 180
  const dLat = (meters * Math.cos(bearing)) / 111_320
  const cosLat = Math.cos((client.lat * Math.PI) / 180)
  const dLng = cosLat === 0 ? 0 : (meters * Math.sin(bearing)) / (111_320 * cosLat)
  return { lat: client.lat + dLat, lng: client.lng + dLng }
}

/** Resolve A (partner) → B (client) endpoints for history map. */
export function resolveHistoryRoutePoints(order: OrderResponse): {
  client?: Point
  partner?: Point
  destination?: Point
  partnerEstimated: boolean
} {
  const client = toPoint(order.customerCoordinates)
  const destination = toPoint(order.destinationCoordinates)
  let partner = toPoint(order.assignedProvider?.location)
  let partnerEstimated = false
  if (client && !partner) {
    const km =
      typeof order.assignedProvider?.distanceKm === "number"
        ? order.assignedProvider.distanceKm
        : typeof order.distanceKm === "number"
          ? order.distanceKm
          : undefined
    if (typeof km === "number" && Number.isFinite(km) && km >= 0.05 && km <= 80) {
      partner = estimatePartnerApproachPoint(client, km)
      partnerEstimated = true
    }
  }
  return { client, partner, destination, partnerEstimated }
}

function MapFallback() {
  return <div className="pomich-history-detail__map-fallback" aria-hidden="true" />
}

export default function OrderHistoryDetailSheet({
  order,
  viewer,
  onClose,
}: {
  order: OrderResponse
  viewer: OrderHistoryViewer
  onClose: () => void
}) {
  const { client: pickup, partner: partnerPoint, destination, partnerEstimated } = resolveHistoryRoutePoints(order)
  const duration = formatOrderDuration(order)
  const counterpart =
    viewer === "customer"
      ? order.providerName || order.assignedProvider?.name
      : order.customerName
  const ownReview =
    viewer === "customer"
      ? formatCabinetReviewStars(order.customerReview?.rating)
      : formatCabinetReviewStars(order.partnerReview?.rating)
  const otherReview =
    viewer === "customer"
      ? formatCabinetReviewStars(order.partnerReview?.rating)
      : formatCabinetReviewStars(order.customerReview?.rating)
  const timeline = (order.statusHistory ?? []).filter((item) => item.status && item.at)
  const mapSubtitle = partnerPoint
    ? partnerEstimated
      ? "Маршрут A→B · орієнтовно"
      : "Маршрут A (партнер) → B (клієнт)"
    : destination
      ? "Маршрут клієнт → куди"
      : "Місце заявки"

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const sheet = (
    <div
      className="pomich-history-detail"
      role="dialog"
      aria-modal="true"
      aria-label="Деталі заявки з історії"
      onClick={onClose}
    >
      <div className="pomich-history-detail__panel" onClick={(event) => event.stopPropagation()}>
        <div className="pomich-history-detail__top">
          <div className="pomich-history-detail__handle" aria-hidden="true" />
          <button type="button" className="pomich-history-detail__close-x" onClick={onClose} aria-label="Закрити деталі">
            ✕
          </button>
        </div>

        <div className="pomich-history-detail__scroll">
          <div className="pomich-history-detail__eyebrow">
            <span className="pomich-history-detail__service-icon">
              <ServiceIcon service={(order.service as ServiceKey) || "mechanic"} size={22} />
            </span>
            {getServiceLabel(order.service)}
          </div>
          <h2 className="pomich-history-detail__title">Заявка #{order.id || "—"}</h2>
          <div className="pomich-history-detail__status">{formatCabinetOrderStatus(order.status)}</div>

          <div className="pomich-history-detail__grid">
            {typeof order.partnerProposedPrice === "number" ? (
              <div className="pomich-history-detail__stat">
                <span className="pomich-history-detail__stat-label">Ціна</span>
                <span className="pomich-history-detail__stat-value">
                  {order.partnerProposedPrice.toLocaleString("uk-UA")} ₴
                </span>
              </div>
            ) : null}
            {duration ? (
              <div className="pomich-history-detail__stat">
                <span className="pomich-history-detail__stat-label">Час виконання</span>
                <span className="pomich-history-detail__stat-value">{duration}</span>
              </div>
            ) : null}
            {typeof order.distanceKm === "number" ? (
              <div className="pomich-history-detail__stat">
                <span className="pomich-history-detail__stat-label">Відстань</span>
                <span className="pomich-history-detail__stat-value">{order.distanceKm.toFixed(1)} км</span>
              </div>
            ) : null}
            {formatDateTime(order.createdAt) ? (
              <div className="pomich-history-detail__stat">
                <span className="pomich-history-detail__stat-label">Створено</span>
                <span className="pomich-history-detail__stat-value">{formatDateTime(order.createdAt)}</span>
              </div>
            ) : null}
          </div>

          <div className="pomich-history-detail__block">
            {counterpart ? (
              <div>
                <strong>{viewer === "customer" ? "Партнер" : "Клієнт"}:</strong> {counterpart}
              </div>
            ) : null}
            {order.customerLocation ? (
              <div>
                <strong>Адреса:</strong> {order.customerLocation}
              </div>
            ) : null}
            {order.destination ? (
              <div>
                <strong>Куди:</strong> {order.destination}
              </div>
            ) : null}
            {order.vehicleState ? (
              <div>
                <strong>Авто:</strong> {order.vehicleState}
              </div>
            ) : null}
            {order.customerComment ? (
              <div>
                <strong>Коментар:</strong> {order.customerComment}
              </div>
            ) : null}
            {order.cancelReason ? (
              <div>
                <strong>Причина скасування:</strong> {order.cancelReason}
              </div>
            ) : null}
            {ownReview ? (
              <div>
                <strong>Ваша оцінка:</strong> {ownReview}
              </div>
            ) : null}
            {otherReview ? (
              <div>
                <strong>{viewer === "customer" ? "Оцінка від партнера" : "Оцінка від клієнта"}:</strong>{" "}
                {otherReview}
              </div>
            ) : null}
          </div>

          {pickup ? (
            <div className="pomich-history-detail__map" aria-label="Карта маршруту партнер клієнт">
              <Suspense fallback={<MapFallback />}>
                <LazyRouteMap
                  pickup={pickup}
                  providerPosition={partnerPoint}
                  destination={partnerPoint ? undefined : destination}
                  subtitle={mapSubtitle}
                  showBadges={false}
                  showLocateControl={false}
                  decorative
                  overlayMode={false}
                  full={false}
                />
              </Suspense>
              {partnerPoint ? (
                <div className="pomich-history-detail__map-caption">
                  A — партнер · B — клієнт{partnerEstimated ? " · орієнтовний напрямок" : ""}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="pomich-history-detail__map-empty">Координати маршруту недоступні</div>
          )}

          {timeline.length > 0 ? (
            <div className="pomich-history-detail__timeline">
              <div className="pomich-history-detail__timeline-title">Етапи</div>
              <ul>
                {timeline.map((item, index) => (
                  <li key={`${item.status}-${item.at}-${index}`}>
                    <span>{formatCabinetOrderStatus(item.status)}</span>
                    <span>{formatDateTime(item.at) ?? item.at}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="pomich-history-detail__footer">
          <SecondaryButton label="Закрити" onClick={onClose} />
        </div>
      </div>
    </div>
  )

  if (typeof document === "undefined") return sheet
  return createPortal(sheet, document.body)
}
