import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PomichErrorBoundary from './components/ui/PomichErrorBoundary'
import './index.css'
import { initMobileCompactClasses } from './hooks/useMobileCompact'
import { applyPomichThemeToDocument, resolveInitialPomichTheme } from './lib/theme'
import { initTelegramApp, syncAppViewportHeight } from './telegram'

const telegramContext = initTelegramApp()
if (typeof document !== 'undefined') {
  if (telegramContext.isTelegram) {
    document.documentElement.classList.add('tg-compact')
  }
  initMobileCompactClasses()
  syncAppViewportHeight(telegramContext.webApp)
}
applyPomichThemeToDocument(resolveInitialPomichTheme({ telegramColorScheme: telegramContext.webApp?.colorScheme }))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PomichErrorBoundary>
      <App />
    </PomichErrorBoundary>
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      // Cache-bust the SW script URL so Safari does not keep a deleted-chunk SW.
      .register('/pomich-sw.js?v=34')
      .then((registration) => {
        registration.update().catch(() => undefined)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (sessionStorage.getItem('pomich-sw-refresh') === '1') return
          sessionStorage.setItem('pomich-sw-refresh', '1')
          window.location.reload()
        })
      })
      .catch(() => undefined)
  })
}
