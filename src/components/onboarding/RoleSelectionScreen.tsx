import { useId } from "react"

import { usePomichTheme } from "../../context/PomichThemeProvider"
import { mediaQueries } from "../../lib/breakpoints"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { useTelegramUx } from "../../hooks/useTelegramUx"
import type { Role } from "../../lib/constants"
import { ThemeToggle } from "../ui/ThemeToggle"

const roleStats = [
  ["24/7", "Заявка з дороги"],
  ["UA", "По всій Україні"],
  ["2 ролі", "Клієнт і партнер"],
] as const

interface RoleSelectionScreenProps {
  compact?: boolean
  saving?: boolean
  onSelect: (role: Extract<Role, "customer" | "provider">) => void
  onShowLanding?: () => void
}

function ClientCarIcon() {
  const uid = useId().replace(/:/g, "")
  const body = `pomich-client-body-${uid}`
  const glass = `pomich-client-glass-${uid}`
  const shine = `pomich-client-shine-${uid}`
  return (
    <svg
      className="pomich-role-icon-svg pomich-role-icon-svg--client"
      viewBox="0 0 80 80"
      width="44"
      height="44"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={body} x1="12" y1="28" x2="68" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A7F3D0" />
          <stop offset="0.45" stopColor="#34D399" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
        <linearGradient id={glass} x1="26" y1="24" x2="54" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F0FDFA" />
          <stop offset="1" stopColor="#6EE7B7" />
        </linearGradient>
        <linearGradient id={shine} x1="20" y1="30" x2="40" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse className="pomich-role-icon-shadow" cx="40" cy="66" rx="22" ry="4.5" fill="rgba(15,23,42,0.22)" />
      <g className="pomich-role-icon-vehicle">
        <path
          d="M16 46c1.8-10.5 9.2-17.5 24-17.5S62.2 35.5 64 46c1.5 4.8 1 9.4-.8 12H16.8C15 55.4 14.5 50.8 16 46Z"
          fill={`url(#${body})`}
        />
        <path d="M26 32.5c2.8-4.6 7.6-7 14-7s11.2 2.4 14 7" fill={`url(#${glass})`} />
        <path d="M22 40h12l2 8H20l2-8Z" fill={`url(#${shine})`} opacity="0.55" />
        <path d="M20 47.5h9M51 47.5h9" stroke="rgba(255,255,255,0.75)" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="26" cy="57.5" r="6" fill="#0F172A" />
        <circle cx="26" cy="57.5" r="2.4" fill="#E2E8F0" />
        <circle cx="54" cy="57.5" r="6" fill="#0F172A" />
        <circle cx="54" cy="57.5" r="2.4" fill="#E2E8F0" />
        <circle cx="62" cy="48" r="1.8" fill="#FDE68A" opacity="0.9" />
      </g>
    </svg>
  )
}

function PartnerTruckIcon() {
  const uid = useId().replace(/:/g, "")
  const bed = `pomich-partner-bed-${uid}`
  const cab = `pomich-partner-cab-${uid}`
  const glass = `pomich-partner-glass-${uid}`
  return (
    <svg
      className="pomich-role-icon-svg pomich-role-icon-svg--partner"
      viewBox="0 0 80 80"
      width="44"
      height="44"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bed} x1="10" y1="34" x2="46" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BFDBFE" />
          <stop offset="0.5" stopColor="#60A5FA" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
        <linearGradient id={cab} x1="44" y1="36" x2="70" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DBEAFE" />
          <stop offset="1" stopColor="#1E40AF" />
        </linearGradient>
        <linearGradient id={glass} x1="48" y1="38" x2="62" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EFF6FF" />
          <stop offset="1" stopColor="#93C5FD" />
        </linearGradient>
      </defs>
      <ellipse className="pomich-role-icon-shadow" cx="40" cy="66" rx="24" ry="4.5" fill="rgba(15,23,42,0.22)" />
      <g className="pomich-role-icon-vehicle">
        <rect x="10" y="34" width="32" height="20" rx="3.5" fill={`url(#${bed})`} />
        <path d="M42 38h14l7.5 9.5V54H42V38Z" fill={`url(#${cab})`} />
        <path d="M46 40.5h8.5l4.2 5.5H46V40.5Z" fill={`url(#${glass})`} />
        <path d="M13 30.5h22l2.4 4.5H13v-4.5Z" fill="#F8FAFC" opacity="0.95" />
        <path d="M14 42h8M14 47h12" stroke="rgba(255,255,255,0.55)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="22" cy="57.5" r="6" fill="#0F172A" />
        <circle cx="22" cy="57.5" r="2.4" fill="#E2E8F0" />
        <circle cx="54" cy="57.5" r="6" fill="#0F172A" />
        <circle cx="54" cy="57.5" r="2.4" fill="#E2E8F0" />
        <circle cx="66" cy="49" r="1.8" fill="#FDE68A" opacity="0.95" />
      </g>
    </svg>
  )
}

const roleCards = [
  {
    key: "customer" as const,
    title: "Я клієнт",
    eyebrow: "Водіям",
    description: "Потрібна допомога на дорозі — евакуатор, акумулятор, колесо чи пальне.",
    accentVar: "--pomich-accent",
    tone: "client" as const,
    Icon: ClientCarIcon,
  },
  {
    key: "provider" as const,
    title: "Я партнер",
    eyebrow: "Партнерам",
    description: "Надаю послуги автодопомоги та приймаю заявки поруч із собою.",
    accentVar: "--pomich-accent-blue",
    tone: "partner" as const,
    Icon: PartnerTruckIcon,
  },
] as const

