interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export default function RememberSessionField({ checked, onChange, disabled }: Props) {
  return (
    <div className="pomich-remember-session">
      <label>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
        <span>Залишатися в системі</span>
      </label>
      <p className="pomich-cabinet-help-text">
        {checked
          ? "Вхід збережеться на 30 днів від цього входу. Обирайте лише на власному пристрої."
          : "Без галочки: до закриття браузера, але не довше 12 годин. Браузер може відновити сесію після перезапуску."}
      </p>
    </div>
  )
}
