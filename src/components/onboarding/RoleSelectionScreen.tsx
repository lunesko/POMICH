import { usePomichTheme } from "../../context/PomichThemeProvider"
import { mediaQueries } from "../../lib/breakpoints"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { useTelegramUx } from "../../hooks/useTelegramUx"
import type { Role } from "../../lib/constants"
import { ThemeToggle } from "../ui/ThemeToggle"

const roleStats = [
  ["24/7", "Заявка"],
  ["UA", "Україна"],
  ["2", "Ролі"],
] as const

interface RoleSelectionScreenProps {
  compact?: boolean
  saving?: boolean
  onSelect: (role: Extract<Role, "customer" | "provider">) => void
  onShowLanding?: () => void
}

/** Lucide map-pinned — ISC https://lucide.dev/icons/map-pinned */
function ClientRoleIcon() {
  return (
    <svg
      className="pomich-role-icon-svg pomich-role-icon-svg--client"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className="pomich-role-icon-glyph">
        <path d="M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0" />
        <circle cx="12" cy="8" r="2" />
        <path d="M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712" />
      </g>
    </svg>
  )
}

/** Lucide wrench — ISC https://lucide.dev/icons/wrench */
function PartnerRoleIcon() {
  return (
    <svg
      className="pomich-role-icon-svg pomich-role-icon-svg--partner"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className="pomich-role-icon-glyph">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </g>
    </svg>
  )
}

const roleCards = [
  {
    key: "customer" as const,
    title: "Я клієнт",
    eyebrow: "Водіям",
    description: "Евакуатор · АКБ · колесо · пальне",
    accentVar: "--pomich-accent",
    tone: "client" as const,
    Icon: ClientRoleIcon,
  },
  {
    key: "provider" as const,
    title: "Я партнер",
    eyebrow: "Партнерам",
    description: "Приймаю заявки поруч із собою",
    accentVar: "--pomich-accent-blue",
    tone: "partner" as const,
    Icon: PartnerRoleIcon,
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
        className={`relative z-10 flex items-center justify-between ${isCompact ? "px-3.5 pt-3" : "px-6 pt-4"}`}
        style={{ paddingTop: "calc(10px + env(safe-area-inset-top, 0px))" }}
      >
        <div className="inline-flex items-center gap-2 font-extrabold">
          <span className="pomich-role-brand-mark" aria-hidden="true">
            P
          </span>
          <span className="pomich-role-brand-wordmark text-base">POMICH</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ThemeToggle compact />
          {onShowLanding ? (
            <button
              type="button"
              onClick={() => {
                haptic("light")
                onShowLanding()
              }}
              className="pomich-ghost-btn pomich-role-header-link"
            >
              Про сервіс
            </button>
          ) : null}
        </div>
      </header>

      <div
        className={`relative z-[2] flex min-h-[calc(100dvh-48px)] flex-col items-center justify-center ${
          isCompact ? "px-3.5 pb-5 pt-3" : "px-5 pb-10 pt-5"
        }`}
        style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="w-full max-w-[440px] text-center">
          <div className="pomich-map-copy-plate pomich-role-hero-plate pomich-role-hero-plate--compact">
            <LiveBadge label="Допомога на дорозі · UA" />
            <h1 className="pomich-role-hero-title pomich-role-hero-title--compact font-extrabold leading-[1.05]">
              Ласкаво просимо до <span className="pomich-brand-gradient-text">POMICH</span>
            </h1>
            <p
              className="pomich-role-hero-lead"
              style={{ color: isDark ? "rgba(226,232,240,0.92)" : "#334155" }}
            >
              Оберіть роль — змінити можна пізніше в кабінеті.
            </p>
          </div>

          <div className="pomich-role-card-stack mt-2.5 grid gap-2" role="list">
            <div className="pomich-role-section-label" style={{ color: colors.badgeText }}>
              Оберіть вашу роль
            </div>
            {roleCards.map((card, index) => {
              const Icon = card.Icon
              return (
                <button
                  key={card.key}
                  type="button"
                  disabled={saving}
                  onClick={() => handleSelect(card.key)}
                  className={`pomich-role-card pomich-role-card--compact pomich-role-card--${card.tone} w-full disabled:opacity-60`}
                  style={{ animationDelay: `${80 + index * 70}ms` }}
                >
                  <span className="pomich-role-card__shine" aria-hidden="true" />
                  <div className="flex items-center gap-2.5">
                    <div className={`pomich-role-icon pomich-role-icon--compact pomich-role-icon--${card.tone}`}>
                      <span className="pomich-role-icon__glow" aria-hidden="true" />
                      <Icon />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="text-[10px] font-extrabold tracking-wide uppercase" style={{ color: `var(${card.accentVar})` }}>
                        {card.eyebrow}
                      </div>
                      <div className="pomich-role-card__title mt-0.5 text-[15px] font-extrabold leading-tight">{card.title}</div>
                      <div
                        className="mt-0.5 text-[11px] font-semibold leading-snug"
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

          <a href="https://t.me/pomich_ua_bot" target="_blank" rel="noreferrer" className="mt-2.5 block no-underline">
            <div className="pomich-ghost-btn pomich-role-tg-link flex items-center justify-center gap-2">
              <span aria-hidden="true">✈</span>
              @pomich_ua_bot
            </div>
          </a>

          <div className="pomich-map-copy-plate pomich-role-stats pomich-role-stats--compact mx-auto mt-4 grid max-w-[400px] grid-cols-3 gap-1.5">
            {roleStats.map(([value, label], index) => (
              <div key={value} className="pomich-role-stat" style={{ animationDelay: `${220 + index * 50}ms` }}>
                <div
                  className="text-base font-extrabold"
                  style={{ color: isDark ? "#FACC15" : colors.brand }}
                >
                  {value}
                </div>
                <div
                  className="mt-0.5 text-[9px] font-bold"
                  style={{ color: isDark ? "rgba(226,232,240,0.85)" : "#475569" }}
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
