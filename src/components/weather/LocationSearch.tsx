import { useState, useCallback } from "react"
import type { SavedLocation } from "../../types/weather"
import { searchCities } from "../../lib/weatherData"

export default function LocationSearch({
  onSelect,
  onClose,
  onGeolocate,
}: {
  onSelect: (loc: SavedLocation) => void
  onClose: () => void
  onGeolocate: () => void
}) {
  const [query, setQuery] = useState("")
  const results = searchCities(query)

  const handleSelect = useCallback(
    (loc: SavedLocation) => {
      onSelect(loc)
      onClose()
    },
    [onSelect, onClose],
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex flex-col">
      <div className="bg-gray-900/95 flex-1 flex flex-col">
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <div className="flex-1 relative">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Город, страна или населённый пункт..."
              className="w-full bg-white/10 text-white rounded-xl px-4 py-2.5 pl-10 text-sm placeholder:text-white/40 outline-none focus:ring-2 focus:ring-blue-400/50"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">🔍</span>
          </div>
          <button
            onClick={onClose}
            className="text-blue-400 text-sm font-medium"
          >
            Отмена
          </button>
        </div>

        <button
          onClick={() => { onGeolocate(); onClose() }}
          className="flex items-center gap-3 px-4 py-3 border-b border-white/10 hover:bg-white/5 transition-colors"
        >
          <span className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center text-xl">📍</span>
          <div className="text-left">
            <div className="text-white text-sm font-medium">Моё местоположение</div>
            <div className="text-white/50 text-xs">Определить по геолокации</div>
          </div>
        </button>

        <div className="flex-1 overflow-y-auto">
          {!query && (
            <div className="px-4 pt-4 pb-2 text-xs text-white/40 uppercase tracking-wider">
              Популярные города
            </div>
          )}
          {results.map((loc) => (
            <button
              key={loc.id}
              onClick={() => handleSelect(loc)}
              className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <span className="text-lg">🏙️</span>
              <div className="text-left">
                <div className="text-white text-sm">{loc.name}</div>
                <div className="text-white/50 text-xs">{loc.country}</div>
              </div>
            </button>
          ))}
          {query && results.length === 0 && (
            <div className="text-center text-white/40 text-sm py-12">
              Ничего не найдено
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
