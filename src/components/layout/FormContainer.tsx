import type { ReactNode } from "react"

interface FormContainerProps {
  children: ReactNode
  className?: string
}

/** Centered responsive max-width wrapper for registration/profile forms. */
export function FormContainer({ children, className = "" }: FormContainerProps) {
  return <div className={`pomich-form-container ${className}`.trim()}>{children}</div>
}

export function FormHeader({ children }: { children: ReactNode }) {
  return <div className="pomich-form-header">{children}</div>
}

export function FormFooterBar({ children }: { children: ReactNode }) {
  return (
    <div className="pomich-form-footer-bar">
      <div className="pomich-form-footer-inner">{children}</div>
    </div>
  )
}

export default FormContainer
