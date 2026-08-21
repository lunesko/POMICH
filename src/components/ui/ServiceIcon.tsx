import type { ReactElement } from "react"

import type { ServiceKey } from "../../lib/pomichDomain"

const ACCENT: Record<ServiceKey, string> = {
  tow: "#0F766E",
  battery: "#1D4ED8",
  wheel: "#C2410C",
  fuel: "#7C3AED",
  lockout: "#BE185D",
  mechanic: "#4D7C0F",
}

function TowGlyph() {
  return (
    <g className="pomich-service-icon-glyph">
      <rect x="5" y="18" width="20" height="12" rx="2.2" fill="currentColor" />
      <path d="M25 20.5h8.5L38 27v3H25V20.5Z" fill="currentColor" />
      <path d="M27.5 22.2h5l2.4 3.2H27.5V22.2Z" fill="#fff" opacity="0.45" />
      <path d="M7 15.5h14l1.6 2.5H7V15.5Z" fill="currentColor" opacity="0.88" />
      <path d="M8.2 22h5M8.2 25.2h8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <circle cx="13" cy="31.5" r="3.3" fill="#0B1220" />
      <circle cx="13" cy="31.5" r="1.2" fill="#E2E8F0" />
      <circle cx="31.5" cy="31.5" r="3.3" fill="#0B1220" />
      <circle cx="31.5" cy="31.5" r="1.2" fill="#E2E8F0" />
      <circle cx="36.2" cy="26.2" r="1.15" fill="#FDE68A" />
    </g>
  )
}

function BatteryGlyph() {
  return (
    <g className="pomich-service-icon-glyph">
      <rect x="10" y="12" width="20" height="24" rx="3.2" fill="currentColor" />
      <rect x="14.5" y="8.5" width="4.2" height="3.5" rx="1" fill="currentColor" />
      <rect x="21.3" y="8.5" width="4.2" height="3.5" rx="1" fill="currentColor" />
      <path d="M16 19.5h8M20 15.5v8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="13.5" y="28.5" width="13" height="4.5" rx="1.2" fill="#fff" opacity="0.35" />
    </g>
  )
}

function WheelGlyph() {
  return (
    <g className="pomich-service-icon-glyph">
      <circle cx="20" cy="20" r="13.5" fill="currentColor" />
      <circle cx="20" cy="20" r="8.2" fill="#fff" opacity="0.22" />
      <circle cx="20" cy="20" r="4.4" fill="#0B1220" />
      <circle cx="20" cy="20" r="1.7" fill="#E2E8F0" />
      <path
        d="M20 8.2v4.2M20 27.6v4.2M8.2 20h4.2M27.6 20h4.2M12.2 12.2l3 3M24.8 24.8l3 3M27.8 12.2l-3 3M12.2 27.8l3-3"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.7"
      />
    </g>
  )
}

function FuelGlyph() {
  return (
    <g className="pomich-service-icon-glyph">
      <path
        d="M12 12.5h14c1.8 0 3.2 1.4 3.2 3.2V31c0 1.5-1.2 2.7-2.7 2.7H14.5c-1.5 0-2.7-1.2-2.7-2.7V15.7c0-1.8 1.4-3.2 3.2-3.2Z"
        fill="currentColor"
      />
      <path d="M15.5 9.5h7.5l1.8 3H13.7l1.8-3Z" fill="currentColor" opacity="0.9" />
      <path d="M16.5 17.5h7.5v10.5H16.5V17.5Z" fill="#fff" opacity="0.28" />
      <path d="M29 16.5h3.2c1.4 0 2.5 1.1 2.5 2.5V26" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="34.5" cy="27.5" r="2.2" fill="currentColor" />
    </g>
  )
}

function LockoutGlyph() {
  return (
    <g className="pomich-service-icon-glyph">
      <circle cx="16.5" cy="18" r="7.2" fill="currentColor" />
      <circle cx="16.5" cy="18" r="3.1" fill="#fff" opacity="0.35" />
      <path d="M22.5 21.5 33.5 32.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M30.2 29.2h5.2M32.8 26.6v5.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16.5" cy="18" r="1.35" fill="#0B1220" />
    </g>
  )
}

function MechanicGlyph() {
  return (
    <g className="pomich-service-icon-glyph">
      <path
        d="M12.5 10.5a7 7 0 0 1 9.2 1.2l-2.8 2.8a3.2 3.2 0 0 0-3.6-.4l-1.4 1.4a3.2 3.2 0 0 0 .4 3.6l2.8 2.8a7 7 0 0 1-9.2-1.2l2.6-2.6a1 1 0 0 0 0-1.4l-1.8-1.8a1 1 0 0 0-1.4 0l-2.6 2.6a7 7 0 0 1 1.2-9.2l2.6 2.6a1 1 0 0 0 1.4 0l1.8-1.8a1 1 0 0 0 0-1.4l-2.6-2.6Z"
        fill="currentColor"
      />
      <path d="M23.5 22.8 34 33.2" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M30.8 30h5.2M33.4 27.4v5.2" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
    </g>
  )
}

const GLYPHS: Record<ServiceKey, () => ReactElement> = {
  tow: TowGlyph,
  battery: BatteryGlyph,
  wheel: WheelGlyph,
  fuel: FuelGlyph,
  lockout: LockoutGlyph,
  mechanic: MechanicGlyph,
}

export default function ServiceIcon({
  service,
  size = 28,
  className = "",
}: {
  service: ServiceKey
  size?: number
  className?: string
}) {
  const Glyph = GLYPHS[service] ?? MechanicGlyph
  const accent = ACCENT[service] ?? ACCENT.mechanic
  return (
    <svg
      className={`pomich-service-icon-svg ${className}`.trim()}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ color: accent }}
    >
      <Glyph />
    </svg>
  )
}

export function serviceAccentColor(service: ServiceKey): string {
  return ACCENT[service] ?? ACCENT.mechanic
}
