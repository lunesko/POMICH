import type { ReactNode } from "react"

/** Solid readable plate for login/registration (header + body + footer).
 *  Map atmosphere stays fixed behind from MapAtmosphereProvider. */
export function OnboardingFormShell({ header, footer, children }: {
  header: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="pomich-onboarding-page">
      <div className="pomich-onboarding-card pomich-onboarding-card--compact">
        <div className="pomich-onboarding-card__header">{header}</div>
        <div className="pomich-onboarding-card__body">{children}</div>
        {footer ? <div className="pomich-onboarding-card__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export default OnboardingFormShell
