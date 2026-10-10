import { useState } from 'react'
import { eraseCustomerData, exportCustomerData } from '../../api/client'
import { useConfirmDialog } from '../ui/ConfirmDialog'

export default function PersonalDataControls({ customerId, token, onDeleted }: {
  customerId: string; token?: string; onDeleted?: () => void
}) {
  const confirm = useConfirmDialog()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(remove: boolean) {
    if (remove && !await confirm({ title: 'Видалити мої дані?',
      description: 'Профіль клієнта та завершені заявки буде видалено. Цю дію не можна скасувати. Спочатку можна завантажити копію даних.',
      confirmLabel: 'Видалити дані', danger: true })) return
    setBusy(true)
    setError('')
    try {
      if (remove) {
        await eraseCustomerData(customerId, token)
        onDeleted?.()
      } else {
        const blob = await exportCustomerData(customerId, token)
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'pomich-personal-data.json'
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Сталася помилка. Спробуйте пізніше.')
    } finally {
      setBusy(false)
    }
  }
  return <section className="pomich-cabinet-card" aria-label="Мої персональні дані">
    <h2>Мої дані</h2>
    <p>Завершені та скасовані заявки зберігаються 180 днів. Активні заявки автоматично не видаляються.</p>
    <div className="flex flex-wrap gap-3 mt-3">
      <button type="button" className="pomich-cabinet-chip-btn" disabled={busy || !token} onClick={() => void run(false)}>Завантажити мої дані</button>
      <button type="button" className="pomich-cabinet-chip-btn" disabled={busy || !token} onClick={() => void run(true)}>Видалити мої дані</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>
}
