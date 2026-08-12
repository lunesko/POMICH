import type { ReactNode } from "react"

import { usePomichTheme } from "../../context/PomichThemeProvider"

interface OnboardingFormShellProps {
  header: ReactNode
  footer?: ReactNode
  children: ReactNode
}

/** Single glass card for login/registration onboarding (header + body + footer). */
export function OnboardingFormShell({ header, footer, children }: OnboardingFormShellProps) {
  const { colors, isDark } = usePomichTheme()

  return (
    <div className="pomich-onboarding-page">
      <div className="pomich-onboarding-page__bg" aria-hidden="true">
        <div className="pomich-onboarding-page__gradient" style={{ background: colors.heroBg }} />
        <div
          className="pomich-onboarding-page__pattern"
          style={{
            backgroundImage: colors.heroPattern,
            opacity: isDark ? 0.55 : 0.45,
          }}
        />
        <div
          className="pomich-onboarding-page__glow"
          style={{
            background: isDark
              ? "radial-gradient(ellipse 90% 55% at 50% 8%, rgba(22,163,106,0.18), transparent 62%), radial-gradient(ellipse 60% 40% at 82% 18%, rgba(29,111,212,0.14), transparent 58%)"
              : "radial-gradient(ellipse 120% 80% at 20% 0%, rgba(22, 163, 106, 0.14), transparent 55%), radial-gradient(ellipse 90% 70% at 85% 15%, rgba(47, 128, 237, 0.1), transparent 50%)",
          }}
        />
      </div>

      <div className="pomich-onboarding-card pomich-onboarding-card--compact">
        <div className="pomich-onboarding-card__header">{header}</div>
        <div className="pomich-onboarding-card__body">{children}</div>
        {footer ? <div className="pomich-onboarding-card__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export default OnboardingFormShell
