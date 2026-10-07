

export default function StepBadge({ step, total, label }: { step: number; total?: number; label: string }) {
  return (
    <div className="pomich-step-badge">
      Крок {step}{total ? ` з ${total}` : ""} · {label}
    </div>
  )
}
