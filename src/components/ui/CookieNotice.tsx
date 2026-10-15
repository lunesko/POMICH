import { useState } from "react"

const CONSENT_KEY = "pomichLegalConsent:v2"

export default function CookieNotice() {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(CONSENT_KEY) !== "accepted" } catch { return true }
  })
  if (!visible) return null
  return (
    <aside className="pomich-cookie-notice" aria-label="Угода та конфіденційність" role="dialog" aria-modal="false">
      <p>
        Продовжуючи, ви погоджуєтесь з{" "}
        <a href="/terms" target="_blank" rel="noopener noreferrer">Угодою користувача</a>
        {" "}та{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Політикою конфіденційності</a>
        {" "}POMICH.
      </p>
      <div>
        <a href="/terms" target="_blank" rel="noopener noreferrer">Читати</a>
        <button
          type="button"
          className="pomich-cabinet-chip-btn"
          onClick={() => {
            try { localStorage.setItem(CONSENT_KEY, "accepted") } catch { /* Still dismiss for this page. */ }
            setVisible(false)
          }}
        >
          Погоджуюсь
        </button>
      </div>
    </aside>
  )
}
