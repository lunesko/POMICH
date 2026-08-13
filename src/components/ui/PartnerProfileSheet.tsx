import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import {
  getProviderPublicProfile,
  messageFromFetchError,
  type ProviderAvailability,
  type ProviderPublicProfile,
  type ProviderPublicReview,
} from "../../api/client"
import { getProviderCapabilityLabel, toServiceKeys } from "../../lib/constants"
import { mediaQueries } from "../../lib/breakpoints"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { getTelegramContext } from "../../telegram"
import { VerificationPill } from "./VerificationPill"

const PROFILE_FETCH_TIMEOUT_MS = 8000

function formatReviewDate(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("uk-UA", { day: "numeric", month: "short", year: "numeric" })
}

function ReviewRow({ review }: { review: ProviderPublicReview }) {
  const stars = Math.max(1, Math.min(5, Number(review.rating) || 0))
  return (
    <div className="pomich-partner-profile-sheet__review">
      <div className="pomich-partner-profile-sheet__review-head">
        <span className="pomich-partner-profile-sheet__stars" aria-label={`${stars} з 5`}>
          {"★".repeat(stars)}
          <span className="pomich-partner-profile-sheet__stars-empty">{"★".repeat(5 - stars)}</span>
        </span>
        {review.service ? (
          <span className="pomich-partner-profile-sheet__review-service">{getProviderCapabilityLabel(review.service)}</span>
        ) : null}
      </div>
      {review.comment ? <p className="pomich-partner-profile-sheet__review-comment">{review.comment}</p> : null}
      {review.at ? <div className="pomich-partner-profile-sheet__review-date">{formatReviewDate(review.at)}</div> : null}
    </div>
  )
}

export function PartnerProfileSheet({
  provider,
  onClose,
}: {
  provider: ProviderAvailability
  onClose: () => void
}) {
  const isDesktop = useMediaQuery(mediaQueries.desktop)
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTelegram = useMemo(() => getTelegramContext().isTelegram, [])
  const compactChrome = useMemo(() => {
    if (typeof document === "undefined") return isTelegram || isMobile
    const root = document.documentElement
    return (
      isTelegram ||
      isMobile ||
      root.classList.contains("tg-compact") ||
      root.classList.contains("mobile-compact")
    )
  }, [isTelegram, isMobile])
  /* Match RideScreen: side card only on wide desktop browsers, never TG / phone. */
  const useSidePanel = isDesktop && !compactChrome
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [card, setCard] = useState<ProviderPublicProfile | undefined>()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    setCard(undefined)

    const isDirectoryEntry = provider.providerKind === "directory"

    if (isDirectoryEntry) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), PROFILE_FETCH_TIMEOUT_MS)

    getProviderPublicProfile(provider.id, 20, controller.signal)
      .then((payload) => {
        if (!cancelled) setCard(payload)
      })
      .catch((err) => {
        if (cancelled) return
        const timedOut = err instanceof DOMException && err.name === "AbortError"
        setError(
          timedOut
            ? "Завантаження профілю занадто довге. Спробуйте ще раз пізніше."
            : messageFromFetchError(err, "Не вдалося завантажити профіль партнера."),
        )
        setCard(undefined)
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [provider.id, provider.providerKind])

  const name = card?.name || provider.name || "Партнер POMICH"
  const rating = typeof card?.rating === "number" ? card.rating : provider.rating
  const ratingCount = card?.ratingCount ?? provider.ratingCount
  const specialties = toServiceKeys(card?.specialties?.length ? card.specialties : provider.specialties)
  const vehicle = card?.vehicle || provider.vehicle
  const eta = card?.etaMinutes ?? provider.etaMinutes
  const distanceKm = provider.distanceKm
  const verificationStatus = card?.verificationStatus ?? provider.verificationStatus
  const reviews = card?.reviews ?? []
  const phone = card?.phone || provider.phone
  const isDirectory = (card?.providerKind || provider.providerKind) === "directory"

  useEffect(() => {
    if (typeof document === "undefined") return
    const { body } = document
    const prevOverflow = body.style.overflow
    body.style.overflow = "hidden"
    return () => {
      body.style.overflow = prevOverflow
    }
  }, [])

  const sheet = (
    <div
      className={`pomich-partner-profile-sheet${useSidePanel ? " pomich-partner-profile-sheet--desktop" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Профіль партнера ${name}`}
      onClick={onClose}
    >
      <div className="pomich-partner-profile-sheet__panel" onClick={(event) => event.stopPropagation()}>
        <div className="pomich-partner-profile-sheet__scroll">
          {!useSidePanel ? <div className="pomich-partner-profile-sheet__handle" aria-hidden="true" /> : null}
          <div className="pomich-partner-profile-sheet__header">
            <div>
              <div className="pomich-partner-profile-sheet__title">{name}</div>
              <div className="pomich-partner-profile-sheet__meta">
                {typeof rating === "number" ? `★ ${rating.toFixed(1)}` : "Без рейтингу"}
                {typeof ratingCount === "number" && ratingCount > 0 ? ` · ${ratingCount} оцінок` : ""}
                {typeof distanceKm === "number" ? ` · ${distanceKm.toFixed(1)} км` : ""}
                {eta ? ` · ~${eta} хв` : ""}
              </div>
              {verificationStatus ? (
                <div className="pomich-partner-profile-sheet__pill">
                  <VerificationPill status={verificationStatus} />
                </div>
              ) : null}
            </div>
            <button type="button" className="pomich-partner-profile-sheet__close" onClick={onClose} aria-label="Закрити">
              ✕
            </button>
          </div>

          {vehicle ? <div className="pomich-partner-profile-sheet__vehicle">{vehicle}</div> : null}
          {provider.address || card?.address ? (
            <div className="pomich-partner-profile-sheet__address">{card?.address || provider.address}</div>
          ) : null}

          {specialties.length > 0 ? (
            <div className="pomich-partner-profile-sheet__tags">
              {specialties.map((service) => (
                <span key={service}>{getProviderCapabilityLabel(service)}</span>
              ))}
            </div>
          ) : null}

          {phone ? (
            <a className="pomich-partner-profile-sheet__phone" href={`tel:${phone}`}>
              📞 {phone}
            </a>
          ) : null}

          <div className="pomich-partner-profile-sheet__section-title">Відгуки клієнтів</div>
          {loading ? (
            <div className="pomich-partner-profile-sheet__empty">Завантажуємо відгуки…</div>
          ) : error ? (
            <div className="pomich-partner-profile-sheet__error">{error}</div>
          ) : reviews.length === 0 ? (
            <div className="pomich-partner-profile-sheet__empty">
              {isDirectory
                ? "Це запис із довідника — відгуків POMICH ще немає."
                : "Поки немає відгуків. Після завершених замовлень тут зʼявляться оцінки клієнтів."}
            </div>
          ) : (
            <div className="pomich-partner-profile-sheet__reviews">
              {reviews.map((review, index) => (
                <ReviewRow key={`${review.at ?? "r"}-${index}`} review={review} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (typeof document === "undefined") return sheet
  return createPortal(sheet, document.body)
}

export default PartnerProfileSheet
