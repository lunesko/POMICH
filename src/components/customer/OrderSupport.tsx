import { useEffect, useState } from "react"
import { createSupportCase, getSupportCases, messageFromFetchError, type SupportCase } from "../../api/client"

export const supportStatusLabels = { open: "Нове", in_review: "На розгляді", resolved: "Розглянуто" }
export const supportReasonLabels = {
  help_not_received: "Допомогу не отримано",
  partner_unreachable: "Немає зв’язку з партнером",
  no_partner: "Не вдалося знайти партнера",
  other: "Інша проблема",
}

export default function OrderSupport({ orderId, token }: { orderId: string; token?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [reason, setReason] = useState<SupportCase["reason"]>("help_not_received")
  const [description, setDescription] = useState("")
  const [ticket, setTicket] = useState<SupportCase>()
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let stopped = false
    setTicket(undefined)
    setError("")
    setLoading(true)
    getSupportCases(token, orderId).then((rows) => {
      if (!stopped) setTicket(rows[0])
    }).catch((err) => { if (!stopped) setError(messageFromFetchError(err)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [orderId, token, reload])

  const submit = async () => {
    setSaving(true)
    setError("")
    try { setTicket(await createSupportCase(orderId, { reason, description: description.trim() }, token)) }
    catch (err) { setError(messageFromFetchError(err)) }
    finally { setSaving(false) }
  }

  return <section aria-label="Підтримка заявки" style={{ background: "var(--pomich-card-bg)", padding: 14, borderRadius: 14, margin: "10px 0" }}>
    <button type="button" className="pomich-flow-secondary-btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Повідомити про проблему</button>
    {expanded ? <div style={{ display: "grid", gap: 10, paddingTop: 10 }}>
      {loading ? <p role="status">Завантажуємо звернення…</p> : ticket ? <>
        <p role="status">Звернення {ticket.id} · {supportStatusLabels[ticket.status]}</p>
        <p>{ticket.description}</p>
        {ticket.resolution ? <p>Відповідь: {ticket.resolution}</p> : <p>Звернення збережено. Це не гарантує негайної відповіді та не скасовує заявку.</p>}
        <button type="button" className="pomich-flow-secondary-btn" onClick={() => setReload(v => v + 1)}>Оновити статус звернення</button>
      </> : <>
        <label>Причина<select value={reason} onChange={event => setReason(event.target.value as SupportCase["reason"])}>
          {Object.entries(supportReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Опишіть проблему<textarea value={description} minLength={5} maxLength={2000} onChange={event => setDescription(event.target.value)} /></label>
        <button type="button" className="pomich-flow-primary-btn" disabled={saving || description.trim().length < 5} onClick={submit}>{saving ? "Надсилаємо…" : "Надіслати звернення"}</button>
      </>}
      {error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </section>
}
