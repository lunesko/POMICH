import { useState, useCallback, useEffect } from "react"
import type { SavedLocation, WeatherData } from "../../types/weather"
import { generateMockWeather, POPULAR_CITIES } from "../../lib/weatherData"
import WeatherBackground from "./WeatherBackground"
import CurrentWeather from "./CurrentWeather"
import HourlyForecast from "./HourlyForecast"
import DailyForecast from "./DailyForecast"
import WeatherDetails from "./WeatherDetails"
import LocationSearch from "./LocationSearch"
import ChatSettings from "./ChatSettings"

export default function WeatherApp() {
  const [location, setLocation] = useState<SavedLocation>(POPULAR_CITIES[0])
  const [weather, setWeather] = useState<WeatherData>(() =>
    generateMockWeather(POPULAR_CITIES[0].name, POPULAR_CITIES[0].country),
  )
  const [showSearch, setShowSearch] = useState(false)
  const [showChatSettings, setShowChatSettings] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadWeather = useCallback((loc: SavedLocation) => {
    setLocation(loc)
    setIsRefreshing(true)
    setTimeout(() => {
      setWeather(generateMockWeather(loc.name, loc.country))
      setIsRefreshing(false)
    }, 600)
  }, [])

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      () => {
        const geo: SavedLocation = {
          id: "geo",
          name: "Моё местоположение",
          country: "",
          lat: 0,
          lon: 0,
        }
        loadWeather(geo)
      },
      () => loadWeather(POPULAR_CITIES[0]),
    )
  }, [loadWeather])

  useEffect(() => {
    const interval = setInterval(() => {
      setWeather(generateMockWeather(location.name, location.country))
    }, 300_000)
    return () => clearInterval(interval)
  }, [location])

  return (
    <div className="min-h-screen relative">
      <WeatherBackground condition={weather.condition} />

      <div className={`relative z-10 transition-opacity duration-300 ${isRefreshing ? "opacity-50" : "opacity-100"}`}>
        <div className="absolute top-4 right-4 z-20">
          <button
            onClick={() => setShowChatSettings(true)}
            className="w-10 h-10 bg-white/15 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/20 hover:bg-white/25 transition-colors"
            title="Настройки чатов"
          >
            <span className="text-white text-sm">⚙️</span>
          </button>
        </div>

        <CurrentWeather weather={weather} onLocationTap={() => setShowSearch(true)} />
        <HourlyForecast hours={weather.hourly} />
        <DailyForecast days={weather.daily} />
        <WeatherDetails weather={weather} />
      </div>

      {showSearch && (
        <LocationSearch
          onSelect={loadWeather}
          onClose={() => setShowSearch(false)}
          onGeolocate={handleGeolocate}
        />
      )}
      {showChatSettings && (
        <ChatSettings onClose={() => setShowChatSettings(false)} />
      )}
    </div>
  )
}
