import { DARK, MUTED } from "./flowTheme"

export default function SheetHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 950, color: DARK, letterSpacing: "-0.03em" }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 6, color: MUTED, fontWeight: 700, fontSize: 13, lineHeight: 1.35 }}>{subtitle}</div> : null}
    </div>
  )
}
