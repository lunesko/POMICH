import { useEffect, useRef, useState } from "react"

import type { Point } from "../../lib/constants"

import { RideScreen } from "../layout/RideScreen"

import { PrimaryButton } from "../ui/PrimaryButton"

import { StatusPill } from "../ui/StatusPill"

import { SheetHeading } from "../layout/SheetHeading"

const CANCELLED_AUTO_DISMISS_SECONDS = 15

type TerminalStatus = "completed" | "cancelled"

interface OrderFinalStepProps {
  orderId?: string
  status: TerminalStatus
  pickup: Point
  destination?: Point
  onRestart: () => void
  /** Hide in-sheet CTA when Telegram main button handles it */
  showAction?: boolean
}

interface OrderErrorStepProps {
  pickup: Point
  destination?: Point
  onRetry: () => void
  showAction?: boolean
}

const terminalCopy: Record<TerminalStatus, { title: string; message: string; icon: string }> = {
  completed: {
    title: "Заявку завершено",
    message: "Дякуємо, що скористалися POMICH. Можете створити нову заявку в будь-який момент.",
    icon: "✓",
  },
  cancelled: {
    title: "Заявку скасовано",
    message: "Заявку скасовано. Якщо потрібна допомога — створіть нову заявку.",
    icon: "✕",
  },
}

export function OrderFinalStep({
  orderId,
  status,
  pickup,
  destination,
  onRestart,
  showAction = true,
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

  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle={orderId ? `#${orderId}` : "POMICH"}>
      <div className="pomich-terminal-header">
        <SheetHeading title={copy.title} subtitle={orderId ? `Замовлення #${orderId}` : "POMICH"} />
        <StatusPill status={status} />
      </div>

      <div className={`pomich-terminal-card pomich-terminal-card--${status}`}>
        <div className={`pomich-terminal-icon pomich-terminal-icon--${status}`} aria-hidden="true">
          {copy.icon}
        </div>
        <div className="pomich-terminal-card__title">{copy.title}</div>
        <p className="pomich-terminal-card__message">{copy.message}</p>
        {status === "cancelled" && dismissCountdown !== null && dismissCountdown > 0 ? (
          <div className="pomich-terminal-card__countdown" aria-live="polite">
            Нова заявка через {dismissCountdown} сек
          </div>
        ) : null}
        {orderId ? <div className="pomich-terminal-card__meta">#{orderId}</div> : null}
      </div>

      {showAction ? (
        <div className="pomich-terminal-actions">
          <PrimaryButton label="Нова заявка" onClick={onRestart} />
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

      <div className="pomich-terminal-card pomich-terminal-card--error">
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

export default OrderFinalStep