function LiveBadge({ label }: { label: string }) {
  return (
    <span className="pomich-role-badge">
      <span className="pomich-role-badge__dot" aria-hidden="true" />
      {label}
    </span>
  )
}

export default function RoleSelectionScreen({
  compact,
  saving = false,
  onSelect,
  onShowLanding,
}: RoleSelectionScreenProps) {
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isCompact = compact ?? isMobile
  const { haptic } = useTelegramUx()
  const { isDark, colors } = usePomichTheme()

  const handleSelect = (role: Extract<Role, "customer" | "provider">) => {
    if (saving) return
    haptic("medium")
    onSelect(role)
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden pomich-role-select" style={{ color: colors.text }}>
      <header
        className={`relative z-10 flex items-center justify-between ${isCompact ? "px-[18px] pt-4" : "px-7 pt-5"}`}
        style={{ paddingTop: "calc(16px + env(safe-area-inset-top, 0px))" }}
      >
        <div className="inline-flex items-center gap-3 font-extrabold">
          <span className="pomich-role-brand-mark" aria-hidden="true">
            P
          </span>
          <span className="pomich-role-brand-wordmark text-xl">POMICH</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeToggle compact={isCompact} />
          {onShowLanding ? (
            <button
              type="button"
              onClick={() => {
                haptic("light")
                onShowLanding()
              }}
              className="pomich-ghost-btn min-h-[42px] rounded-xl px-4 text-sm"
            >
              Про сервіс
            </button>
          ) : null}
        </div>
      </header>

      <div
        className={`relative z-[2] flex min-h-[calc(100dvh-58px)] flex-col items-center justify-center ${
          isCompact ? "px-[18px] pb-8 pt-5" : "px-6 pb-14 pt-8"
        }`}
        style={{ paddingBottom: "calc(32px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="w-full max-w-[520px] text-center">
          <div className="pomich-map-copy-plate pomich-role-hero-plate" style={{ marginBottom: 14 }}>
            <LiveBadge label="Український roadside assistance marketplace" />
            <h1
              className={`pomich-role-hero-title mt-4 font-extrabold leading-[1.02] ${
                isCompact ? "text-[32px]" : "text-[clamp(34px,5vw,48px)]"
              }`}
            >
              Ласкаво просимо до
              <br />
              <span className="pomich-brand-gradient-text">POMICH</span>
            </h1>
            <p
              className={`mx-auto mt-3.5 max-w-[420px] font-bold leading-relaxed ${isCompact ? "text-[15px]" : "text-[17px]"}`}
              style={{ color: isDark ? "rgba(226,232,240,0.95)" : "#1e293b" }}
            >
              Оберіть, як ви користуєтесь сервісом. Пізніше можна змінити роль у кабінеті.
            </p>
            <div className="mt-3 text-sm font-extrabold" style={{ color: colors.badgeText }}>
              Оберіть вашу роль
            </div>
          </div>

          <div className="pomich-role-card-stack mt-3 grid gap-3.5">
            {roleCards.map((card, index) => {
              const Icon = card.Icon
              return (
                <button
                  key={card.key}
                  type="button"
                  disabled={saving}
                  onClick={() => handleSelect(card.key)}
                  className={`pomich-role-card pomich-role-card--${card.tone} w-full disabled:opacity-60`}
                  style={{ animationDelay: `${120 + index * 90}ms` }}
                >
                  <span className="pomich-role-card__shine" aria-hidden="true" />
                  <div className="flex items-start gap-3.5">
                    <div className={`pomich-role-icon pomich-role-icon--${card.tone}`}>
                      <span className="pomich-role-icon__glow" aria-hidden="true" />
                      <Icon />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="text-xs font-extrabold tracking-wide" style={{ color: `var(${card.accentVar})` }}>
                        {card.eyebrow}
                      </div>
                      <div className="pomich-role-card__title mt-1 text-lg font-extrabold">{card.title}</div>
                      <div
                        className="mt-2 text-sm font-bold leading-snug"
                        style={{ color: "var(--pomich-role-card-muted)" }}
                      >
                        {card.description}
                      </div>
                    </div>
                    <span className="pomich-role-card__chevron self-center" aria-hidden="true">
                      →
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <a href="https://t.me/pomich_ua_bot" target="_blank" rel="noreferrer" className="mt-3.5 block no-underline">
            <div className="pomich-ghost-btn flex min-h-[50px] items-center justify-center gap-2.5 rounded-xl px-4 text-sm">
              <span className="text-lg" aria-hidden="true">
                ✈
              </span>
              Відкрити @pomich_ua_bot у Telegram
            </div>
          </a>

          <div
            className={`pomich-map-copy-plate pomich-role-stats mx-auto mt-8 grid max-w-[480px] grid-cols-3 gap-2.5 ${
              isCompact ? "" : "gap-5"
            }`}
            style={{ padding: isCompact ? "12px 10px" : "14px 16px" }}
          >
            {roleStats.map(([value, label], index) => (
              <div key={value} className="pomich-role-stat" style={{ animationDelay: `${320 + index * 70}ms` }}>
                <div
                  className={`font-extrabold ${isCompact ? "text-[22px]" : "text-[28px]"}`}
                  style={{ color: isDark ? "#FACC15" : colors.brand }}
                >
                  {value}
                </div>
                <div
                  className={`mt-1 font-extrabold ${isCompact ? "text-[10px]" : "text-xs"}`}
                  style={{ color: isDark ? "rgba(226,232,240,0.9)" : "#334155" }}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
