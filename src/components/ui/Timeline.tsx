import { BORDER, BRAND, DARK, type OrderStatus } from "../../lib/constants"

interface TimelineProps {
  status: OrderStatus
}

export function Timeline({ status }: TimelineProps) {
  const steps: Array<{ status: OrderStatus; label: string }> = [
    { status: "searching", label: "Пошук" },
    { status: "accepted", label: "Ціна" },
    { status: "price_confirmed", label: "Підтверджено" },
    { status: "en_route", label: "У дорозі" },
    { status: "arrived", label: "На місці" },
    { status: "in_progress", label: "Робота" },
    { status: "completed", label: "Готово" },
  ]
  const currentIndex = status === "cancelled" ? -1 : Math.max(0, steps.findIndex((step) => step.status === status))

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 6 }}>
      {steps.map((step, index) => {
        const active = index <= currentIndex
        return (
          <div key={step.status} style={{ minWidth: 0 }}>
            <div style={{ height: 5, borderRadius: 999, background: active ? BRAND : BORDER }} />
            <div style={{ marginTop: 5, fontSize: 10, color: active ? DARK : "var(--pomich-subtle)", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{step.label}</div>
          </div>
        )
      })}
    </div>
  )
}

export default Timeline
