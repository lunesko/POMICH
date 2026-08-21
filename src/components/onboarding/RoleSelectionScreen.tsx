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

function ClientCarIcon() {
  return (
    <svg className="pomich-role-icon-svg" viewBox="0 0 64 64" width="36" height="36" aria-hidden="true">
      <ellipse cx="32" cy="52" rx="18" ry="4" fill="rgba(15,23,42,0.22)" />
      <path
        d="M12 36.5c1.2-7.2 6.8-12.5 14.2-14.2 4.2-1 8.8-1 13.2.2 6.8 1.8 11.6 7.2 12.4 14"
        fill="url(#pomichCarBody)"
      />
      <path d="M18 29.5c2.4-4.8 7-7.4 14-7.4s11.4 2.4 13.8 7" fill="url(#pomichCarGlass)" opacity="0.92" />
      <path d="M14 36.5h36c1.4 4.2 1.2 8.2-.4 10.6H15c-1.8-2.4-2.2-6.4-1-10.6Z" fill="url(#pomichCarLower)" />
      <circle cx="21" cy="46.5" r="5.2" fill="#1A2332" />
      <circle cx="21" cy="46.5" r="2.2" fill="#94A3B8" />
      <circle cx="43" cy="46.5" r="5.2" fill="#1A2332" />
      <circle cx="43" cy="46.5" r="2.2" fill="#94A3B8" />
      <path d="M18 31.5h8.5M37 31.5h8.5" stroke="rgba(255,255,255,0.55)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 38.5h6" stroke="#FACC15" strokeWidth="2" strokeLinecap="round" />
      <path d="M42 38.5h6" stroke="#F8FAFC" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
      <defs>
        <linearGradient id="pomichCarBody" x1="12" y1="22" x2="52" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF8A65" />
          <stop offset="0.55" stopColor="#EF4444" />
          <stop offset="1" stopColor="#B91C1C" />
        </linearGradient>
        <linearGradient id="pomichCarGlass" x1="20" y1="22" x2="48" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E0F2FE" />
          <stop offset="1" stopColor="#38BDF8" />
        </linearGradient>
        <linearGradient id="pomichCarLower" x1="14" y1="36" x2="50" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F87171" />
          <stop offset="1" stopColor="#991B1B" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function PartnerTruckIcon() {
  return (
    <svg className="pomich-role-icon-svg" viewBox="0 0 64 64" width="36" height="36" aria-hidden="true">
      <ellipse cx="32" cy="52" rx="19" ry="4" fill="rgba(15,23,42,0.22)" />
      <rect x="10" y="30" width="26" height="16" rx="3" fill="url(#pomichTruckBed)" />
      <path d="M36 34h10.5l5.5 7.5V46H36V34Z" fill="url(#pomichTruckCab)" />
      <path d="M39 36.5h6.2l3.4 4.6H39V36.5Z" fill="url(#pomichTruckGlass)" />
      <path d="M12 28h18l2 4H12v-4Z" fill="#FACC15" />
      <rect x="13" y="32.5" width="8" height="5" rx="1" fill="rgba(255,255,255,0.28)" />
      <rect x="23" y="32.5" width="8" height="5" rx="1" fill="rgba(255,255,255,0.18)" />
      <circle cx="18" cy="47" r="5" fill="#1A2332" />
      <circle cx="18" cy="47" r="2.1" fill="#94A3B8" />
      <circle cx="44" cy="47" r="5" fill="#1A2332" />
      <circle cx="44" cy="47" r="2.1" fill="#94A3B8" />
      <path d="M48.5 40.5h3.5" stroke="#F8FAFC" strokeWidth="2" strokeLinecap="round" />
      <defs>
        <linearGradient id="pomichTruckBed" x1="10" y1="28" x2="36" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34D399" />
          <stop offset="0.5" stopColor="#16A36A" />
          <stop offset="1" stopColor="#0B7A4D" />
        </linearGradient>
        <linearGradient id="pomichTruckCab" x1="36" y1="34" x2="52" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
        <linearGradient id="pomichTruckGlass" x1="39" y1="36" x2="49" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E0F2FE" />
          <stop offset="1" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
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
]

function RoleBadge({ label }: { label: string }) {
  return (
    <span className="pomich-role-badge">
      <span className="pomich-role-badge__dot" aria-hidden="true" />
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
          <span className="pomich-role-brand-mark" aria-hidden="true">
            P
          </span>
          <span className="pomich-role-brand-wordmark text-xl">POMICH</span>
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
          <div className="pomich-map-copy-plate pomich-role-hero-plate" style={{ marginBottom: 14 }}>
            <RoleBadge label="Український roadside assistance marketplace" />

            <h1 className={`pomich-role-hero-title mt-4 font-extrabold leading-[1.02] ${compact ? "text-[32px]" : "text-[clamp(34px,5vw,48px)]"}`}>
              Ласкаво просимо до
              <br />
              <span className="pomich-brand-gradient-text">POMICH</span>
            </h1>

            <p
              className={`mx-auto mt-3.5 max-w-[420px] font-bold leading-relaxed ${compact ? "text-[15px]" : "text-[17px]"}`}
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
                      <div className="mt-2 text-sm font-bold leading-snug" style={{ color: "var(--pomich-role-card-muted)" }}>
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
            className={`pomich-map-copy-plate pomich-role-stats mx-auto mt-8 grid max-w-[480px] grid-cols-3 gap-2.5 ${compact ? "" : "gap-5"}`}
            style={{ padding: compact ? "12px 10px" : "14px 16px" }}
          >
            {roleStats.map(([value, label], index) => (
              <div key={value} className="pomich-role-stat" style={{ animationDelay: `${320 + index * 70}ms` }}>
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
