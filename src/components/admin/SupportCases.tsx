import { useEffect, useState } from "react"
import { getSupportCases, updateSupportCase, messageFromFetchError, type SupportCase } from "../../api/client"
import { supportReasonLabels, supportStatusLabels } from "../customer/OrderSupport"

export default function SupportCases({ token }: { token?: string }) {
  const [rows, setRows] = useState<SupportCase[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let stopped = false
    const refresh = () => getSupportCases(token).then(result => {
      if (!stopped) { setRows(result); setError("") }
    }).catch(err => { if (!stopped) setError(messageFromFetchError(err)) })
      .finally(() => { if (!stopped) setLoading(false) })
    void refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [token, reload])
  return <div className="admin-panel"><h2>Звернення клієнтів</h2>
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p>Завантажуємо…</p> : !rows.length ? <p>Звернень немає.</p> : null}
    {rows.map(row => <SupportCaseEditor key={row.id} row={row} token={token} onSaved={() => setReload(v => v + 1)} />)}
  </div>
}

function SupportCaseEditor({ row, token, onSaved }: { row: SupportCase; token?: string; onSaved: () => void }) {
  const [status, setStatus] = useState(row.status)
  const [resolution, setResolution] = useState(row.resolution || "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    setStatus(row.status)
    setResolution(row.resolution || "")
    setError("")
  }, [row.status, row.resolution, row.updatedAt])
  const save = async () => {
    setSaving(true)
    setError("")
    try { await updateSupportCase(row.id, status, resolution.trim(), token); onSaved() }
    catch (err) { setError(messageFromFetchError(err)) }
    finally { setSaving(false) }
  }
  return <section className="admin-subpanel" aria-label={`Звернення ${row.id}`}>
    <h3>{row.id} · {supportStatusLabels[row.status]}</h3>
    <p>Заявка {row.orderId} · Клієнт {row.customerId}</p>
    <p>{supportReasonLabels[row.reason]}: {row.description}</p>
    <label className="admin-field">Статус<select value={status} onChange={e => setStatus(e.target.value as SupportCase["status"])}>
      {Object.entries(supportStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label className="admin-field">Відповідь клієнту<textarea value={resolution} maxLength={2000} onChange={e => setResolution(e.target.value)} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" className="admin-primary-btn" disabled={saving || (status === "resolved" && resolution.trim().length < 5)} onClick={save}>{saving ? "Зберігаємо…" : "Зберегти звернення"}</button>
  </section>
}
