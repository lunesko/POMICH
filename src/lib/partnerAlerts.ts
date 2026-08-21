/** Partner duty alerts: browser notifications when WebApp is backgrounded / screen off. */

const PERMISSION_ASKED_KEY = "pomichPartnerNotifyAsked"

export function partnerNotificationsSupported(): boolean {
  return typeof window !== "undefined" && typeof Notification !== "undefined"
}

export function partnerNotificationPermission(): NotificationPermission | "unsupported" {
  if (!partnerNotificationsSupported()) return "unsupported"
  return Notification.permission
}

export async function ensurePartnerNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!partnerNotificationsSupported()) return "unsupported"
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission
  }
  try {
    const result = await Notification.requestPermission()
    try {
      sessionStorage.setItem(PERMISSION_ASKED_KEY, "1")
    } catch {
      /* ignore */
    }
    return result
  } catch {
    return Notification.permission
  }
}

export type PartnerAlertPayload = {
  title: string
  body: string
  tag?: string
  /** Deep-link path or absolute URL opened when notification is clicked */
  url?: string
}

export async function showPartnerAlert(payload: PartnerAlertPayload): Promise<boolean> {
  if (!partnerNotificationsSupported()) return false
  if (Notification.permission !== "granted") return false

  const options: NotificationOptions & { renotify?: boolean } = {
    body: payload.body,
    tag: payload.tag ?? "pomich-partner-request",
    renotify: true,
    requireInteraction: true,
    icon: "/favicon.svg",
    data: { url: payload.url ?? "/" },
  }

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration?.showNotification) {
        await registration.showNotification(payload.title, options)
        return true
      }
    }
  } catch {
    /* fall through to page Notification */
  }

  try {
    const notification = new Notification(payload.title, options)
    notification.onclick = () => {
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      notification.close()
    }
    return true
  } catch {
    return false
  }
}

/** Diff known ids vs next ids; returns ids that appeared. Seeds known set on first call without alerting. */
export function takeNewAlertIds(known: Set<string>, nextIds: string[]): string[] {
  if (known.size === 0) {
    for (const id of nextIds) known.add(id)
    return []
  }
  const fresh: string[] = []
  for (const id of nextIds) {
    if (!known.has(id)) {
      known.add(id)
      fresh.push(id)
    }
  }
  for (const id of [...known]) {
    if (!nextIds.includes(id)) known.delete(id)
  }
  return fresh
}

export function formatNearbyRequestAlert(count: number): PartnerAlertPayload {
  if (count === 1) {
    return {
      title: "POMICH · нова заявка",
      body: "У вашому радіусі зʼявилась нова заявка. Відкрийте застосунок.",
      tag: "pomich-nearby-request",
    }
  }
  return {
    title: "POMICH · нові заявки",
    body: `У вашому радіусі ${count} нових заявок. Відкрийте застосунок.`,
    tag: "pomich-nearby-request",
  }
}

export function formatOfferAlert(serviceLabel?: string): PartnerAlertPayload {
  return {
    title: "POMICH · пропозиція",
    body: serviceLabel
      ? `Нова заявка: ${serviceLabel}. Відкрийте, щоб прийняти.`
      : "Нова пропозиція заявки. Відкрийте, щоб прийняти.",
    tag: "pomich-dispatch-offer",
  }
}
