import { type OrderStatus, orderStatusLabels } from "../../lib/constants"

interface StatusPillProps {
  status: OrderStatus
}

export function StatusPill({ status }: StatusPillProps) {
  const cancelled = status === "cancelled"
  return (
    <div className={`pomich-status-pill ${cancelled ? "pomich-status-pill--cancelled" : "pomich-status-pill--active"}`}>
      <span className="pomich-status-pill__dot" />
      {orderStatusLabels[status]}
    </div>
  )
}

export default StatusPill
