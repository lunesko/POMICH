/** Ukrainian mobile operator codes (2 digits after +380). */
export const UA_MOBILE_PREFIXES = new Set([
  "39",
  "50",
  "63",
  "66",
  "67",
  "68",
  "73",
  "75",
  "91",
  "92",
  "93",
  "94",
  "95",
  "96",
  "97",
  "98",
  "99",
])

export const UA_PHONE_PLACEHOLDER = "66 123 45 67"

export const UA_PHONE_VALIDATION_ERROR =
  "Введіть коректний мобільний номер України (9 цифр після +380)"

/** Strip to up to 9 national digits (without country code or leading 0). */
export function parseUkrainePhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (!digits) return ""

  let national: string
  if (digits.startsWith("380")) {
    national = digits.slice(3)
  } else if (digits.startsWith("0")) {
    national = digits.slice(1)
  } else {
    national = digits
  }

  return national.slice(0, 9)
}

/** Extract national digits from stored E.164 or mixed input. */
export function nationalDigitsFromPhone(phone: string): string {
  if (!phone) return ""
  return parseUkrainePhoneInput(phone)
}

/** Format national digits for display: 66 123 45 67 */
export function formatLocalPhoneDisplay(nationalDigits: string): string {
  const d = nationalDigits.slice(0, 9)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)} ${d.slice(2)}`
  if (d.length <= 7) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}`
}

/** Build E.164 from national digits. Returns empty string if no digits. */
export function toE164(nationalDigits: string): string {
  const national = parseUkrainePhoneInput(nationalDigits)
  if (!national) return ""
  return `+380${national}`
}

/** Normalize any accepted input to E.164 or empty string. */
export function normalizeUkrainePhone(raw: string): string {
  return toE164(parseUkrainePhoneInput(raw))
}

export interface UkrainePhoneValidation {
  valid: boolean
  e164: string
  error?: string
}

/** Validate Ukrainian mobile number (9 digits after +380, valid operator code). */
export function validateUkraineMobilePhone(input: string): UkrainePhoneValidation {
  const national = parseUkrainePhoneInput(input)

  if (!national) {
    return { valid: false, e164: "", error: "Введіть номер телефону" }
  }

  if (national.length !== 9) {
    return { valid: false, e164: "", error: UA_PHONE_VALIDATION_ERROR }
  }

  const prefix = national.slice(0, 2)
  if (!UA_MOBILE_PREFIXES.has(prefix)) {
    return { valid: false, e164: "", error: "Невірний код оператора мобільного номера" }
  }

  return { valid: true, e164: toE164(national) }
}
