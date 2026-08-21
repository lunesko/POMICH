import { telegramHaptic, type TelegramWebApp } from "../telegram"

export async function ensurePartnerAlertPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported"
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission
  }
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export function showPartnerDutyNotification(title: string, body: string, tag?: string) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return false
  if (Notification.permission !== "granted") return false
  try {
    const notification = new Notification(title, {
      body,
      tag: tag || "pomich-partner-duty",
      silent: false,
    })
    notification.onclick = () => {
      try {
        window.focus()
      } catch {
        // ignore
      }
      notification.close()
    }
    return true
  } catch {
    return false
  }
}

/** Alert partner about a newly seen order/offer while on duty. */
export function alertPartnerNewRequest(options: {
  orderId: string
  serviceLabel?: string
  distanceLabel?: string
  webApp?: TelegramWebApp
  preferNotification?: boolean
}) {
  const title = "POMICH · нова заявка"
  const parts = [
    options.orderId ? `#${options.orderId}` : null,
    options.serviceLabel || null,
    options.distanceLabel || null,
  ].filter(Boolean)
  const body = parts.length > 0 ? parts.join(" · ") : "Відкрийте кабінет партнера"
  const hidden = typeof document !== "undefined" && document.visibilityState !== "visible"
  if (hidden || options.preferNotification) {
    showPartnerDutyNotification(title, body, `pomich-order-${options.orderId}`)
  }
  telegramHaptic(options.webApp, hidden ? "warning" : "heavy")
}

export function diffNewIds(previous: Set<string>, nextIds: string[]): string[] {
  const fresh: string[] = []
  for (const id of nextIds) {
    if (!id || previous.has(id)) continue
    fresh.push(id)
  }
  return fresh
}
