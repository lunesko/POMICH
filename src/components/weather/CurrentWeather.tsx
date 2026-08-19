import type { WeatherData } from "../../types/weather"

const CONDITION_EMOJI: Record<string, string> = {
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

export default function CurrentWeather({
  weather,
  onLocationTap,
}: {
  weather: WeatherData
  onLocationTap: () => void
}) {
  return (
    <div className="relative z-10 text-center text-white pt-12 pb-6 px-4">
      <button
        onClick={onLocationTap}
        className="text-lg font-medium tracking-wide opacity-90 hover:opacity-100 transition-opacity"
      >
        {weather.location}
        <span className="ml-1 text-sm opacity-70">▼</span>
      </button>
      <div className="text-[96px] font-extralight leading-none mt-1">
        {weather.currentTemp}°
      </div>
      <div className="text-xl mt-1 opacity-90">
        <span className="mr-2 text-2xl">{CONDITION_EMOJI[weather.condition]}</span>
        {weather.description}
      </div>
      <div className="text-sm mt-2 opacity-70 space-x-3">
        <span>Ощущается {weather.feelsLike}°</span>
        <span>·</span>
        <span>Влажность {weather.humidity}%</span>
        <span>·</span>
        <span>Ветер {weather.windSpeed} м/с</span>
      </div>
    </div>
  )
}
