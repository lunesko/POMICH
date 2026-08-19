import { useState } from "react"
import type { ChatSettings as ChatSettingsType } from "../../types/weather"
import { POPULAR_CITIES } from "../../lib/weatherData"

const MOCK_CHATS: ChatSettingsType[] = [
  { chatId: "1", chatTitle: "Семья 👨‍👩‍👧‍👦", enabled: true, intervalMinutes: 360, locationId: "moscow", showHourly: true, showDaily: true },
  { chatId: "2", chatTitle: "Работа 💼", enabled: false, intervalMinutes: 720, locationId: "spb", showHourly: false, showDaily: true },
  { chatId: "3", chatTitle: "Друзья ✈️", enabled: true, intervalMinutes: 180, locationId: "dubai", showHourly: true, showDaily: false },
]

const INTERVALS = [
  { value: 60, label: "Каждый час" },
  { value: 180, label: "Каждые 3 часа" },
  { value: 360, label: "Каждые 6 часов" },
  { value: 720, label: "Каждые 12 часов" },
  { value: 1440, label: "Раз в день" },
]

export default function ChatSettings({ onClose }: { onClose: () => void }) {
  const [chats, setChats] = useState(MOCK_CHATS)
  const [expanded, setExpanded] = useState<string | null>(null)

  const toggleEnabled = (chatId: string) => {
    setChats((prev) =>
      prev.map((c) => (c.chatId === chatId ? { ...c, enabled: !c.enabled } : c)),
    )
  }

  const updateChat = (chatId: string, updates: Partial<ChatSettingsType>) => {
    setChats((prev) =>
      prev.map((c) => (c.chatId === chatId ? { ...c, ...updates } : c)),
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex flex-col">
      <div className="bg-gray-900/95 flex-1 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-white text-lg font-semibold">Настройки чатов</h2>
          <button onClick={onClose} className="text-blue-400 text-sm font-medium">
            Готово
          </button>
        </div>

        <div className="px-4 pt-4 pb-2 text-xs text-white/40 uppercase tracking-wider">
          Автоматическая отправка погоды в чаты
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-3 pb-8">
          {chats.map((chat) => {
            const loc = POPULAR_CITIES.find((c) => c.id === chat.locationId)
            const isExpanded = expanded === chat.chatId

            return (
              <div key={chat.chatId} className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
                <button
                  onClick={() => setExpanded(isExpanded ? null : chat.chatId)}
                  className="flex items-center justify-between w-full p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="text-left">
                      <div className="text-white text-sm font-medium">{chat.chatTitle}</div>
                      <div className="text-white/50 text-xs">{loc?.name ?? "—"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleEnabled(chat.chatId) }}
                      className={`w-12 h-7 rounded-full transition-colors cursor-pointer flex items-center px-0.5 ${
                        chat.enabled ? "bg-green-500" : "bg-white/20"
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-full bg-white shadow transition-transform ${
                          chat.enabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </div>
                    <span className={`text-white/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                      ▼
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-4">
                    <div>
                      <label className="text-xs text-white/50 mb-1 block">Город</label>
                      <select
                        value={chat.locationId}
                        onChange={(e) => updateChat(chat.chatId, { locationId: e.target.value })}
                        className="w-full bg-white/10 text-white rounded-xl px-3 py-2 text-sm outline-none"
                      >
                        {POPULAR_CITIES.map((c) => (
                          <option key={c.id} value={c.id} className="bg-gray-800">
                            {c.name}, {c.country}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-white/50 mb-1 block">Интервал</label>
                      <select
                        value={chat.intervalMinutes}
                        onChange={(e) => updateChat(chat.chatId, { intervalMinutes: Number(e.target.value) })}
                        className="w-full bg-white/10 text-white rounded-xl px-3 py-2 text-sm outline-none"
                      >
                        {INTERVALS.map((iv) => (
                          <option key={iv.value} value={iv.value} className="bg-gray-800">
                            {iv.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-white/70 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={chat.showHourly}
                          onChange={(e) => updateChat(chat.chatId, { showHourly: e.target.checked })}
                          className="accent-blue-400"
                        />
                        Почасовой
                      </label>
                      <label className="flex items-center gap-2 text-white/70 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={chat.showDaily}
                          onChange={(e) => updateChat(chat.chatId, { showDaily: e.target.checked })}
                          className="accent-blue-400"
                        />
                        На неделю
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <button className="w-full bg-blue-500/20 border border-blue-400/30 text-blue-400 rounded-2xl py-3 text-sm font-medium hover:bg-blue-500/30 transition-colors">
            + Добавить чат
          </button>
        </div>
      </div>
    </div>
  )
}
