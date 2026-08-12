import type { CustomerProfile } from '../api/client'

const ENCRYPTED_VALUE_PREFIX = 'enc:v1:'
const DEFAULT_CUSTOMER_NAME = 'Клієнт POMICH'

function isEncryptedValue(value?: string | null): boolean {
  return Boolean(value?.startsWith(ENCRYPTED_VALUE_PREFIX))
}

function isGuestCustomerId(customerId?: string | null): boolean {
  const normalized = String(customerId || '').trim()
  return normalized === 'customer-web' || normalized.startsWith('guest-')
}

export function formatCustomerDisplayName(client: Pick<CustomerProfile, 'id' | 'name' | 'displayName' | 'telegram'>): string {
  if (client.displayName?.trim()) return client.displayName.trim()

  const name = String(client.name || '').trim()
  if (name && name !== DEFAULT_CUSTOMER_NAME && !isEncryptedValue(name)) return name

  const customerId = String(client.id || '').trim()
  if (customerId.startsWith('tg-')) {
    const telegram = String(client.telegram || '').trim().replace(/^@/, '')
    if (telegram) return `@${telegram}`
    const suffix = customerId.slice(3)
    return suffix ? `Telegram ${suffix}` : 'Telegram'
  }

  if (isGuestCustomerId(customerId)) {
    const shortId = customerId.replace(/^guest-/, '').slice(0, 8)
    return shortId ? `Гість ${shortId}` : 'Гість'
  }

  return customerId || 'Клієнт'
}

export function formatCustomerCity(city?: string | null): string {
  const normalized = String(city || '').trim()
  if (!normalized || isEncryptedValue(normalized)) return 'місто не вказано'
  return normalized
}
