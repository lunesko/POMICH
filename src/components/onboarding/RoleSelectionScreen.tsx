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

/** Lucide map-pinned — ISC https://lucide.dev/icons/map-pinned */
function ClientRoleIcon() {
  return (
    <svg
      className="pomich-role-icon-svg pomich-role-icon-svg--client"
      viewBox="0 0 24 24"
      width="34"
      height="34"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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
      width="34"
      height="34"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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
    description: "Потрібна допомога на дорозі — евакуатор, акумулятор, колесо чи пальне.",
    accentVar: "--pomich-accent",
    tone: "client" as const,
    Icon: ClientRoleIcon,
  },
  {
    key: "provider" as const,
    title: "Я партнер",
    eyebrow: "Партнерам",
    description: "Надаю послуги автодопомоги та приймаю заявки поруч із собою.",
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
