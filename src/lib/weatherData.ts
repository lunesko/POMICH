import type { WeatherData, WeatherCondition, SavedLocation } from "../types/weather"

const CONDITIONS: WeatherCondition[] = [
  "clear", "partly-cloudy", "cloudy", "rain", "heavy-rain",
  "thunderstorm", "snow", "fog", "windy",
]

const DESCRIPTIONS: Record<WeatherCondition, string> = {
  "clear": "Ясно",
  "partly-cloudy": "Переменная облачность",
  "cloudy": "Облачно",
  "rain": "Дождь",
  "heavy-rain": "Сильный дождь",
  "thunderstorm": "Гроза",
  "snow": "Снег",
  "fog": "Туман",
  "windy": "Ветрено",
}

const CONDITION_ICONS: Record<WeatherCondition, string> = {
  "clear": "☀️",
  "partly-cloudy": "⛅",
  "cloudy": "☁️",
  "rain": "🌧️",
  "heavy-rain": "🌧️",
  "thunderstorm": "⛈️",
  "snow": "🌨️",
  "fog": "🌫️",
  "windy": "💨",
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function generateMockWeather(location: string, country: string): WeatherData {
  const condition = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)]
  const baseTemp = condition === "snow" ? randomBetween(-10, 2)
    : condition === "clear" ? randomBetween(22, 35)
    : randomBetween(10, 25)

  const hours = Array.from({ length: 24 }, (_, i) => {
    const h = (new Date().getHours() + i) % 24
    const hCond = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)]
    return {
      time: `${h.toString().padStart(2, "0")}:00`,
      temp: baseTemp + randomBetween(-4, 4),
      condition: hCond,
      icon: CONDITION_ICONS[hCond],
    }
  })

  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
  const today = new Date().getDay()
  const daily = Array.from({ length: 7 }, (_, i) => {
    const dCond = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)]
    return {
      day: days[(today + i) % 7],
      high: baseTemp + randomBetween(0, 6),
      low: baseTemp - randomBetween(2, 8),
      condition: dCond,
      icon: CONDITION_ICONS[dCond],
    }
  })

  return {
    location,
    country,
    currentTemp: baseTemp,
    feelsLike: baseTemp + randomBetween(-3, 3),
    condition,
    description: DESCRIPTIONS[condition],
    humidity: randomBetween(30, 95),
    windSpeed: randomBetween(1, 25),
    uvIndex: randomBetween(0, 11),
    visibility: randomBetween(5, 20),
    pressure: randomBetween(740, 780),
    sunrise: "06:12",
    sunset: "20:48",
    hourly: hours,
    daily,
  }
}

export const POPULAR_CITIES: SavedLocation[] = [
  { id: "moscow", name: "Москва", country: "Россия", lat: 55.75, lon: 37.62 },
  { id: "spb", name: "Санкт-Петербург", country: "Россия", lat: 59.93, lon: 30.32 },
  { id: "london", name: "Лондон", country: "Великобритания", lat: 51.51, lon: -0.13 },
  { id: "nyc", name: "Нью-Йорк", country: "США", lat: 40.71, lon: -74.01 },
  { id: "tokyo", name: "Токио", country: "Япония", lat: 35.68, lon: 139.69 },
  { id: "paris", name: "Париж", country: "Франция", lat: 48.86, lon: 2.35 },
  { id: "dubai", name: "Дубай", country: "ОАЭ", lat: 25.2, lon: 55.27 },
  { id: "istanbul", name: "Стамбул", country: "Турция", lat: 41.01, lon: 28.98 },
  { id: "berlin", name: "Берлин", country: "Германия", lat: 52.52, lon: 13.41 },
  { id: "rome", name: "Рим", country: "Италия", lat: 41.9, lon: 12.5 },
  { id: "kazan", name: "Казань", country: "Россия", lat: 55.79, lon: 49.11 },
  { id: "sochi", name: "Сочи", country: "Россия", lat: 43.6, lon: 39.73 },
  { id: "novosibirsk", name: "Новосибирск", country: "Россия", lat: 55.03, lon: 82.92 },
  { id: "ekb", name: "Екатеринбург", country: "Россия", lat: 56.84, lon: 60.6 },
]

export function searchCities(query: string): SavedLocation[] {
  if (!query.trim()) return POPULAR_CITIES.slice(0, 6)
  const q = query.toLowerCase()
  return POPULAR_CITIES.filter(
    (c) => c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q),
  )
}
