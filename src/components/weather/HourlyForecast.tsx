import type { HourlyForecast as HourlyType } from "../../types/weather"

export default function HourlyForecast({ hours }: { hours: HourlyType[] }) {
  return (
    <div className="relative z-10 mx-4 mt-4">
      <div className="bg-white/15 backdrop-blur-xl rounded-2xl p-4 border border-white/20">
        <div className="text-xs text-white/60 uppercase tracking-wider mb-3 font-medium">
          Почасовой прогноз
        </div>
        <div className="flex overflow-x-auto gap-5 pb-1 scrollbar-hide">
          {hours.slice(0, 12).map((h, i) => (
            <div key={i} className="flex flex-col items-center min-w-[48px]">
              <span className="text-xs text-white/70">{i === 0 ? "Сейчас" : h.time}</span>
              <span className="text-xl my-1.5">{h.icon}</span>
              <span className="text-sm font-medium text-white">{h.temp}°</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
