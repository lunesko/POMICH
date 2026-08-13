import type { ReactNode } from 'react'
import CustomerApp from './CustomerApp'
import { PomichThemeProvider } from './context/PomichThemeProvider'
import { MapAtmosphereProvider } from './components/layout/PomichMapShell'
import { useTelegramUx } from './hooks/useTelegramUx'

function TelegramRoot({ children }: { children: ReactNode }) {
  useTelegramUx()
  return <>{children}</>
}

export default function App() {
  return (
    <PomichThemeProvider>
      <TelegramRoot>
        <MapAtmosphereProvider>
          <CustomerApp />
        </MapAtmosphereProvider>
      </TelegramRoot>
    </PomichThemeProvider>
  )
}
