import { useEffect, useRef, useState } from "react"

import type { OrderResponse } from "../../api/client"
import type { Point } from "../../lib/constants"
import { orderStatusLabels, type OrderStatus } from "../../lib/constants"

import { RideScreen } from "../layout/RideScreen"
import { SheetHeading } from "../layout/SheetHeading"
import { OrderReviewDone, OrderReviewPanel, OrderReviewSkippedHint } from "../ui/OrderReviewPanel"
import { PrimaryButton } from "../ui/PrimaryButton"
import { SecondaryButton } from "../ui/SecondaryButton"
import { StatusPill } from "../ui/StatusPill"

const CANCELLED_AUTO_DISMISS_SECONDS = 15

type TerminalStatus = "completed" | "cancelled"

interface OrderFinalStepProps {
  orderId?: string
  status: TerminalStatus
  pickup: Point
  destination?: Point
  order?: OrderResponse
  onRestart: () => void
  /** Full logout — must work even if review is pending */
  onLogout?: () => void
  /** Hide in-sheet CTA when Telegram main button handles it */
  showAction?: boolean
  /** When set, show stars review (skippable — never block logout / continue) */
  reviewMode?: "customer" | "partner" | null
  reviewTargetName?: string
  reviewSaving?: boolean
  reviewError?: string
  reviewSubmitted?: boolean
  onSubmitReview?: (payload: { rating: number; comment: string }) => void | Promise<void>
}

interface OrderErrorStepProps {
  pickup: Point
  destination?: Point
  onRetry: () => void
  showAction?: boolean
}

const terminalCopy: Record<TerminalStatus, { title: string; message: string; icon: string }> = {
  completed: {
    title: "Замовлення завершено",
    message: "Дякуємо, що скористалися POMICH. Оцініть досвід — це допомагає покращити сервіс.",
    icon: "✓",
  },
  cancelled: {
    title: "Заявку скасовано",
    message: "Заявку скасовано. Якщо потрібна допомога — створіть нову заявку.",
    icon: "✕",
  },
}

function formatAmount(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return `${value.toLocaleString("uk-UA")} ₴`
}

