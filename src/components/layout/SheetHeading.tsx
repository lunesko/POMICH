import { DARK } from "../../lib/constants"

interface SheetHeadingProps {
  title: string
  subtitle?: string
}

export function SheetHeading({ title, subtitle }: SheetHeadingProps) {
  return (
    <div>
      <div style={{ fontSize: 24, lineHeight: 1.08, fontWeight: 950, color: DARK }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 7, color: "#6B7280", fontSize: 14, lineHeight: 1.35, fontWeight: 750 }}>{subtitle}</div> : null}
    </div>
  )
}

export default SheetHeading
