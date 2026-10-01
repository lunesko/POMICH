import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PomichErrorBoundary from './components/ui/PomichErrorBoundary'
import './index.css'
import { initMobileCompactClasses } from './hooks/useMobileCompact'
import { applyPomichThemeToDocument, resolveInitialPomichTheme } from './lib/theme'
import { initTelegramApp, syncAppViewportHeight } from './telegram'

// Load after the application bootstrap; reporting must never block first paint.
if (typeof window !== 'undefined') {
  void import('./lib/webVitals').then(({ startWebVitals }) => startWebVitals()).catch(() => undefined)
}

async function bootstrap() {
  await (window.__pomichTelegramReady ?? Promise.resolve())
  // Drop one-shot cache-bust query from boot recovery so shares/bookmarks stay clean.
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.has('_pomich')) {
      url.searchParams.delete('_pomich')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  } catch {
    // ignore
  }
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
}

void bootstrap()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/pomich-sw.js?v=43')
      .then((registration) => {
        // Pick up new SW quickly after deploy so hashed chunks stay in sync.
        registration.update().catch(() => undefined)
        // If an older SW is still controlling this tab, force an update cycle.
        if (navigator.serviceWorker.controller) {
          registration.update().catch(() => undefined)
        }
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (sessionStorage.getItem('pomich-sw-refresh') === '1') return
          sessionStorage.setItem('pomich-sw-refresh', '1')
          window.location.reload()
        })
      })
      .catch(() => undefined)
  })
}
