

export default function StepBack({ onBack, hide = false }: { onBack: () => void; hide?: boolean }) {
  if (hide) return null
  return (
    <button type="button" onClick={onBack} className="pomich-step-back">← Назад</button>
  )
}
