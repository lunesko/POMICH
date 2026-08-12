import { useEffect, useMemo, useState } from "react"
import { getTelegramContext, initTelegramApp, type TelegramContext } from "../telegram"

export function useTelegram(): TelegramContext {
  const [ctx, setCtx] = useState<TelegramContext>(() => getTelegramContext())

  useEffect(() => {
    setCtx(initTelegramApp())
  }, [])

  return useMemo(() => ctx, [ctx])
}
