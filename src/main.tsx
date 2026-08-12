import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initMobileCompactClasses } from './hooks/useMobileCompact'
import { applyPomichThemeToDocument, resolveInitialPomichTheme } from './lib/theme'
import { initTelegramApp } from './telegram'

const telegramContext = initTelegramApp()
if (typeof document !== 'undefined') {
  if (telegramContext.isTelegram) {
    document.documentElement.classList.add('tg-compact')
  }
  initMobileCompactClasses()
}
applyPomichThemeToDocument(resolveInitialPomichTheme({ telegramColorScheme: telegramContext.webApp?.colorScheme }))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pomich-sw.js').catch(() => undefined)
  })
}
