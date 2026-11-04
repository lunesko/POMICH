import Icon from "./Icon"

export default function RatingStars({ rating }: { rating: number }) {
  const value = Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0
  return <span className="pomich-rating-stars" role="img" aria-label={`${value} з 5`}>
    {Array.from({ length: 5 }, (_, index) => <Icon key={index} name="star" size={16} filled={index < value} />)}
  </span>
}

export function renderReviewStars(rating?: number) {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating < 1) return null
  return <RatingStars rating={rating} />
}
