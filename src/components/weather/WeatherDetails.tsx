import type { WeatherData } from "../../types/weather"

function DetailCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-white/15 backdrop-blur-xl rounded-2xl p-3 border border-white/20">
      <div className="text-xs text-white/50 uppercase tracking-wider flex items-center gap-1">
        <span>{icon}</span> {label}
      </div>
      <div className="text-xl text-white font-medium mt-1">{value}</div>
    </div>
  )
}

export default function WeatherDetails({ weather }: { weather: WeatherData }) {
  return (
    <div className="relative z-10 mx-4 mt-3 grid grid-cols-2 gap-3 pb-8">
      <DetailCard icon="💧" label="Влажность" value={`${weather.humidity}%`} />
      <DetailCard icon="💨" label="Ветер" value={`${weather.windSpeed} м/с`} />
      <DetailCard icon="☀️" label="УФ-индекс" value={`${weather.uvIndex}`} />
      <DetailCard icon="👁️" label="Видимость" value={`${weather.visibility} км`} />
      <DetailCard icon="🌡️" label="Давление" value={`${weather.pressure} мм`} />
      <DetailCard icon="🌅" label="Восход" value={weather.sunrise} />
      <DetailCard icon="🌇" label="Закат" value={weather.sunset} />
      <DetailCard icon="🌡️" label="Ощущается" value={`${weather.feelsLike}°`} />
    </div>
  )
}
