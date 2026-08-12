import { BRAND, type OrderStatus, orderStatusLabels } from "../../lib/constants"

interface StatusPillProps {
  status: OrderStatus
}

export function StatusPill({ status }: StatusPillProps) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "7px 10px", background: status === "cancelled" ? "#FFF1F2" : "#E8F8F1", color: status === "cancelled" ? "#BE123C" : BRAND, fontSize: 12, fontWeight: 900 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "currentColor" }} />
      {orderStatusLabels[status]}
    </div>
  )
}

export default StatusPill
