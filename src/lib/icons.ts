import uiSpriteUrl from "../assets/icons/ui.svg?url&no-inline"
import serviceSpriteUrl from "../assets/icons/services.svg?url&no-inline"
import { services } from "./constants"
import type { ServiceKey } from "./pomichDomain"

export const iconNames = ["arrow-left", "arrow-right", "arrow-up", "close", "menu", "check", "circle", "plus", "minus", "clock", "pin", "locate", "map", "flag", "wrench", "car", "phone", "chat", "star", "warning", "info", "telegram", "dashboard", "user", "clipboard", "activity", "shield-check", "settings", "lock", "eye", "eye-off"] as const
export type IconName = (typeof iconNames)[number]

export function iconHref(name: IconName): string {
  return `${uiSpriteUrl}#${name}`
}

export function resolveServiceIcon(service?: string): ServiceKey {
  return services.find((item) => item.key === service)?.key ?? "mechanic"
}

export function serviceIconHref(service?: string): string {
  return `${serviceSpriteUrl}#${resolveServiceIcon(service)}`
}

/** Only fixed, allowlisted sprite references enter Leaflet's HTML string. */
export function serviceMarkerMarkup(service?: string, size = 20): string {
  const pixels = Number.isFinite(size) ? Math.max(12, Math.min(40, Math.round(size))) : 20
  return `<svg class="pomich-icon" width="${pixels}" height="${pixels}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><use href="${serviceIconHref(service)}" /></svg>`
}

export function iconMarkup(name: IconName, size = 20): string {
  const key = iconNames.includes(name) ? name : "info"
  const pixels = Number.isFinite(size) ? Math.max(12, Math.min(40, Math.round(size))) : 20
  return `<svg class="pomich-icon" width="${pixels}" height="${pixels}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="${iconHref(key)}" /></svg>`
}
