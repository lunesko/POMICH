interface FieldErrorProps {
  error?: string
  hint?: string
  id?: string
}

/** Inline field error + short hint (not only toast/alert). */
export function FieldError({ error, hint, id }: FieldErrorProps) {
  if (!error && !hint) return null
  return (
    <div className="pomich-field-feedback" id={id}>
      {error ? (
        <div className="pomich-field-error" role="alert">
          {error}
        </div>
      ) : null}
      {hint ? <div className="pomich-field-hint">{hint}</div> : null}
    </div>
  )
}

export default FieldError
