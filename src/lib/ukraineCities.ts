/** Default city for profiles and map center when none is chosen. */
export const DEFAULT_SERVICE_CITY = "Київ"

/** User-facing label for nationwide directory / map scope. */
export const UKRAINE_WIDE_LABEL = "Вся Україна"

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

/** Dropdown options: default city first, then alphabetical (uk). */
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

export interface ServiceCityCenter {
  lat: number
  lng: number
}

/** Approximate map centers for service cities (WGS84). */
export const UKRAINE_SERVICE_CITY_CENTERS: Record<UkraineServiceCity, ServiceCityCenter> = {
  "Ужгород": { lat: 48.6208, lng: 22.2879 },
  "Мукачево": { lat: 48.4418, lng: 22.7178 },
  "Берегове": { lat: 48.2051, lng: 22.644 },
  "Київ": { lat: 50.4501, lng: 30.5234 },
  "Біла Церква": { lat: 49.7956, lng: 30.1164 },
  "Вінниця": { lat: 49.2331, lng: 28.4682 },
  "Дніпро": { lat: 48.4647, lng: 35.0462 },
  "Житомир": { lat: 50.2547, lng: 28.6587 },
  "Запоріжжя": { lat: 47.8388, lng: 35.1396 },
  "Івано-Франківськ": { lat: 48.9226, lng: 24.7111 },
  "Кривий Ріг": { lat: 47.9105, lng: 33.3918 },
  "Кропивницький": { lat: 48.5079, lng: 32.2623 },
  "Луцьк": { lat: 50.7472, lng: 25.3254 },
  "Львів": { lat: 49.8397, lng: 24.0297 },
  "Миколаїв": { lat: 46.975, lng: 31.9946 },
  "Одеса": { lat: 46.4825, lng: 30.7233 },
  "Полтава": { lat: 49.5883, lng: 34.5514 },
  "Рівне": { lat: 50.6199, lng: 26.2516 },
  "Суми": { lat: 50.9077, lng: 34.7981 },
  "Тернопіль": { lat: 49.5535, lng: 25.5948 },
  "Харків": { lat: 49.9935, lng: 36.2304 },
  "Херсон": { lat: 46.6354, lng: 32.6169 },
  "Хмельницький": { lat: 49.4229, lng: 26.9871 },
  "Черкаси": { lat: 49.4444, lng: 32.0598 },
  "Чернівці": { lat: 48.2921, lng: 25.9358 },
  "Чернігів": { lat: 51.4982, lng: 31.2893 },
}

export function serviceCityCenter(city: string | undefined | null, fallback = DEFAULT_SERVICE_CITY): ServiceCityCenter {
  const normalized = normalizeServiceCity(city, fallback)
  return UKRAINE_SERVICE_CITY_CENTERS[normalized as UkraineServiceCity]
}
