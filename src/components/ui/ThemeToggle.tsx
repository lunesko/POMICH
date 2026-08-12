import { usePomichTheme } from "../../context/PomichThemeProvider"

interface ThemeToggleProps {
  compact?: boolean
  className?: string
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function ThemeToggle({ compact = false, className = "" }: ThemeToggleProps) {
  const { mode, toggle } = usePomichTheme()
  const isLight = mode === "light"

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!isLight}
      aria-label={isLight ? "Увімкнено світлу тему. Натисніть для темної." : "Увімкнено темну тему. Натисніть для світлої."}
      title={isLight ? "Перемкнути на темну тему" : "Перемкнути на світлу тему"}
      onClick={toggle}
      data-active={mode}
      className={`pomich-theme-toggle${compact ? " pomich-theme-toggle--compact" : ""}${className ? ` ${className}` : ""}`}
    >
      <span className="pomich-theme-toggle__knob" aria-hidden="true" />
      <span className={`pomich-theme-toggle__icon${isLight ? " is-active" : ""}`} aria-hidden="true">
        <SunIcon />
      </span>
      <span className={`pomich-theme-toggle__icon${!isLight ? " is-active" : ""}`} aria-hidden="true">
        <MoonIcon />
      </span>
    </button>
  )
}

export default ThemeToggle
