import type { ReactNode } from "react"

import { FormFooterBar } from "./FormContainer"

interface ScreenLayoutProps {
  children: ReactNode
  footer?: ReactNode
}

export function ScreenLayout({ children, footer }: ScreenLayoutProps) {
  return (
    <div
      className="pomich-themed-shell pomich-screen-layout"
      style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: "100%", minHeight: "100%", overflowX: "hidden" }}
    >
      <div className="pomich-screen-layout__content" style={{ flex: 1, minWidth: 0, overflow: "auto", overflowX: "hidden" }}>{children}</div>
      {footer ? <FormFooterBar>{footer}</FormFooterBar> : null}
    </div>
  )
}

export default ScreenLayout
