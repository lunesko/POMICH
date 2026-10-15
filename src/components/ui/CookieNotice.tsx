import { useState } from "react"

const CONSENT_KEY = "pomichPrivacyConsent:v1"

export default function CookieNotice() {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(CONSENT_KEY) !== "accepted" } catch { return true }
  })
  if (!visible) return null
  return (
    <aside className="pomich-cookie-notice" aria-label="Політика конфіденційності" role="dialog" aria-modal="false">
      <p>
        Продовжуючи, ви погоджуєтесь з{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Політикою конфіденційності</a>
        {" "}POMICH: профіль, геолокація заявки, cookies входу та локальні налаштування.
      </p>
      <div>
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Читати</a>
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
