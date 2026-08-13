import { usePomichTheme } from "../../context/PomichThemeProvider"
import { mediaQueries } from "../../lib/breakpoints"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { useTelegramUx } from "../../hooks/useTelegramUx"
import type { Role } from "../../lib/constants"
import { ThemeToggle } from "../ui/ThemeToggle"

const roleStats = [
  ["24/7", "Заявка з дороги"],
  ["12 хв", "Орієнтовний ETA"],
  ["2 ролі", "Клієнт і партнер"],
] as const

interface RoleSelectionScreenProps {
  compact?: boolean
  saving?: boolean
  onSelect: (role: Extract<Role, "customer" | "provider">) => void
  onShowLanding?: () => void
}

const roleCards = [
  {
    key: "customer" as const,
    title: "Я клієнт",
    emoji: "🚗",
    eyebrow: "Водіям",
    description: "Потрібна допомога на дорозі — евакуатор, акумулятор, колесо чи пальне.",
    gradient: "linear-gradient(135deg, #16A36A 0%, #2F80ED 100%)",
    accentVar: "--pomich-accent",
    shadow: "0 16px 38px rgba(22,163,106,0.22)",
  },
  {
    key: "provider" as const,
    title: "Я партнер",
    emoji: "🚛",
    eyebrow: "Партнерам",
    description: "Надаю послуги автодопомоги та приймаю заявки поруч із собою.",
    gradient: "linear-gradient(135deg, #2F80ED 0%, #D6B400 100%)",
    accentVar: "--pomich-accent-blue",
    shadow: "0 16px 38px rgba(47,128,237,0.22)",
  },
]

function RoleBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-extrabold"
      style={{ border: "1px solid rgba(22,163,106,0.38)", background: "rgba(22,163,106,0.12)", color: "var(--pomich-badge-text)" }}
    >
      <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_18px_rgba(34,197,94,0.85)]" />
      {label}
    </span>
  )
}

export default function RoleSelectionScreen({ compact: compactProp, saving = false, onSelect, onShowLanding }: RoleSelectionScreenProps) {
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const compact = compactProp ?? isMobile
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
        className={`relative z-10 flex items-center justify-between ${compact ? "px-[18px] pt-4" : "px-7 pt-5"}`}
        style={{ paddingTop: "calc(16px + env(safe-area-inset-top, 0px))" }}
      >
        <div className="inline-flex items-center gap-3 font-extrabold">
          <span
            className="flex h-[42px] w-[42px] items-center justify-center rounded-lg text-xl shadow-[0_12px_32px_rgba(22,163,106,0.28)]"
            style={{ background: "linear-gradient(135deg, #16A36A, #2F80ED)" }}
          >
            P
          </span>
          <span className="text-xl">POMICH</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeToggle compact={compact} />
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
        className={`relative z-[2] flex min-h-[calc(100dvh-58px)] flex-col items-center justify-center ${compact ? "px-[18px] pb-8 pt-5" : "px-6 pb-14 pt-8"}`}
        style={{ paddingBottom: "calc(32px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="w-full max-w-[520px] text-center">
          <div className="pomich-map-copy-plate" style={{ marginBottom: 14 }}>
            <RoleBadge label="Український roadside assistance marketplace" />

            <h1 className={`mt-4 font-extrabold leading-[1.02] ${compact ? "text-[32px]" : "text-[clamp(34px,5vw,48px)]"}`}>
              Ласкаво просимо до
              <br />
              <span className="pomich-brand-gradient-text">POMICH</span>
            </h1>

            <p className={`mx-auto mt-3.5 max-w-[420px] font-bold leading-relaxed ${compact ? "text-[15px]" : "text-[17px]"}`} style={{ color: isDark ? "rgba(226,232,240,0.95)" : "#1e293b" }}>
              Оберіть, як ви користуєтесь сервісом. Пізніше можна змінити роль у кабінеті.
            </p>

            <div className="mt-3 text-sm font-extrabold" style={{ color: colors.badgeText }}>Оберіть вашу роль</div>
          </div>

          <div className="mt-3 grid gap-3">
            {roleCards.map((card) => (
              <button
                key={card.key}
                type="button"
                disabled={saving}
                onClick={() => handleSelect(card.key)}
                className="pomich-role-card w-full disabled:opacity-60"
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl text-2xl"
                    style={{ background: card.gradient, boxShadow: card.shadow }}
                  >
                    {card.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-extrabold tracking-wide" style={{ color: `var(${card.accentVar})` }}>{card.eyebrow}</div>
                    <div className="mt-1 text-lg font-extrabold">{card.title}</div>
                    <div className="mt-2 text-sm font-bold leading-snug" style={{ color: "var(--pomich-role-card-muted)" }}>{card.description}</div>
                  </div>
                  <span className="self-center text-xl font-extrabold opacity-45">→</span>
                </div>
              </button>
            ))}
          </div>

          <a href="https://t.me/pomich_ua_bot" target="_blank" rel="noreferrer" className="mt-3.5 block no-underline">
            <div className="pomich-ghost-btn flex min-h-[50px] items-center justify-center gap-2.5 rounded-xl px-4 text-sm">
              <span className="text-lg">✈️</span>
              Відкрити @pomich_ua_bot у Telegram
            </div>
          </a>

          <div className={`pomich-map-copy-plate mx-auto mt-8 grid max-w-[480px] grid-cols-3 gap-2.5 ${compact ? "" : "gap-5"}`} style={{ padding: compact ? "12px 10px" : "14px 16px" }}>
            {roleStats.map(([value, label]) => (
              <div key={value}>
                <div className={`font-extrabold ${compact ? "text-[22px]" : "text-[28px]"}`} style={{ color: isDark ? "#FACC15" : colors.brand }}>
                  {value}
                </div>
                <div className={`mt-1 font-extrabold ${compact ? "text-[10px]" : "text-xs"}`} style={{ color: isDark ? "rgba(226,232,240,0.9)" : "#334155" }}>
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
