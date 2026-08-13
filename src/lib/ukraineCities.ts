/** Cities where POMICH roadside help is offered (Ужгород first as default). */
export const DEFAULT_SERVICE_CITY = "Ужгород"

export const UKRAINE_SERVICE_CITIES = [
  "Ужгород",
  "Мукачево",
  "Берегове",
  "Київ",
  "Біла Церква",
  "Вінниця",
  "Дніпро",
  "Житомир",
  "Запоріжжя",
  "Івано-Франківськ",
  "Кривий Ріг",
  "Кропивницький",
  "Луцьк",
  "Львів",
  "Миколаїв",
  "Одеса",
  "Полтава",
  "Рівне",
  "Суми",
  "Тернопіль",
  "Харків",
  "Херсон",
  "Хмельницький",
  "Черкаси",
  "Чернівці",
  "Чернігів",
] as const

export type UkraineServiceCity = (typeof UKRAINE_SERVICE_CITIES)[number]

const CITY_SET = new Set<string>(UKRAINE_SERVICE_CITIES)

/** Dropdown options: Ужгород first, then alphabetical (uk). */
export function ukraineCityOptions(): string[] {
  const rest = UKRAINE_SERVICE_CITIES.filter((city) => city !== DEFAULT_SERVICE_CITY).slice().sort((a, b) =>
    a.localeCompare(b, "uk"),
  )
  return [DEFAULT_SERVICE_CITY, ...rest]
}

export function isUkraineServiceCity(city: string | undefined | null): city is UkraineServiceCity {
  return Boolean(city && CITY_SET.has(String(city).trim()))
}

export interface CityValidation {
  valid: boolean
  value: string
  error?: string
  hint?: string
}

/** City must be picked from the service list (dropdown). */
export function validateServiceCity(raw: string): CityValidation {
  const value = String(raw || "").trim()
  if (!value) {
    return {
      valid: false,
      value,
      error: "Оберіть місто",
      hint: "Виберіть місто зі списку «Оберіть місто»",
    }
  }
  if (!isUkraineServiceCity(value)) {
    return {
      valid: false,
      value,
      error: "Місто не зі списку",
      hint: "Оберіть місто з випадаючого списку",
    }
  }
  return { valid: true, value }
}

export function normalizeServiceCity(raw: string | undefined | null, fallback = DEFAULT_SERVICE_CITY): string {
  const value = String(raw || "").trim()
  if (isUkraineServiceCity(value)) return value
  return fallback
}
