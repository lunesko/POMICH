import type { LatLngTuple } from "leaflet"
import type { ProviderAvailability, VerificationStatus } from "../api/client"
import {
  PARTNER_VEHICLE_MAKE_OTHER,
  partnerVehicleMakes,
} from "./partnerVehicleCatalog"
import { calculateDistanceKm, type ServiceKey } from "./pomichDomain"
import { DEFAULT_SERVICE_CITY } from "./ukraineCities"
import { resolveProviderIdForCustomer, storeLinkedProviderId } from "./userAccount"

export { PARTNER_VEHICLE_MAKE_OTHER, partnerVehicleMakes } from "./partnerVehicleCatalog"

export type Role = "customer" | "provider" | "admin"

export type Screen =
  | "profile"
  | "home"
  | "location"
  | "destination"
  | "details"
  | "review"
  | "searching"
  | "accepted"
  | "assigned"
  | "tracking"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "error"

export type OrderStatus =
  | "draft"
  | "searching"
  | "accepted"
  | "price_confirmed"
  | "assigned"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"

export type GeoState = "requesting" | "success" | "permission-denied" | "unavailable" | "telegram"

export interface Point {
  lat: number
  lng: number
}

export interface Provider {
  id: string
  name: string
  rating: number
  vehicle: string
  plate: string
  phone: string
  telegram: string
  etaMinutes: number
  earnings: number
}

export interface PartnerRegistrationForm {
  name: string
  phone: string
  telegram: string
  vehicle: string
  vehicleMake: string
  vehicleMakeOther: string
  vehicleModel: string
  plate: string
  city: string
  specialties: ServiceKey[]
  serviceRadiusKm: number
  identityDocumentRef: string
  driverLicenseRef: string
  vehicleRegistrationRef: string
  serviceProofRef: string
  selfieRef: string
}

export function emptyPartnerRegistrationForm(): PartnerRegistrationForm {
  return {
    name: "",
    phone: "",
    telegram: "",
    vehicle: "",
    vehicleMake: "",
    vehicleMakeOther: "",
    vehicleModel: "",
    plate: "",
    city: DEFAULT_SERVICE_CITY,
    specialties: [],
    serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
    identityDocumentRef: "",
    driverLicenseRef: "",
    vehicleRegistrationRef: "",
    serviceProofRef: "",
    selfieRef: "",
  }
}

export function resolvePartnerVehicleMake(make: string, customMake = ""): string {
  const normalizedMake = make.trim()
  if (normalizedMake === PARTNER_VEHICLE_MAKE_OTHER) return customMake.trim()
  return normalizedMake
}

export function composePartnerVehicle(make: string, model: string, customMake = ""): string {
  const effectiveMake = resolvePartnerVehicleMake(make, customMake)
  const normalizedModel = model.trim()
  if (effectiveMake && normalizedModel) return `${effectiveMake} ${normalizedModel}`.trim()
  return effectiveMake
}

export function partnerVehicleSelectionIsComplete(make: string, customMake = "", model = ""): boolean {
  if (!make.trim()) return false
  if (make.trim() === PARTNER_VEHICLE_MAKE_OTHER) return Boolean(customMake.trim())
  return Boolean(make.trim())
}

export function hydratePartnerVehicleFromProfile(profile: {
  vehicle?: string
  vehicleMake?: string
  vehicleModel?: string
}): Pick<PartnerRegistrationForm, "vehicle" | "vehicleMake" | "vehicleMakeOther" | "vehicleModel"> {
  const storedMake = String(profile.vehicleMake || "").trim()
  const storedModel = String(profile.vehicleModel || "").trim()
  const vehicle = String(profile.vehicle || "").trim()
  const knownMakes = partnerVehicleMakes as readonly string[]

  if (storedMake && knownMakes.includes(storedMake)) {
    return {
      vehicleMake: storedMake,
      vehicleMakeOther: "",
      vehicleModel: storedModel,
      vehicle: composePartnerVehicle(storedMake, storedModel, ""),
    }
  }

  if (storedMake) {
    return {
      vehicleMake: PARTNER_VEHICLE_MAKE_OTHER,
      vehicleMakeOther: storedMake,
      vehicleModel: storedModel,
      vehicle: composePartnerVehicle(PARTNER_VEHICLE_MAKE_OTHER, storedModel, storedMake),
    }
  }

  for (const make of partnerVehicleMakes) {
    if (make === PARTNER_VEHICLE_MAKE_OTHER) continue
    if (vehicle === make || vehicle.startsWith(`${make} `)) {
      const model = vehicle === make ? storedModel : vehicle.slice(make.length).trim()
      return {
        vehicleMake: make,
        vehicleMakeOther: "",
        vehicleModel: model,
        vehicle: composePartnerVehicle(make, model, ""),
      }
    }
  }

  if (vehicle) {
    return {
      vehicleMake: PARTNER_VEHICLE_MAKE_OTHER,
      vehicleMakeOther: vehicle,
      vehicleModel: storedModel,
      vehicle: composePartnerVehicle(PARTNER_VEHICLE_MAKE_OTHER, storedModel, vehicle),
    }
  }

  return {
    vehicleMake: "",
    vehicleMakeOther: "",
    vehicleModel: "",
    vehicle: "",
  }
}

