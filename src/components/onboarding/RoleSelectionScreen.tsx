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
  return (
    <svg
      className="pomich-role-icon-svg pomich-role-icon-svg--client"
      viewBox="0 0 48 48"
      width="40"
      height="40"
      fill="none"
      aria-hidden="true"
    >
      <g className="pomich-role-icon-vehicle">
        <path
          d="M8.5 28.5c1.1-6.2 5.8-10.2 15.5-10.2s14.4 4 15.5 10.2c.7 3.2.5 6.2-.4 7.8H8.9c-.9-1.6-1.1-4.6-.4-7.8Z"
          fill="#fff"
        />
        <path
          d="M16.5 21c1.8-2.8 4.8-4.2 7.5-4.2s5.7 1.4 7.5 4.2"
          fill="rgba(15,118,110,0.28)"
        />
        <path d="M11.5 29.2h7.2M29.3 29.2h7.2" stroke="rgba(15,118,110,0.45)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="15.5" cy="35.2" r="3.7" fill="#0B1220" />
        <circle cx="15.5" cy="35.2" r="1.4" fill="#E2E8F0" />
        <circle cx="32.5" cy="35.2" r="3.7" fill="#0B1220" />
        <circle cx="32.5" cy="35.2" r="1.4" fill="#E2E8F0" />
        <circle cx="37.8" cy="28.4" r="1.4" fill="#FDE68A" />
      </g>
    </svg>
  )
}

function PartnerTruckIcon() {
  return (
    <svg
      className="pomich-role-icon-svg pomich-role-icon-svg--partner"
      viewBox="0 0 48 48"
      width="40"
      height="40"
      fill="none"
      aria-hidden="true"
    >
      <g className="pomich-role-icon-vehicle">
        <rect x="6.5" y="20.5" width="20" height="13.5" rx="2.4" fill="#fff" />
        <path d="M26.5 23.2h9.2L40 30.2v3.8H26.5V23.2Z" fill="#fff" />
        <path d="M29.2 25h5.4l2.7 3.6H29.2V25Z" fill="rgba(29,78,216,0.35)" />
        <path d="M8.2 17.8h14.2l1.8 2.7H8.2v-2.7Z" fill="#F8FAFC" />
        <path d="M9.2 25.2h5.4M9.2 28.6h8.2" stroke="rgba(29,78,216,0.4)" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="14.2" cy="35.4" r="3.6" fill="#0B1220" />
        <circle cx="14.2" cy="35.4" r="1.35" fill="#E2E8F0" />
        <circle cx="33.2" cy="35.4" r="3.6" fill="#0B1220" />
        <circle cx="33.2" cy="35.4" r="1.35" fill="#E2E8F0" />
        <circle cx="38.6" cy="29.4" r="1.35" fill="#FDE68A" />
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
