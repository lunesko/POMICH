interface SheetHeadingProps {
  title: string
  subtitle?: string
}

export function SheetHeading({ title, subtitle }: SheetHeadingProps) {
  return (
    <div className="pomich-sheet-heading">
      <div className="pomich-sheet-heading__title">{title}</div>
      {subtitle ? <div className="pomich-sheet-heading__subtitle">{subtitle}</div> : null}
    </div>
  )
}

export default SheetHeading