export function OrderFinalStep({
  orderId,
  status,
  pickup,
  destination,
  order,
  onRestart,
  onLogout,
  showAction = true,
  reviewMode = null,
  reviewTargetName,
  reviewSaving = false,
  reviewError,
  reviewSubmitted = false,
  onSubmitReview,
}: OrderFinalStepProps) {
  const copy = terminalCopy[status]
  const onRestartRef = useRef(onRestart)
  onRestartRef.current = onRestart

  const intervalRef = useRef<number | null>(null)
  const dismissedRef = useRef(false)

  const [dismissCountdown, setDismissCountdown] = useState<number | null>(
    status === "cancelled" ? CANCELLED_AUTO_DISMISS_SECONDS : null,
  )

  useEffect(() => {
    if (status !== "cancelled") {
      setDismissCountdown(null)
      return
    }

    dismissedRef.current = false
    setDismissCountdown(CANCELLED_AUTO_DISMISS_SECONDS)
    const startedAt = Date.now()

    intervalRef.current = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
      const remaining = CANCELLED_AUTO_DISMISS_SECONDS - elapsedSeconds
      if (remaining <= 0) {
        if (intervalRef.current !== null) {
          window.clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        setDismissCountdown(0)
        if (!dismissedRef.current) {
          dismissedRef.current = true
          onRestartRef.current()
        }
        return
      }
      setDismissCountdown(remaining)
    }, 1000)

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [status, orderId])

  const amount = formatAmount(order?.partnerProposedPrice)
  const partnerName = order?.providerName || order?.assignedProvider?.name || reviewTargetName
  const clientName = order?.customerName || reviewTargetName
  const continueLabel = reviewMode === "partner" ? "Повернутись до чергування" : "Нова заявка"
  const needsReview = status === "completed" && Boolean(reviewMode) && Boolean(onSubmitReview)
  const canContinue = !needsReview || reviewSubmitted

  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle={orderId ? `#${orderId}` : "POMICH"}>
      <div className="pomich-terminal-header">
        <SheetHeading title={copy.title} subtitle={orderId ? `Замовлення #${orderId}` : "POMICH"} />
        <StatusPill status={status} />
      </div>

      <div className={`pomich-terminal-card pomich-terminal-card--${status} pomich-terminal-card--solid`}>
        <div className={`pomich-terminal-icon pomich-terminal-icon--${status}`} aria-hidden="true">
          {copy.icon}
        </div>
        <div className="pomich-terminal-card__title">{copy.title}</div>
        <p className="pomich-terminal-card__message">{copy.message}</p>

        {status === "completed" ? (
          <div className="pomich-terminal-summary">
            {orderId ? (
              <div className="pomich-terminal-summary__row">
                <span>Замовлення</span>
                <strong>#{orderId}</strong>
              </div>
            ) : null}
            {amount ? (
              <div className="pomich-terminal-summary__row pomich-terminal-summary__row--accent">
                <span>{reviewMode === "partner" ? "Ваш дохід" : "Сума"}</span>
                <strong>{amount}</strong>
              </div>
            ) : null}
            {reviewMode === "customer" && partnerName ? (
              <div className="pomich-terminal-summary__row">
                <span>Партнер</span>
                <strong>{partnerName}</strong>
              </div>
            ) : null}
            {reviewMode === "partner" && clientName ? (
              <div className="pomich-terminal-summary__row">
                <span>Клієнт</span>
                <strong>{clientName}</strong>
              </div>
            ) : null}
            {order?.customerReview?.rating ? (
              <div className="pomich-terminal-summary__row">
                <span>{reviewMode === "partner" ? "Оцінка від клієнта" : "Ваша оцінка партнера"}</span>
                <strong>{"★".repeat(order.customerReview.rating)}</strong>
              </div>
            ) : null}
            {order?.partnerReview?.rating ? (
              <div className="pomich-terminal-summary__row">
                <span>{reviewMode === "customer" ? "Оцінка від партнера" : "Ваша оцінка клієнта"}</span>
                <strong>{"★".repeat(order.partnerReview.rating)}</strong>
              </div>
            ) : null}
          </div>
        ) : null}

        {status === "cancelled" && dismissCountdown !== null && dismissCountdown > 0 ? (
          <div className="pomich-terminal-card__countdown" aria-live="polite">
            Нова заявка через {dismissCountdown} сек
          </div>
        ) : null}
        {orderId && status !== "completed" ? <div className="pomich-terminal-card__meta">#{orderId}</div> : null}
      </div>

      {needsReview && !reviewSubmitted && onSubmitReview ? (
        <OrderReviewPanel
          title={reviewMode === "partner" ? "Оцініть клієнта" : "Оцініть партнера"}
          subtitle={
            reviewMode === "partner"
              ? `Як пройшла співпраця з ${clientName || "клієнтом"}?`
              : `Як працював ${partnerName || "партнер"}?`
          }
          saving={reviewSaving}
          error={reviewError}
          onSubmit={onSubmitReview}
        />
      ) : null}

      {needsReview && reviewSubmitted ? (
        <OrderReviewDone onContinue={onRestart} continueLabel={continueLabel} />
      ) : null}

      {/* Never trap on review — skip + logout always available (incl. Telegram). */}
      {needsReview && !reviewSubmitted ? (
        <div className="pomich-terminal-actions" style={{ display: "grid", gap: 10 }}>
          <OrderReviewSkippedHint onContinue={onRestart} continueLabel={continueLabel} />
          {onLogout ? <SecondaryButton label="Вийти з акаунту" onClick={onLogout} /> : null}
        </div>
      ) : null}

      {showAction && canContinue && !needsReview ? (
        <div className="pomich-terminal-actions" style={{ display: "grid", gap: 10 }}>
          <PrimaryButton label={continueLabel} onClick={onRestart} />
          {onLogout ? <SecondaryButton label="Вийти з акаунту" onClick={onLogout} /> : null}
        </div>
      ) : null}

      {((needsReview && reviewSubmitted) || (!showAction && canContinue && !needsReview)) && onLogout ? (
        <div className="pomich-terminal-actions" style={{ marginTop: 8, display: "grid", gap: 10 }}>
          {!showAction && canContinue ? <PrimaryButton label={continueLabel} onClick={onRestart} /> : null}
          <SecondaryButton label="Вийти з акаунту" onClick={onLogout} />
        </div>
      ) : null}
    </RideScreen>
  )
}

export function OrderErrorStep({ pickup, destination, onRetry, showAction = true }: OrderErrorStepProps) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle="Помилка заявки">
      <div className="pomich-terminal-header">
        <SheetHeading title="Не вдалося створити заявку" subtitle="Перевірте підключення та спробуйте ще раз" />
      </div>

      <div className="pomich-terminal-card pomich-terminal-card--error pomich-terminal-card--solid">
        <div className="pomich-terminal-icon pomich-terminal-icon--error" aria-hidden="true">
          ⚠
        </div>
        <div className="pomich-terminal-card__title">Щось пішло не так</div>
        <p className="pomich-terminal-card__message">
          Не вдалося надіслати заявку. Перевірте інтернет-з&apos;єднання або спробуйте пізніше.
        </p>
      </div>

      {showAction ? (
        <div className="pomich-terminal-actions">
          <PrimaryButton label="Повторити" onClick={onRetry} />
        </div>
      ) : null}
    </RideScreen>
  )
}

export function formatCabinetOrderStatus(status?: string): string {
  const normalized = (status || "").trim() as OrderStatus
  if (normalized === "completed") return "Виконано"
  if (normalized === "cancelled") return "Скасовано"
  return orderStatusLabels[normalized] || status || "—"
}

export function formatCabinetReviewStars(rating?: number): string | null {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating < 1) return null
  const stars = Math.max(1, Math.min(5, Math.round(rating)))
  return "★".repeat(stars)
}

export default OrderFinalStep
