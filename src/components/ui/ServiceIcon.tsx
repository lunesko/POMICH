import { serviceIconHref, resolveServiceIcon } from "../../lib/icons"
import type { ServiceKey } from "../../lib/pomichDomain"

const ACCENT: Record<ServiceKey, string> = {
  tow: "#0F766E",
  battery: "#1D4ED8",
  wheel: "#C2410C",
  fuel: "#7C3AED",
  lockout: "#BE185D",
  mechanic: "#4D7C0F",
}

export default function ServiceIcon({ service, size = 28, className = "" }: {
  service?: string
  size?: number
  className?: string
}) {
  const key = resolveServiceIcon(service)
  return <svg className={`pomich-icon pomich-service-icon-svg ${className}`.trim()} viewBox="0 0 40 40"
    width={size} height={size} aria-hidden="true" focusable="false" style={{ color: ACCENT[key] }}>
    <use href={serviceIconHref(key)} />
  </svg>
}

export function serviceAccentColor(service: ServiceKey): string {
  return ACCENT[service] ?? ACCENT.mechanic
}
