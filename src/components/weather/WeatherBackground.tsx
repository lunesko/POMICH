import { useMemo } from "react"
import type { WeatherCondition } from "../../types/weather"

const GRADIENTS: Record<WeatherCondition, string> = {
  "clear": "from-sky-400 via-blue-500 to-blue-600",
  "partly-cloudy": "from-blue-400 via-blue-500 to-slate-500",
  "cloudy": "from-slate-400 via-slate-500 to-gray-600",
  "rain": "from-slate-500 via-gray-600 to-slate-700",
  "heavy-rain": "from-gray-600 via-slate-700 to-gray-800",
  "thunderstorm": "from-gray-700 via-purple-900 to-gray-900",
  "snow": "from-blue-200 via-slate-300 to-blue-300",
  "fog": "from-gray-300 via-slate-400 to-gray-400",
  "windy": "from-teal-400 via-cyan-500 to-blue-500",
}

function Raindrop({ delay, left }: { delay: number; left: number }) {
  return (
    <div
      className="absolute w-0.5 h-6 bg-white/30 rounded-full animate-rain"
      style={{ left: `${left}%`, animationDelay: `${delay}s` }}
    />
  )
}

function Snowflake({ delay, left, size }: { delay: number; left: number; size: number }) {
  return (
    <div
      className="absolute rounded-full bg-white/60 animate-snow"
      style={{
        left: `${left}%`,
        width: `${size}px`,
        height: `${size}px`,
        animationDelay: `${delay}s`,
      }}
    />
  )
}

function Cloud({ top, left, scale, opacity, speed }: {
  top: number; left: number; scale: number; opacity: number; speed: number
}) {
  return (
    <div
      className="absolute animate-cloud-drift"
      style={{
        top: `${top}%`,
        left: `${left}%`,
        transform: `scale(${scale})`,
        opacity,
        animationDuration: `${speed}s`,
      }}
    >
      <div className="flex">
        <div className="w-16 h-10 bg-white/40 rounded-full" />
        <div className="w-20 h-14 bg-white/40 rounded-full -ml-6 -mt-2" />
        <div className="w-14 h-10 bg-white/40 rounded-full -ml-5 mt-1" />
      </div>
    </div>
  )
}

function Lightning() {
  return (
    <div className="absolute inset-0 animate-lightning pointer-events-none">
      <div className="absolute inset-0 bg-white/20" />
    </div>
  )
}

function SunGlow() {
  return (
    <div className="absolute -top-20 -right-20 w-64 h-64 animate-pulse-slow">
      <div className="w-full h-full rounded-full bg-yellow-300/20 blur-3xl" />
    </div>
  )
}

function FogLayer({ top, opacity, speed }: { top: number; opacity: number; speed: number }) {
  return (
    <div
      className="absolute w-[200%] h-24 bg-white/20 blur-2xl animate-fog-drift"
      style={{ top: `${top}%`, opacity, animationDuration: `${speed}s` }}
    />
  )
}

export default function WeatherBackground({ condition }: { condition: WeatherCondition }) {
  const particles = useMemo(() => {
    if (condition === "rain" || condition === "heavy-rain") {
      const count = condition === "heavy-rain" ? 60 : 30
      return Array.from({ length: count }, (_, i) => (
        <Raindrop key={i} delay={Math.random() * 2} left={Math.random() * 100} />
      ))
    }
    if (condition === "snow") {
      return Array.from({ length: 40 }, (_, i) => (
        <Snowflake key={i} delay={Math.random() * 5} left={Math.random() * 100} size={2 + Math.random() * 4} />
      ))
    }
    return null
  }, [condition])

  const clouds = useMemo(() => {
    if (["cloudy", "partly-cloudy", "rain", "heavy-rain", "thunderstorm"].includes(condition)) {
      const count = condition === "partly-cloudy" ? 3 : 5
      return Array.from({ length: count }, (_, i) => (
        <Cloud
          key={i}
          top={5 + Math.random() * 30}
          left={-20 + Math.random() * 100}
          scale={0.6 + Math.random() * 0.8}
          opacity={condition === "partly-cloudy" ? 0.3 : 0.5}
          speed={30 + Math.random() * 40}
        />
      ))
    }
    return null
  }, [condition])

  return (
    <div className={`fixed inset-0 bg-gradient-to-b ${GRADIENTS[condition]} transition-all duration-1000 overflow-hidden`}>
      {condition === "clear" && <SunGlow />}
      {condition === "thunderstorm" && <Lightning />}
      {condition === "fog" && (
        <>
          <FogLayer top={20} opacity={0.4} speed={25} />
          <FogLayer top={45} opacity={0.3} speed={35} />
          <FogLayer top={70} opacity={0.5} speed={20} />
        </>
      )}
      {clouds}
      {particles}
    </div>
  )
}
