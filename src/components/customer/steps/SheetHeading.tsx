

export default function SheetHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="pomich-sheet-heading__title" style={{ margin: 0 }}>{title}</h2>
      {subtitle ? <p className="pomich-sheet-heading__subtitle" style={{ margin: "4px 0 0" }}>{subtitle}</p> : null}
    </div>
  )
}
