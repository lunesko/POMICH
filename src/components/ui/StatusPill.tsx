import { type OrderStatus, orderStatusLabels } from "../../lib/constants"
import Icon from "./Icon"
import type { IconName } from "../../lib/icons"

export function StatusPill({ status }: { status: OrderStatus }) {
  const tone = status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : status === "draft" ? "draft" : status === "searching" ? "searching" : "active"
  const icon: IconName = tone === "completed" ? "check" : tone === "cancelled" ? "close" : tone === "draft" ? "clipboard" : "clock"
  return <div className={`pomich-status-pill pomich-status-pill--${tone}`}>
    <Icon name={icon} size={16} />
    {orderStatusLabels[status]}
  </div>
}

export default StatusPill
