import { useState } from "react"

import { PrimaryButton } from "./PrimaryButton"
import { SecondaryButton } from "./SecondaryButton"

interface OrderReviewPanelProps {
  title: string
  subtitle?: string
  saving?: boolean
  error?: string
  onSubmit: (payload: { rating: number; comment: string }) => void | Promise<void>
}

export function OrderReviewPanel({ title, subtitle, saving = false, error, onSubmit }: OrderReviewPanelProps) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")

  return (
    <div className="pomich-review-panel">
      <div className="pomich-review-panel__title">{title}</div>
      {subtitle ? <div className="pomich-review-panel__subtitle">{subtitle}</div> : null}
      <div className="pomich-review-stars" role="radiogroup" aria-label="Оцінка">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} з 5`}
            className={`pomich-review-star${rating >= value ? " is-active" : ""}`}
            onClick={() => setRating(value)}
            disabled={saving}
          >
            ★
          </button>
        ))}
      </div>
      <label className="pomich-review-comment-label" htmlFor="pomich-review-comment">
        Коментар (необов&apos;язково)
      </label>
      <textarea
        id="pomich-review-comment"
        className="pomich-comment-field"
        rows={3}
        maxLength={500}
        value={comment}
        disabled={saving}
        placeholder="Коротко опишіть враження"
        onChange={(event) => setComment(event.target.value)}
        onFocus={(event) => {
          if (typeof event.target?.scrollIntoView === "function") {
            setTimeout(() => event.target.scrollIntoView({ behavior: "smooth", block: "center" }), 150)
          }
        }}
      />
      {error ? <div className="pomich-form-error" style={{ marginTop: 10 }}>{error}</div> : null}
      <div className="pomich-review-panel__actions">
        <PrimaryButton
          label={saving ? "Надсилаємо…" : "Надіслати оцінку"}
          disabled={saving || rating < 1}
          onClick={() => void onSubmit({ rating, comment: comment.trim() })}
        />
      </div>
    </div>
  )
}

export function OrderReviewDone({ onContinue, continueLabel }: { onContinue: () => void; continueLabel: string }) {
  return (
    <div className="pomich-review-panel pomich-review-panel--done">
      <div className="pomich-review-panel__title">Дякуємо за оцінку</div>
      <div className="pomich-review-panel__subtitle">Ваш відгук збережено.</div>
      <div className="pomich-review-panel__actions">
        <PrimaryButton label={continueLabel} onClick={onContinue} />
      </div>
    </div>
  )
}

export function OrderReviewSkippedHint({ onContinue, continueLabel }: { onContinue: () => void; continueLabel: string }) {
  return (
    <div className="pomich-review-panel__actions">
      <SecondaryButton label={continueLabel} onClick={onContinue} />
    </div>
  )
}

export default OrderReviewPanel
