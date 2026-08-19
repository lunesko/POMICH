export type WeatherCondition =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "rain"
  | "heavy-rain"
  | "thunderstorm"
  | "snow"
  | "fog"
  | "windy"

export interface HourlyForecast {
  time: string
  temp: number
  condition: WeatherCondition
  icon: string
}

export interface DailyForecast {
  day: string
  high: number
  low: number
  condition: WeatherCondition
  icon: string
}

export interface WeatherData {
  location: string
  country: string
  currentTemp: number
  feelsLike: number
  condition: WeatherCondition
  description: string
  humidity: number
  windSpeed: number
  uvIndex: number
  visibility: number
  pressure: number
  sunrise: string
  sunset: string
  hourly: HourlyForecast[]
  daily: DailyForecast[]
}

export interface SavedLocation {
  id: string
  name: string
  country: string
  lat: number
  lon: number
}

export interface ChatSettings {
  chatId: string
  chatTitle: string
  enabled: boolean
  intervalMinutes: number
  locationId: string
  showHourly: boolean
  showDaily: boolean
  lastSentAt?: string
}
