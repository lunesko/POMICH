import type { ReactNode } from 'react'
import CustomerApp from './CustomerApp'
import { PomichThemeProvider } from './context/PomichThemeProvider'
import { useTelegramUx } from './hooks/useTelegramUx'

function TelegramRoot({ children }: { children: ReactNode }) {
  useTelegramUx()
  return <>{children}</>
}

export default function App() {
  return (
    <PomichThemeProvider>
      <TelegramRoot>
        <CustomerApp />
      </TelegramRoot>
    </PomichThemeProvider>
  )
}
