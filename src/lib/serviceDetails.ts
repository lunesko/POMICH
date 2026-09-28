import type { ServiceKey } from "./pomichDomain"

export type ServiceDetailAnswers = Record<string, string>

export interface ServiceDetails {
  version: 1
  service: ServiceKey
  answers: ServiceDetailAnswers
}

export interface ServiceDetailOption {
  value: string
  label: string
  hint?: string
}

export interface ServiceDetailQuestion {
  id: string
  label: string
  hint?: string
  options: readonly ServiceDetailOption[]
  when?: (answers: ServiceDetailAnswers) => boolean
}

const QUESTIONS: Record<ServiceKey, readonly ServiceDetailQuestion[]> = {
  tow: [
    {
      id: "incident",
      label: "Що сталося з авто?",
      options: [
        { value: "breakdown", label: "Поломка", hint: "Авто зупинилося або не їде" },
        { value: "accident", label: "Після ДТП", hint: "Є пошкодження після зіткнення" },
        { value: "relocation", label: "Потрібно перевезти", hint: "Без аварії або поломки" },
      ],
    },
    {
      id: "injuries",
      label: "Чи є постраждалі?",
      hint: "Якщо так — спочатку телефонуйте 112.",
      options: [
        { value: "no", label: "Немає постраждалих" },
        { value: "yes", label: "Є постраждалі" },
      ],
      when: (answers) => answers.incident === "accident",
    },
    {
      id: "mobility",
      label: "Чи можна котити авто?",
      options: [
        { value: "rolls", label: "Так, колеса крутяться" },
        { value: "locked", label: "Колеса або кермо заблоковані" },
        { value: "unknown", label: "Не знаю" },
      ],
    },
  ],
  battery: [
    {
      id: "symptom",
      label: "Як поводиться авто?",
      options: [
        { value: "silent", label: "Стартер мовчить" },
        { value: "clicks", label: "Чути клацання" },
        { value: "cranks", label: "Стартер крутить, двигун не запускається" },
        { value: "electric", label: "Електромобіль або гібрид" },
      ],
    },
    {
      id: "help",
      label: "Яка допомога потрібна?",
      options: [
        { value: "jump", label: "Запустити від іншого АКБ" },
        { value: "replace", label: "Замінити акумулятор" },
        { value: "diagnose", label: "Потрібна діагностика" },
      ],
    },
  ],
  wheel: [
    {
      id: "damage",
      label: "Скільки коліс пошкоджено?",
      options: [
        { value: "one", label: "Одне колесо" },
        { value: "multiple", label: "Два або більше" },
        { value: "unknown", label: "Не можу визначити" },
      ],
    },
    {
      id: "spare",
      label: "Чи є справна запаска?",
      options: [
        { value: "yes", label: "Так, є запаска" },
        { value: "no", label: "Запаски немає" },
        { value: "unknown", label: "Не знаю" },
      ],
    },
  ],
  fuel: [
    {
      id: "fuelType",
      label: "Яке пальне привезти?",
      options: [
        { value: "petrol95", label: "Бензин А-95" },
        { value: "petrol98", label: "Бензин А-98" },
        { value: "diesel", label: "Дизель" },
        { value: "lpg", label: "Газ LPG" },
        { value: "unknown", label: "Не знаю" },
      ],
    },
    {
      id: "amount",
      label: "Скільки пального потрібно?",
      options: [
        { value: "5", label: "5 літрів" },
        { value: "10", label: "10 літрів" },
        { value: "agree", label: "Узгодити з партнером" },
      ],
    },
  ],
  lockout: [
    {
      id: "keySituation",
      label: "Що сталося з ключами?",
      options: [
        { value: "inside", label: "Ключі залишилися всередині" },
        { value: "lost", label: "Ключі втрачені" },
        { value: "broken", label: "Ключ або замок зламаний" },
      ],
    },
    {
      id: "occupants",
      label: "Чи є хтось замкнений всередині?",
      options: [
        { value: "none", label: "Ні, салон порожній" },
        { value: "adult", label: "Так, доросла людина" },
        { value: "childPet", label: "Дитина або тварина" },
      ],
    },
  ],
  mechanic: [
    {
      id: "issue",
      label: "Яка несправність?",
      options: [
        { value: "overheating", label: "Перегрів двигуна" },
        { value: "fluid", label: "Витік рідини" },
        { value: "electrical", label: "Електрика або освітлення" },
        { value: "noise", label: "Сторонній шум" },
        { value: "other", label: "Інша несправність" },
      ],
    },
    {
      id: "mobility",
      label: "Чи може авто рухатися?",
      options: [
        { value: "drives", label: "Так, може рухатися" },
        { value: "stopped", label: "Ні, рух неможливий" },
        { value: "unsafe", label: "Рухається, але це небезпечно" },
      ],
    },
  ],
}

export const serviceDetailsHeadings: Record<ServiceKey, { title: string; subtitle: string }> = {
  tow: { title: "Підготуємо евакуатор", subtitle: "Уточніть стан авто, щоб партнер взяв потрібну техніку." },
  battery: { title: "Чому авто не заводиться?", subtitle: "Це допоможе взяти правильний пусковий пристрій або акумулятор." },
  wheel: { title: "Що з колесом?", subtitle: "Партнер зрозуміє, чи потрібна запаска або виїзний шиномонтаж." },
  fuel: { title: "Яке пальне потрібно?", subtitle: "Тип пального обов’язковий — помилка тут може пошкодити авто." },
  lockout: { title: "Як відкрити авто?", subtitle: "Уточніть ситуацію з ключами та чи є хтось усередині." },
  mechanic: { title: "Що потрібно полагодити?", subtitle: "Опишіть тип несправності та чи може авто рухатися." },
}

export function createServiceDetails(service: ServiceKey): ServiceDetails {
  return { version: 1, service, answers: {} }
}

export function serviceDetailQuestions(service: ServiceKey, answers: ServiceDetailAnswers): readonly ServiceDetailQuestion[] {
  return QUESTIONS[service].filter((question) => !question.when || question.when(answers))
}

export function serviceDetailsComplete(details: ServiceDetails): boolean {
  return serviceDetailQuestions(details.service, details.answers).every((question) => Boolean(details.answers[question.id]))
}

export function serviceDetailsEmergency(details: ServiceDetails): string | undefined {
  if (details.service === "tow" && details.answers.injuries === "yes") {
    return "Є постраждалі. Негайно зателефонуйте 112. POMICH не замінює екстрені служби."
  }
  if (details.service === "lockout" && details.answers.occupants === "childPet") {
    return "У салоні дитина або тварина. Негайно зателефонуйте 112, особливо у спеку або мороз."
  }
  return undefined
}

export function serviceDetailRows(details?: ServiceDetails | null): Array<{ label: string; value: string }> {
  if (!details || !QUESTIONS[details.service]) return []
  return serviceDetailQuestions(details.service, details.answers).flatMap((question) => {
    const selected = question.options.find((option) => option.value === details.answers[question.id])
    return selected ? [{ label: question.label, value: selected.label }] : []
  })
}

export function summarizeServiceDetails(details?: ServiceDetails | null): string {
  return serviceDetailRows(details).map((row) => row.value).join(" · ")
}

export function isServiceDetails(value: unknown): value is ServiceDetails {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ServiceDetails>
  return candidate.version === 1 && typeof candidate.service === "string" && Boolean(candidate.answers) && typeof candidate.answers === "object"
}