export const BRAND = "#16A36A"
export const DARK = "#111315"
export const BG = "#F6F7F8"
export const BORDER = "#E5E7EB"

/** Default provider service radius (km) — typical city + suburbs coverage. */
export const DEFAULT_SERVICE_RADIUS_KM = 15

export const PICKUP: Point = { lat: 48.6208, lng: 22.2879 }
export const DEFAULT_DESTINATION: Point = { lat: 48.6175, lng: 22.3056 }
export const PROVIDER_START: Point = { lat: 48.632, lng: 22.271 }

export const services = [
  { key: "tow", emoji: "🚛", label: "Евакуатор", tone: "#E8F8F1" },
  { key: "battery", emoji: "🔋", label: "Акумулятор", tone: "#EFF6FF" },
  { key: "wheel", emoji: "🛞", label: "Колесо", tone: "#FFF7ED" },
  { key: "fuel", emoji: "⛽", label: "Пальне", tone: "#F5F3FF" },
  { key: "lockout", emoji: "🔑", label: "Замок", tone: "#FCE7F3" },
  { key: "mechanic", emoji: "🔧", label: "Інше", tone: "#ECFCCB" },
] as const satisfies ReadonlyArray<{
  key: ServiceKey
  emoji: string
  label: string
  tone: string
}>

export const providerCapabilityLabels: Record<ServiceKey, string> = {
  tow: "Евакуатор",
  battery: "Акумулятор",
  wheel: "Шиномонтаж",
  fuel: "Пальне",
  lockout: "Відкрити авто",
  mechanic: "СТО",
}

/** Short customer-facing hint: what help they get for each service type. */
export const serviceDescriptions: Record<ServiceKey, string> = {
  tow: "Буксирування авто на СТО",
  battery: "Прикурити або замінити АКБ",
  wheel: "Прокол, заміна колеса",
  fuel: "Доставка пального",
  lockout: "Відкрити авто або ключі",
  mechanic: "Інша допомога на дорозі",
}

export const partnerRegistrationServices = services.filter((service) =>
  (["tow", "wheel", "battery", "fuel", "mechanic"] as ServiceKey[]).includes(service.key),
)

export const vehicleOptions = [
  "Авто заводиться",
  "Авто не заводиться",
  "Після ДТП",
  "Заблоковані колеса",
  "Інше",
] as const

export const orderStatusLabels: Record<OrderStatus, string> = {
  draft: "Чернетка",
  searching: "Очікуємо партнера",
  accepted: "Партнер прийняв",
  price_confirmed: "Ціна підтверджена",
  assigned: "Виконавця призначено",
  en_route: "Виконавець у дорозі",
  arrived: "Виконавець на місці",
  in_progress: "Допомога триває",
  completed: "Заявку завершено",
  cancelled: "Заявку скасовано",
}

export const provider: Provider = {
  id: "provider-oleksandr",
  name: "Олександр",
  rating: 4.9,
  vehicle: "Volkswagen Transporter",
  plate: "AO 1248 CH",
  phone: "+380671112233",
  telegram: "pomich_help_bot",
  etaMinutes: 12,
  earnings: 980,
}

export function getServiceLabel(service?: string): string {
  return services.find((item) => item.key === service)?.label ?? service ?? "Послуга"
}

export function getServiceDescription(service?: string): string {
  return serviceDescriptions[service as ServiceKey] ?? "Допомога на дорозі"
}

export function getProviderCapabilityLabel(service?: string): string {
  return providerCapabilityLabels[service as ServiceKey] ?? getServiceLabel(service)
}

export function toServiceKeys(value?: string[]): ServiceKey[] {
  return (value ?? []).filter((item): item is ServiceKey => services.some((service) => service.key === item))
}

export function getActiveProviderId(): string {
  if (typeof window === "undefined") return provider.id
  const fromQuery = new URLSearchParams(window.location.search).get("providerId")
  if (fromQuery) return fromQuery
  const customerId =
    window.sessionStorage.getItem("pomichCustomerId") ||
    window.localStorage.getItem("pomichCustomerId")
  const derived = customerId ? resolveProviderIdForCustomer(customerId) : ""
  const linked = window.sessionStorage.getItem("pomichLinkedProviderId") || ""
  // Drop stale seed link (provider-oleksandr) when the signed-in customer maps elsewhere.
  if (derived && linked && linked !== derived && linked === provider.id) {
    storeLinkedProviderId(derived)
    return derived
  }
  if (linked) return linked
  if (derived) return derived
  return provider.id
}

