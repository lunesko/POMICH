import type { CSSProperties } from "react"
import { iconHref, type IconName } from "../../lib/icons"

export default function Icon({ name, size = 20, className = "", style, filled = false }: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
  filled?: boolean
}) {
  return <svg className={`pomich-icon ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24"
    aria-hidden="true" focusable="false" style={style}>
    <use href={iconHref(name)} className={filled ? "pomich-icon-use--filled" : undefined} />
  </svg>
}
