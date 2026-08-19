import type { DailyForecast as DailyType } from "../../types/weather"

export default function DailyForecast({ days }: { days: DailyType[] }) {
  const maxHigh = Math.max(...days.map((d) => d.high))
  const minLow = Math.min(...days.map((d) => d.low))
  const range = maxHigh - minLow || 1

  return (
    <div className="relative z-10 mx-4 mt-3">
      <div className="bg-white/15 backdrop-blur-xl rounded-2xl p-4 border border-white/20">
        <div className="text-xs text-white/60 uppercase tracking-wider mb-3 font-medium">
          Прогноз на 7 дней
        </div>
        <div className="space-y-3">
          {days.map((d, i) => {
            const leftPct = ((d.low - minLow) / range) * 100
            const widthPct = ((d.high - d.low) / range) * 100
            return (
              <div key={i} className="flex items-center text-white">
                <span className="w-10 text-sm font-medium">
                  {i === 0 ? "Сегодня" : d.day}
                </span>
                <span className="w-8 text-center text-lg">{d.icon}</span>
                <span className="w-8 text-right text-sm opacity-60">{d.low}°</span>
                <div className="flex-1 mx-3 h-1 rounded-full bg-white/20 relative">
                  <div
                    className="absolute h-full rounded-full bg-gradient-to-r from-blue-300 to-orange-300"
                    style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 8)}%` }}
                  />
                </div>
                <span className="w-8 text-sm font-medium">{d.high}°</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
