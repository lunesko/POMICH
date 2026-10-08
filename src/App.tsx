import type { ReactNode } from 'react'
import CookieNotice from './components/ui/CookieNotice'
import CustomerApp from './CustomerApp'
import AppErrorBoundary from './components/AppErrorBoundary'
import { PomichThemeProvider } from './context/PomichThemeProvider'
import { MapAtmosphereProvider } from './components/layout/PomichMapShell'
import { useTelegramUx } from './hooks/useTelegramUx'
import { ConfirmDialogProvider } from './components/ui/ConfirmDialog'

function TelegramRoot({ children }: { children: ReactNode }) {
  useTelegramUx()
  return <>{children}</>
}

export default function App() {
  return (
    <AppErrorBoundary>
      <PomichThemeProvider>
        <ConfirmDialogProvider>
          <TelegramRoot>
            <MapAtmosphereProvider>
              <CustomerApp />
              <CookieNotice />
            </MapAtmosphereProvider>
          </TelegramRoot>
        </ConfirmDialogProvider>
      </PomichThemeProvider>
    </AppErrorBoundary>
  )
}
