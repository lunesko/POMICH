/** Latin letters used on standard Ukrainian license plates (2004+). */
export const UA_PLATE_LETTERS = "ABCEHIKMOPTX"

export const UA_PLATE_PLACEHOLDER = "BX 5874 HX"

export const UA_PLATE_VALIDATION_ERROR =
  "Введіть коректний номер авто (формат: AA 0000 AA)"

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A",
  а: "A",
  В: "B",
  в: "B",
  С: "C",
  с: "C",
  Е: "E",
  е: "E",
  Н: "H",
  н: "H",
  І: "I",
  і: "I",
  К: "K",
  к: "K",
  М: "M",
  м: "M",
  О: "O",
  о: "O",
  Р: "P",
  р: "P",
  Т: "T",
  т: "T",
  Х: "X",
  х: "X",
}

function normalizePlateChar(char: string): string {
  return CYRILLIC_TO_LATIN[char] ?? char.toUpperCase()
}

function isPlateLetter(char: string): boolean {
  return UA_PLATE_LETTERS.includes(char)
}

function isPlateDigit(char: string): boolean {
  return char >= "0" && char <= "9"
}

/** Strip to up to 8 plate characters (2 letters + 4 digits + 2 letters). */
export function parseUkrainePlateInput(raw: string): string {
  const result: string[] = []

  for (const char of raw) {
    if (char === " " || char === "-") continue

    const normalized = normalizePlateChar(char)
    const position = result.length

    if (position < 2 || position >= 6) {
      if (isPlateLetter(normalized)) {
        result.push(normalized)
      }
    } else if (isPlateDigit(normalized)) {
      result.push(normalized)
    }

    if (result.length >= 8) break
  }

  return result.join("")
}

/** Progressive display format: AA 0000 AA */
export function formatUkrainePlateInput(raw: string): string {
  const compact = parseUkrainePlateInput(raw)
  if (!compact) return ""

  let formatted = compact.slice(0, 2)
  if (compact.length > 2) {
    formatted += ` ${compact.slice(2, 6)}`
  }
  if (compact.length > 6) {
    formatted += ` ${compact.slice(6, 8)}`
  }

  return formatted
}

/** Normalize stored profile plate for input display. */
export function plateInputValueFromStored(plate: string | undefined): string {
  if (!plate) return ""
  return formatUkrainePlateInput(plate)
}

/** Stored value with consistent spacing when complete. */
export function normalizeUkrainePlate(raw: string): string {
  return formatUkrainePlateInput(raw)
}

export function ukrainePlateDisplay(value: string): string {
  return formatUkrainePlateInput(value)
}

export function isValidUkrainePlate(value: string): boolean {
  const compact = parseUkrainePlateInput(value)
  if (compact.length !== 8) return false

  const firstLetters = compact.slice(0, 2)
  const digits = compact.slice(2, 6)
  const lastLetters = compact.slice(6, 8)

  return (
    [...firstLetters, ...lastLetters].every(isPlateLetter) &&
    /^\d{4}$/.test(digits)
  )
}

export interface UkrainePlateValidation {
  valid: boolean
  plate: string
  error?: string
}

export function validateUkrainePlate(input: string): UkrainePlateValidation {
  const compact = parseUkrainePlateInput(input)

  if (!compact) {
    return { valid: false, plate: "", error: "Введіть номер авто" }
  }

  if (!isValidUkrainePlate(input)) {
    return { valid: false, plate: "", error: UA_PLATE_VALIDATION_ERROR }
  }

  return { valid: true, plate: formatUkrainePlateInput(input) }
}
