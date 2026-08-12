import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { applyPomichThemeToDocument, resolveInitialPomichTheme } from './lib/theme'
import { getTelegramContext } from './telegram'

const telegramContext = getTelegramContext()
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
