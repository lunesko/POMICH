import { useState } from "react"

const NOTICE_KEY = "pomichCookieNotice:v1"

export default function CookieNotice() {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(NOTICE_KEY) !== "acknowledged" } catch { return true }
  })
  if (!visible) return null
  return (
    <aside className="pomich-cookie-notice" aria-label="Cookies та локальне сховище" aria-live="polite">
      <p>Ми використовуємо cookies для збереження входу, а локальне сховище — для налаштувань сервісу. Строк збереження входу залежить від вибору «Залишатися в системі».</p>
      <div>
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Детальніше</a>
        <button type="button" className="pomich-cabinet-chip-btn" onClick={() => {
          try { localStorage.setItem(NOTICE_KEY, "acknowledged") } catch { /* Notice can still be dismissed for this page. */ }
          setVisible(false)
        }}>Зрозуміло</button>
      </div>
    </aside>
  )
}
