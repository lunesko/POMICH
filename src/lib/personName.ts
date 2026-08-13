export interface PersonNameValidation {
  valid: boolean
  value: string
  error?: string
  hint?: string
}

const LETTERS_RE = /\p{L}/u
const NAME_CHARS_RE = /^[\p{L}][\p{L}\s'\u2019\-]*$/u

/** Normalize display name: trim + collapse inner whitespace. */
export function normalizePersonName(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
}

/**
 * Ukrainian registration name rules:
 * min 2 letters, UA/RU/Latin letters, spaces/hyphen/apostrophe OK.
 * Rejects single chars and nonsense like "q" / "аа".
 */
export function validatePersonName(raw: string): PersonNameValidation {
  const value = normalizePersonName(raw)
  if (!value) {
    return {
      valid: false,
      value,
      error: "Вкажіть ім'я",
      hint: "Щонайменше 2 літери (українською, російською або латиницею)",
    }
  }
  if (value.length < 2) {
    return {
      valid: false,
      value,
      error: "Ім'я занадто коротке",
      hint: "Вкажіть щонайменше 2 літери",
    }
  }
  if (!NAME_CHARS_RE.test(value)) {
    return {
      valid: false,
      value,
      error: "Некоректне ім'я",
      hint: "Лише літери, пробіл, дефіс або апостроф",
    }
  }
  const letters = Array.from(value).filter((ch) => LETTERS_RE.test(ch)).join("")
  if (letters.length < 2) {
    return {
      valid: false,
      value,
      error: "Ім'я занадто коротке",
      hint: "Вкажіть щонайменше 2 літери",
    }
  }
  if (/^(.)\1+$/u.test(letters)) {
    return {
      valid: false,
      value,
      error: "Некоректне ім'я",
      hint: "Вкажіть справжнє ім'я, а не одну літеру повторно",
    }
  }
  return { valid: true, value }
}
