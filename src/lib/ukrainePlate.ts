/** Latin letters used on standard Ukrainian license plates (2004+). */
export const UA_PLATE_LETTERS = "ABCEHIKMOPTX"

export const UA_PLATE_PLACEHOLDER = "AA 0000 AA"

export const UA_PLATE_VALIDATION_ERROR =
  "Введіть коректний номер авто (формат: AA 0000 AA). Можна латиницею або кирилицею."

export const UA_PLATE_INPUT_HINT =
  "Літери латиницею або кирилицею: A/А B/В C/С E/Е H/Н I/І K/К M/М O/О P/Р T/Т X/Х"

/**
 * Cyrillic plate lookalikes → canonical Latin plate alphabet.
 * Includes common case variants; lookup is also done after uppercasing.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A",
  а: "A",
  В: "B",
  в: "B",
  С: "C",
  с: "C",
  Е: "E",
  е: "E",
  Ё: "E",
  ё: "E",
  Н: "H",
  н: "H",
  І: "I",
  і: "I",
  Ї: "I",
  ї: "I",
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
  const compact = char.normalize("NFKC")
  const direct = CYRILLIC_TO_LATIN[compact]
  if (direct) return direct

  // Locale-safe uppercasing: Turkish `i` → `İ` must still become Latin I for plates.
  const upperUk = compact.toLocaleUpperCase("uk-UA")
  const mappedUpper = CYRILLIC_TO_LATIN[upperUk]
  if (mappedUpper) return mappedUpper

  const upper = compact.toUpperCase()
  if (CYRILLIC_TO_LATIN[upper]) return CYRILLIC_TO_LATIN[upper]

  // Latin dotted capital I (U+0130) from some mobile keyboards → I
  if (upper === "İ" || upper === "I" || compact === "i" || compact === "ı") return "I"

  return upper
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
  const source = String(raw || "").normalize("NFKC")

  for (const char of source) {
    if (char === " " || char === "-" || char === "–" || char === "—" || char === "_") continue
    // Ignore zero-width / BOM noise from mobile paste.
    if (char === "\u200B" || char === "\uFEFF" || char === "\u00A0") continue

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