export function getServiceEmoji(service?: string): string {
  return services.find((item) => item.key === service)?.emoji ?? "🛠️"
}

export const directoryCategoryFilters = [
  { key: "all", emoji: "📍", label: "Усі сервіси", color: "#2F80ED" },
  { key: "mechanic", emoji: "🔧", label: "СТО", color: "#16A34A" },
  { key: "wheel", emoji: "🛞", label: "Шиномонтаж", color: "#EA580C" },
  { key: "fuel", emoji: "⛽", label: "Заправки", color: "#7C3AED" },
  { key: "tow", emoji: "🚛", label: "Евакуатори", color: "#111315" },
  { key: "battery", emoji: "🔋", label: "АКБ", color: "#0284C7" },
] as const

export type DirectoryCategoryKey = (typeof directoryCategoryFilters)[number]["key"]

export function getDirectoryPrimarySpecialty(item: { primarySpecialty?: string; specialties?: string[] }): ServiceKey {
  const primary = item.primarySpecialty as ServiceKey | undefined
  if (primary && services.some((s) => s.key === primary)) return primary
  const keys = toServiceKeys(item.specialties)
  return keys[0] ?? "mechanic"
}

export function getDirectoryIconEmoji(item: { primarySpecialty?: string; specialties?: string[] }): string {
  return getServiceEmoji(getDirectoryPrimarySpecialty(item))
}

export function getDirectoryIconColor(specialty: string): string {
  const match = directoryCategoryFilters.find((item) => item.key === specialty)
  return match?.color ?? "#2F80ED"
}

export function normalizeTelHref(phone?: string): string | undefined {
  if (!phone) return undefined
  const digits = phone.replace(/[^\d+]/g, "")
  return digits ? `tel:${digits}` : undefined
}

export function providerStatusLabel(status?: string): string {
  if (status === "online") return "На лінії"
  if (status === "busy") return "У роботі"
  return "Поза лінією"
}

export function verificationLabel(status?: VerificationStatus): string {
  if (status === "verified") return "Перевірено POMICH"
  if (status === "pending") return "На перевірці"
  if (status === "rejected") return "Потрібне оновлення"
  return "Не перевірено"
}

export function verificationTone(status?: VerificationStatus): { background: string; color: string; border: string } {
  if (status === "verified") return { background: "#E8F8F1", color: BRAND, border: "#BFEAD8" }
  if (status === "pending") return { background: "#FFF7ED", color: "#B45309", border: "#FED7AA" }
  if (status === "rejected") return { background: "#FFF1F2", color: "#BE123C", border: "#FECDD3" }
  return { background: "#F3F4F6", color: "#6B7280", border: BORDER }
}

export function isVerified(status?: VerificationStatus): boolean {
  return status === "verified"
}

export function isProviderPhoneVerified(profile?: Pick<ProviderAvailability, "verificationStatus" | "verification">): boolean {
  if (!profile) return false
  if (profile.verificationStatus === "verified") return true
  return Boolean(profile.verification?.phone)
}

export function providerPoint(item: ProviderAvailability): Point | undefined {
  if (!item.location) return undefined
  return { lat: item.location.lat, lng: item.location.lng }
}

/** Directory pins on the public map (OSM imports + legacy rows without providerKind). */
export function isDirectoryMapProvider(item: ProviderAvailability): boolean {
  if (item.providerKind === "directory") return true
  if (item.providerKind === "dispatch") return false
  return item.contactStatus === "directory_only" || Boolean(item.address || item.openingHours)
}

export function isProviderAvailable(item: ProviderAvailability): boolean {
  return (item.status === "online" || item.status === "busy") && isProviderPhoneVerified(item)
}

export function normalizeTelegramHref(telegram?: string): string | undefined {
  const handle = (telegram || "").trim().replace(/^@+/, "")
  if (!handle) return undefined
  return `https://t.me/${handle}`
}

export function distanceToProvider(pickup: Point, item: ProviderAvailability): number {
  const point = providerPoint(item)
  return point ? calculateDistanceKm(pickup, point) : Number.POSITIVE_INFINITY
}

export function nearbyProvidersFor(pickup: Point, providers: ProviderAvailability[]): ProviderAvailability[] {
  return providers
    .filter(isProviderAvailable)
    .slice()
    .sort((left, right) => distanceToProvider(pickup, left) - distanceToProvider(pickup, right))
}

export function toTuple(point: Point): LatLngTuple {
  return [point.lat, point.lng]
}
