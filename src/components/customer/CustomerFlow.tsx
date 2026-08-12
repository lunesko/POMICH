import { useEffect, useMemo, useRef, useState } from "react"

import {
  BRAND,
  DARK,
  BG,
  BORDER,
  PICKUP,
  DEFAULT_DESTINATION,
  PROVIDER_START,
  services,
  provider,
  vehicleOptions,
  type Point,
  type OrderStatus,
  type Screen,
  type GeoState,
  type ServiceKey,
  getServiceEmoji,
  getProviderCapabilityLabel,
  toServiceKeys,
  providerStatusLabel,
  isVerified,
  nearbyProvidersFor,
  distanceToProvider,
} from "../../lib/constants"
import {
  authSessionStorageKey,
  guestSessionCustomerIdForRestore,
  isExplicitLogout,
  persistCustomerId,
  readPersistedCustomerId,
  readStoredAuthSession,
  storeAuthSession,
} from "../../lib/auth"
import {
  calculateDistanceKm,
  sanitizeLocation,
  validateCustomerOrderInput,
  type CustomerOrderInput,
} from "../../lib/pomichDomain"
import {
  createOrder,
  confirmOrderPrice,
  getOrder,
  getProviders,
  cancelOrder as cancelOrderRequest,
  retryDispatch,
  createTelegramCustomerSession,
  createGuestCustomerSession,
  getTelegramSession,
  updateCustomerProfile,
  type ProviderAvailability,
  type OrderResponse,
  type CustomerProfile,
  type AuthSession,
  type DispatchOffer,
} from "../../api/client"
import { clearActiveOrder, persistActiveOrder, readActiveOrder } from "../../lib/customerSession"
import { getTelegramContext } from "../../telegram"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { PrimaryButton } from "../ui/PrimaryButton"
import { SecondaryButton } from "../ui/SecondaryButton"
import { StatusPill } from "../ui/StatusPill"
import { Timeline } from "../ui/Timeline"
import { VerificationPill } from "../ui/VerificationPill"
import { ProviderCard } from "../ui/ProviderCard"
import { RouteMap } from "../map/RouteMap"
import { Header } from "../layout/Header"
import { RideScreen } from "../layout/RideScreen"
import { SheetHeading } from "../layout/SheetHeading"
import { LocationRow } from "../layout/LocationRow"
import { SheetDivider } from "../layout/SheetDivider"
import { OrderErrorStep, OrderFinalStep } from "./OrderTerminalStep"

function interpolate(from: Point, to: Point, progress: number): Point {
  const ratio = Math.max(0, Math.min(100, progress)) / 100
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
  }
}

function normalizeOrderStatus(status?: string): OrderStatus {
  if (status === "searching" || status === "accepted" || status === "price_confirmed" || status === "assigned" || status === "en_route" || status === "arrived" || status === "in_progress" || status === "completed" || status === "cancelled" || status === "draft") {
    return status
  }
  if (status === "created" || status === "matching") return "searching"
  if (status === "tracking") return "en_route"
  return "draft"
}

function screenForOrderStatus(status: OrderStatus): Screen {
  if (status === "searching") return "searching"
  if (status === "accepted") return "accepted"
  if (status === "price_confirmed" || status === "assigned") return "assigned"
  if (status === "en_route") return "tracking"
  if (status === "arrived") return "arrived"
  if (status === "in_progress") return "in_progress"
  if (status === "completed") return "completed"
  if (status === "cancelled") return "cancelled"
  return "home"
}

function AvailabilityPanel({ pickup, providers, loading }: { pickup: Point; providers: ProviderAvailability[]; loading: boolean }) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const nearest = nearby[0]

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 950, color: DARK }}>{loading ? "Перевіряємо партнерів" : nearby.length > 0 ? `${nearby.length} на лінії поруч` : "Партнерів поруч не видно"}</div>
          <div style={{ color: "#6B7280", fontWeight: 700, fontSize: 12, marginTop: 4 }}>{nearest ? `Найближчий: ${nearest.name} · ~${nearest.etaMinutes ?? Math.ceil(distanceToProvider(pickup, nearest) * 4)} хв` : "Можна створити заявку, диспетчер підключить найближчого вручну."}</div>
        </div>
        <div style={{ borderRadius: 999, padding: "7px 10px", background: nearby.length > 0 ? "#E8F8F1" : "#FFF7ED", color: nearby.length > 0 ? BRAND : "#B45309", fontSize: 12, fontWeight: 950 }}>
          {nearby.length > 0 ? "Live" : "Очікування"}
        </div>
      </div>
      {nearby.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {nearby.slice(0, 2).map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: BG, borderRadius: 14, padding: "10px 12px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: DARK, fontWeight: 900, fontSize: 13 }}>{item.name} · {item.vehicle ?? "Автодопомога"}</div>
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 700, marginTop: 2 }}>{providerStatusLabel(item.status)} · {distanceToProvider(pickup, item).toFixed(1)} км</div>
                <div style={{ color: "#6B7280", fontSize: 11, fontWeight: 800, marginTop: 3 }}>{toServiceKeys(item.specialties).map(getProviderCapabilityLabel).join(" · ") || "Послуги уточнюються"}</div>
                <div style={{ marginTop: 7 }}><VerificationPill status={item.verificationStatus} /></div>
              </div>
              <div style={{ color: BRAND, fontWeight: 950, whiteSpace: "nowrap" }}>~{item.etaMinutes ?? Math.ceil(distanceToProvider(pickup, item) * 4)} хв</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CustomerTrustPanel({
  profile,
  saving,
  error,
  onVerify,
}: {
  profile: CustomerProfile
  saving: boolean
  error?: string
  onVerify: () => void
}) {
  const initials = (profile.name || "POMICH").trim().slice(0, 1).toUpperCase()

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950, fontSize: 20, flex: "0 0 auto" }}>{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: DARK, fontWeight: 950, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{profile.name || "Клієнт POMICH"}</div>
            <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800, marginTop: 3 }}>{profile.city || "місто не вказано"} · ★ {profile.rating ?? 5} · {profile.ordersCompleted ?? 0} заявок</div>
            <div style={{ marginTop: 7 }}><VerificationPill profile={profile} /></div>
          </div>
        </div>
      </div>
      <button onClick={onVerify} disabled={saving} style={{ minHeight: 42, borderRadius: 14, border: `1px solid ${BORDER}`, background: saving ? "#E5E7EB" : "#F9FAFB", color: DARK, fontFamily: "inherit", fontWeight: 950, cursor: saving ? "not-allowed" : "pointer" }}>
        {saving ? "Зберігаємо…" : "Зберегти профіль"}
      </button>
      {error ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 12, padding: 10, fontSize: 12, fontWeight: 850 }}>{error}</div> : null}
    </div>
  )
}

function HomeStep({
  pickup,
  locationLabel,
  providers,
  providersLoading,
  customerProfile,
  customerVerificationSaving,
  customerVerificationError,
  onVerifyCustomer,
  onSelect,
}: {
  pickup: Point
  locationLabel: string
  providers: ProviderAvailability[]
  providersLoading: boolean
  customerProfile: CustomerProfile
  customerVerificationSaving: boolean
  customerVerificationError?: string
  onVerifyCustomer: () => void
  onSelect: (service: ServiceKey) => void
}) {
  const nearby = nearbyProvidersFor(pickup, providers)
  return (
    <RideScreen pickup={pickup} providers={providers} mapSubtitle={locationLabel}>
      <div data-sheet-full>
      <SheetHeading title="Потрібна допомога на дорозі?" subtitle="Оберіть проблему, а POMICH знайде найближчого перевіреного партнера." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: "#F9FAFB" }}>
        <LocationRow icon="●" title="Поточне місце" subtitle={locationLabel} active />
        <SheetDivider />
        <LocationRow icon="🏁" title="Куди везти або де ремонтувати" subtitle="Уточнимо після вибору послуги" />
      </div>

      <div style={{ marginTop: 14 }}>
        <CustomerTrustPanel profile={customerProfile} saving={customerVerificationSaving} error={customerVerificationError} onVerify={onVerifyCustomer} />
      </div>

      <div style={{ marginTop: 14 }}>
        <AvailabilityPanel pickup={pickup} providers={providers} loading={providersLoading} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 18, marginBottom: 10 }}>
        <div style={{ fontWeight: 950, fontSize: 18, color: DARK }}>Що сталося?</div>
        <div style={{ borderRadius: 999, padding: "7px 10px", background: nearby.length > 0 ? "#E8F8F1" : "#FFF7ED", color: nearby.length > 0 ? BRAND : "#B45309", fontSize: 12, fontWeight: 950 }}>
          {nearby.length > 0 ? "~12 хв" : "диспетчер"}
        </div>
      </div>

      <div style={{ display: "grid", gap: 9 }}>
        {services.map((service) => (
          <button key={service.key} onClick={() => onSelect(service.key as ServiceKey)} style={{ minHeight: 64, display: "grid", gridTemplateColumns: "44px 1fr auto", alignItems: "center", gap: 12, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "11px 12px", background: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 22px rgba(17,19,21,0.04)" }}>
            <span style={{ width: 44, height: 44, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", background: service.tone, fontSize: 21 }}>{service.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 950, color: DARK }}>{service.label}</span>
              <span style={{ display: "block", marginTop: 3, fontSize: 12, fontWeight: 750, color: "#6B7280" }}>{nearby.length > 0 ? "Найближчий партнер поруч" : "Підключимо диспетчера"}</span>
            </span>
            <span style={{ color: BRAND, fontWeight: 950, fontSize: 13 }}>›</span>
          </button>
        ))}
      </div>
      </div>

      <div data-sheet-peek>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 4, marginBottom: 8 }}>
          <div style={{ fontWeight: 950, fontSize: 18, color: DARK }}>Що сталося?</div>
          <div style={{ borderRadius: 999, padding: "7px 10px", background: nearby.length > 0 ? "#E8F8F1" : "#FFF7ED", color: nearby.length > 0 ? BRAND : "#B45309", fontSize: 12, fontWeight: 950 }}>
            {nearby.length > 0 ? "~12 хв" : "диспетчер"}
          </div>
        </div>
        {services[0] ? (
          <button onClick={() => onSelect(services[0].key as ServiceKey)} style={{ minHeight: 64, width: "100%", display: "grid", gridTemplateColumns: "44px 1fr auto", alignItems: "center", gap: 12, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "11px 12px", background: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ width: 44, height: 44, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", background: services[0].tone, fontSize: 21 }}>{services[0].emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 950, color: DARK }}>{services[0].label}</span>
              <span style={{ display: "block", marginTop: 3, fontSize: 12, fontWeight: 750, color: "#6B7280" }}>Проведіть вгору для всіх послуг</span>
            </span>
            <span style={{ color: BRAND, fontWeight: 950, fontSize: 13 }}>›</span>
          </button>
        ) : null}
      </div>
    </RideScreen>
  )
}

function LocationStep({
  pickup,
  addressLabel,
  geoMessage,
  geoLoading,
  geoError,
  onPick,
  onRetryGeo,
  onBack,
  onNext,
}: {
  pickup: Point
  addressLabel: string
  geoMessage: string
  geoLoading?: boolean
  geoError?: string
  onPick: (point: Point) => void
  onRetryGeo: () => void
  onBack: () => void
  onNext: () => void
}) {
  const geoStatusHint = geoError ? undefined : geoLoading ? "Визначаємо ваше місцезнаходження…" : geoMessage

  return (
    <RideScreen pickup={pickup} mapSubtitle="Ваше місцезнаходження · перетягніть маркер" onPick={onPick} mapFocus onRetryGeo={onRetryGeo} geoLoading={geoLoading}>
      <div data-sheet-peek>
        <SheetHeading title="Де ви зараз?" subtitle={geoLoading ? "Визначаємо адресу…" : addressLabel} />
      </div>
      <div data-sheet-full>
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Де ви зараз?" subtitle="Це місце, де вас знайде партнер. Перетягніть маркер на карті або натисніть, щоб уточнити." />

      <div style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px 10px", background: "#F9FAFB" }}>
        <LocationRow icon="📍" title="Адреса" subtitle={geoLoading ? "Визначаємо адресу…" : addressLabel} active />
        {geoStatusHint ? (
          <div style={{ margin: "0 0 8px 47px", color: "#6B7280", fontSize: 11, fontWeight: 750, lineHeight: 1.35 }}>{geoStatusHint}</div>
        ) : null}
      </div>

      {geoError ? (
        <div style={{ marginTop: 10, background: "#FFF7ED", color: "#B45309", borderRadius: 14, padding: "10px 12px", fontSize: 12, fontWeight: 800 }}>
          {geoError}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <PrimaryButton label="Підтвердити місце" onClick={onNext} />
      </div>
      </div>
    </RideScreen>
  )
}

function DestinationStep({ pickup, destination, value, onPick, onChange, onNext, onBack }: { pickup: Point; destination: Point; value: string; onPick: (point: Point) => void; onChange: (value: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle="Маршрут до призначення">
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Куди доставити авто?" subtitle="Введіть СТО, адресу або точку, куди має їхати виконавець." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: "#F9FAFB" }}>
        <LocationRow icon="●" title="Звідки" subtitle="Поточне місце клієнта" active />
        <SheetDivider />
        <LocationRow icon="🏁" title="Куди" subtitle={value || "Оберіть призначення"} />
      </div>

      <label style={{ display: "grid", gap: 8, marginTop: 16 }}>
        <span style={{ fontWeight: 900, color: DARK }}>Адреса доставки</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Наприклад: СТО «Авторемонт»" style={{ width: "100%", minHeight: 50, padding: "0 14px", borderRadius: 16, border: `1px solid ${BORDER}`, fontSize: 15, fontWeight: 750, fontFamily: "inherit" }} />
      </label>
      <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 750, marginTop: 8 }}>Точка: {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</div>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton label="Далі" onClick={onNext} disabled={!value.trim()} />
      </div>
    </RideScreen>
  )
}

function DetailsStep({ pickup, destination, value, onChange, onNext, onBack }: { pickup: Point; destination: Point; value: string; onChange: (value: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle="Підбір виконавця">
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Що з автомобілем?" subtitle="Це допоможе підібрати правильний транспорт, інструменти та ETA." />

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {vehicleOptions.map((option) => (
          <button key={option} onClick={() => onChange(option)} style={{ minHeight: 54, padding: "12px 14px", borderRadius: 16, border: value === option ? `1.5px solid ${BRAND}` : `1px solid ${BORDER}`, background: value === option ? "#E8F8F1" : "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, color: DARK }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span>{option}</span>
              <span style={{ color: value === option ? BRAND : "#9CA3AF" }}>{value === option ? "✓" : "○"}</span>
            </span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <PrimaryButton label="Далі" onClick={onNext} disabled={!value} />
      </div>
    </RideScreen>
  )
}

function ReviewStep({ serviceLabel, pickup, destination, vehicleState, loading, onConfirm, onBack }: { serviceLabel: string; pickup: Point; destination: Point; vehicleState: string; loading: boolean; onConfirm: () => void; onBack: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle="Перевірка заявки">
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Перевірте заявку" subtitle="Ціну та ETA побачите після того, як партнер прийме заявку." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: "#F9FAFB" }}>
        <LocationRow icon="🛠️" title="Послуга" subtitle={serviceLabel} active />
        <SheetDivider />
        <LocationRow icon="🚗" title="Стан авто" subtitle={vehicleState} />
      </div>

      <div style={{ marginTop: 12, background: "#EFF6FF", color: "#1D4ED8", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
        Після надсилання заявки перевірені партнери побачать ваше місцезнаходження та зможуть запропонувати ціну.
      </div>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton label="Надіслати заявку" onClick={onConfirm} loading={loading} disabled={loading} />
      </div>
    </RideScreen>
  )
}

function SearchingStep({ orderId, status, order, pickup, destination, onCancel, onRetryDispatch }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onCancel: () => void; onRetryDispatch: () => void }) {
  const noProviders = order?.dispatchState === "NO_PROVIDERS_AVAILABLE"
  const offersSent = order?.dispatchInfo?.offersSent ?? order?.offers?.length ?? 0
  return (
    <RideScreen pickup={pickup} destination={destination} providers={order?.assignedProvider ? [order.assignedProvider] : undefined} mapSubtitle={orderId ? `#${orderId}` : "Очікуємо партнера"}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Очікуємо партнера" subtitle={noProviders ? "Немає вільних партнерів поруч" : orderId ? `Замовлення #${orderId}` : "Шукаємо найближчого перевіреного партнера…"} />
        <StatusPill status={status} />
      </div>

      <div style={{ position: "relative", height: 142, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 8 }}>
        {[0, 1, 2].map((item) => (
          <div key={item} className="pulse-ring" style={{ position: "absolute", width: 70 + item * 42, height: 70 + item * 42, borderRadius: 999, background: BRAND, opacity: 0.12 }} />
        ))}
        <div style={{ width: 72, height: 72, borderRadius: 24, background: "#111315", boxShadow: "0 16px 36px rgba(17,19,21,0.24)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🚛</div>
      </div>

      <div style={{ color: "#6B7280", fontWeight: 750, lineHeight: 1.4 }}>{noProviders ? "Можна повторити пошук без створення нової заявки." : offersSent > 0 ? `Звернулися до ${offersSent} виконавців. Перший, хто підтвердить, отримає заявку.` : "Показуємо заявку найближчим перевіреним партнерам."}</div>
      <div style={{ marginTop: 16 }}><Timeline status={status} /></div>
      <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
        {["Перевіряємо доступність", "Порівнюємо ETA та рейтинг", "Фіксуємо деталі заявки"].map((item) => (
          <div key={item} style={{ background: "#F9FAFB", borderRadius: 15, border: `1px solid ${BORDER}`, padding: "12px 14px", fontWeight: 850, color: DARK }}>✓ {item}</div>
        ))}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {noProviders ? <PrimaryButton label="Спробувати ще раз" onClick={onRetryDispatch} /> : null}
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function AcceptedStep({ orderId, status, order, pickup, destination, confirming, confirmError, onConfirmPrice, onContact, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; confirming: boolean; confirmError?: string; onConfirmPrice: () => void; onContact: () => void; onCancel: () => void }) {
  const assignedProvider = order?.assignedProvider
  const eta = assignedProvider?.etaMinutes ?? provider.etaMinutes
  const proposedPrice = order?.partnerProposedPrice

  return (
    <RideScreen pickup={pickup} destination={destination} providers={assignedProvider ? [assignedProvider] : undefined} mapSubtitle="Партнер запропонував ціну">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Партнер прийняв заявку" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={assignedProvider} />
        <div style={{ background: "#111315", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Запропонована ціна</div>
          <div style={{ fontSize: 32, fontWeight: 950, marginTop: 6 }}>{typeof proposedPrice === "number" ? `${proposedPrice.toLocaleString("uk-UA")} ₴` : "—"}</div>
          <div style={{ color: "#CBD5E1", marginTop: 6, fontWeight: 700 }}>ETA ~{eta} хв</div>
        </div>
        {confirmError ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{confirmError}</div> : null}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label={confirming ? "Підтверджуємо…" : "Підтвердити ціну"} onClick={onConfirmPrice} loading={confirming} disabled={confirming || typeof proposedPrice !== "number"} />
        <SecondaryButton label="Зв'язатися" onClick={onContact} />
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function AssignedStep({ orderId, status, order, pickup, destination, onTrack, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onTrack: () => void; onCancel: () => void }) {
  const assignedProvider = order?.assignedProvider
  return (
    <RideScreen pickup={pickup} destination={destination} providers={assignedProvider ? [assignedProvider] : undefined} mapSubtitle="Ціна підтверджена">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Допомога їде до вас" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={assignedProvider?.etaMinutes ?? provider.etaMinutes} assignedProvider={assignedProvider} />
        <div style={{ background: "#fff", borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
        </div>
        <div style={{ background: "#E8F8F1", borderRadius: 18, padding: 14, color: DARK, fontWeight: 800 }}>{assignedProvider?.name ?? "Партнер"} підтвердив ціну та їде до вас.</div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label="Дивитися маршрут" onClick={onTrack} />
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function TrackingStep({ orderId, status, order, pickup, destination, progress, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; progress: number; onCancel: () => void }) {
  const start = order?.assignedProvider?.location ?? PROVIDER_START
  const providerPosition = interpolate(start, pickup, Math.min(progress, 92))
  const eta = Math.max(1, Math.ceil((100 - progress) / 12))

  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={providerPosition} mapSubtitle={`ETA ${eta} хв · ${Math.round(progress)}% маршруту`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Виконавець у дорозі" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <div style={{ background: "#111315", color: "#fff", borderRadius: 999, padding: "9px 12px", fontWeight: 950 }}>{eta} хв</div>
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={order?.assignedProvider} />
        <div style={{ background: "#fff", borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ height: 9, background: "#EDF2F7", borderRadius: 999, marginTop: 14 }}>
            <div style={{ width: `${Math.max(8, progress)}%`, height: "100%", borderRadius: 999, background: BRAND }} />
          </div>
          <div style={{ color: "#6B7280", fontSize: 13, fontWeight: 700, marginTop: 8 }}>{progress > 82 ? "Виконавець поруч із вами." : "Виконавець рухається до точки подачі."}</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label={`Очікувати · ${eta} хв`} disabled />
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function ArrivedStep({ orderId, status, order, pickup, destination, onComplete, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onComplete: () => void; onCancel: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={pickup} mapSubtitle="Виконавець на місці">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Виконавець на місці" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} assignedProvider={order?.assignedProvider} />
        <div style={{ background: "#fff", borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ marginTop: 16, fontWeight: 900, color: DARK }}>Допомога надається</div>
          <div style={{ marginTop: 6, color: "#6B7280", fontWeight: 700 }}>Після завершення підтвердьте заявку, щоб оновити статус у POMICH.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label="Очікуємо початок робіт" onClick={onComplete} disabled />
        <SecondaryButton label="Скасувати" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function InProgressStep({ orderId, status, order, pickup, destination, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onCancel: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={pickup} mapSubtitle="Допомога триває">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Допомога триває" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} assignedProvider={order?.assignedProvider} />
        <div style={{ background: "#fff", borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ marginTop: 16, fontWeight: 900, color: DARK }}>Виконавець працює із заявкою</div>
          <div style={{ marginTop: 6, color: "#6B7280", fontWeight: 700 }}>Статус оновиться автоматично після завершення робіт у системі.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label="Очікуємо завершення робіт" disabled />
        <SecondaryButton label="Скасувати" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}


function CustomerFlow() {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const initialCustomerId = useMemo(() => readPersistedCustomerId(telegramContext.chatId), [telegramContext.chatId])
  const [customerId, setCustomerId] = useState(initialCustomerId)
  const [customerAccessToken, setCustomerAccessToken] = useState<string | undefined>(() => readStoredAuthSession(authSessionStorageKey("customer", initialCustomerId), "customer", initialCustomerId))
  const customerAuthToken = customerAccessToken
  const restoredActiveOrder = useMemo(() => readActiveOrder(), [])
  const [screen, setScreen] = useState<Screen>(() => {
    const restoredStatus = restoredActiveOrder?.status
    if (!restoredStatus) return "home"
    const normalized = normalizeOrderStatus(restoredStatus)
    return normalized === "draft" ? "home" : screenForOrderStatus(normalized)
  })
  const [selectedService, setSelectedService] = useState<ServiceKey>("tow")
  const [destination, setDestination] = useState("СТО «Авторемонт»")
  const [vehicleState, setVehicleState] = useState("Авто заводиться")
  const [loading, setLoading] = useState(false)
  const [priceConfirming, setPriceConfirming] = useState(false)
  const [priceConfirmError, setPriceConfirmError] = useState<string | undefined>()
  const [orderId, setOrderId] = useState<string | undefined>(() => restoredActiveOrder?.orderId)
  const [currentOrder, setCurrentOrder] = useState<OrderResponse | undefined>()
  const [status, setStatus] = useState<OrderStatus>(() => {
    const restoredStatus = restoredActiveOrder?.status
    return restoredStatus ? normalizeOrderStatus(restoredStatus) : "draft"
  })
  const [geoState, setGeoState] = useState<GeoState>("requesting")
  const [geoMessage, setGeoMessage] = useState("Визначаємо ваше місцезнаходження…")
  const [pickup, setPickup] = useState<Point>(PICKUP)
  const [destinationPoint, setDestinationPoint] = useState<Point>(DEFAULT_DESTINATION)
  const [trackingProgress, setTrackingProgress] = useState(12)
  const [nearbyProviders, setNearbyProviders] = useState<ProviderAvailability[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile>({
    id: customerId,
    name: telegramContext.user?.first_name ? `${telegramContext.user.first_name}${telegramContext.user.last_name ? ` ${telegramContext.user.last_name}` : ""}` : "Клієнт POMICH",
    phone: "",
    telegram: telegramContext.user?.username,
    city: "",
    rating: 5,
    ordersCompleted: 0,
    verificationStatus: "unverified",
    trustedBadges: ["Телефон", "Профіль"],
    profileCompleteness: telegramContext.user?.username ? 62 : 45,
  })
  const [customerVerificationSaving, setCustomerVerificationSaving] = useState(false)
  const [customerVerificationError, setCustomerVerificationError] = useState<string | undefined>()
  const userInitiatedCancelRef = useRef(false)

  const orderInput: CustomerOrderInput = {
    service: selectedService,
    customerLocation: "вул. Собранецька, Ужгород",
    destination,
    distanceKm: calculateDistanceKm(pickup, destinationPoint),
  }

  const applyCustomerSession = (session: AuthSession) => {
    const nextCustomerId = session.customerId ?? session.subjectId
    if (!nextCustomerId || !session.accessToken) return
    setCustomerId(nextCustomerId)
    setCustomerAccessToken(session.accessToken)
    storeAuthSession(authSessionStorageKey("customer", nextCustomerId), session)
    persistCustomerId(nextCustomerId)
    if (session.profile) setCustomerProfile((profile) => ({ ...profile, ...session.profile, id: nextCustomerId }))
  }

  const ensureCustomerSession = async () => {
    if (customerAuthToken) return { customerId, token: customerAuthToken }
    const session = telegramContext.initData && !isExplicitLogout(telegramContext.chatId)
      ? await createTelegramCustomerSession(telegramContext.initData)
      : await createGuestCustomerSession(guestSessionCustomerIdForRestore(customerId))
    applyCustomerSession(session)
    return { customerId: session.customerId ?? session.subjectId, token: session.accessToken }
  }

  useEffect(() => {
    telegramContext.webApp?.ready?.()
    telegramContext.webApp?.expand?.()
  }, [telegramContext.webApp])

  useEffect(() => {
    if (!telegramContext.initData || isExplicitLogout(telegramContext.chatId)) return
    let cancelled = false

    createTelegramCustomerSession(telegramContext.initData)
      .then((session) => {
        if (!cancelled) applyCustomerSession(session)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [telegramContext.initData])

  useEffect(() => {
    if (!telegramContext.chatId || !telegramContext.initData) return

    getTelegramSession(telegramContext.chatId, telegramContext.initData)
      .then((session) => {
        if (session.customerId) setCustomerId(session.customerId)
        if (session.profile) setCustomerProfile((profile) => ({ ...profile, ...session.profile, id: session.customerId ?? profile.id }))
        if (!session.location) return
        setPickup({ lat: session.location.latitude, lng: session.location.longitude })
        setGeoState("telegram")
        setGeoMessage("Геолокацію отримано з Telegram.")
      })
      .catch(() => {
        setGeoMessage("Не вдалося синхронізувати геолокацію з Telegram.")
      })
  }, [telegramContext.chatId, telegramContext.initData])

  useEffect(() => {
    if (geoState === "telegram") return
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoState("unavailable")
      setGeoMessage("Не вдалося визначити геолокацію.")
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPickup({ lat: position.coords.latitude, lng: position.coords.longitude })
        setGeoState("success")
        setGeoMessage("Місцезнаходження визначено.")
      },
      () => {
        setGeoState("permission-denied")
        setGeoMessage("Не вдалося визначити геолокацію. Можна вибрати точку вручну.")
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [geoState])

  useEffect(() => {
    let cancelled = false
    const refreshProviders = () => {
      setProvidersLoading(true)
      getProviders()
        .then((items) => {
          if (!cancelled) setNearbyProviders(Array.isArray(items) ? items : [])
        })
        .catch(() => {
          if (!cancelled) setNearbyProviders([])
        })
        .finally(() => {
          if (!cancelled) setProvidersLoading(false)
        })
    }

    refreshProviders()
    const interval = window.setInterval(refreshProviders, 10000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!orderId) return
    let cancelled = false

    const applyPolledOrder = (order: OrderResponse) => {
      if (cancelled) return
      const resolvedOrderId = order.id ?? orderId
      const nextStatus = normalizeOrderStatus(order.status)
      if (userInitiatedCancelRef.current && nextStatus !== "cancelled") {
        return
      }
      if (nextStatus === "cancelled") {
        userInitiatedCancelRef.current = false
      }
      setCurrentOrder(order)
      setStatus(nextStatus)
      if (resolvedOrderId) setOrderId(resolvedOrderId)
      persistActiveOrder(resolvedOrderId, nextStatus)
      setScreen((currentScreen) => {
        const targetScreen = screenForOrderStatus(nextStatus)
        if (currentScreen === "tracking" && nextStatus !== "en_route" && nextStatus !== "arrived" && nextStatus !== "in_progress" && nextStatus !== "completed" && nextStatus !== "cancelled") {
          return currentScreen
        }
        if ((currentScreen === "searching" || currentScreen === "review") && nextStatus === "accepted") {
          return "accepted"
        }
        return targetScreen
      })
    }

    const refreshOrder = () => {
      getOrder(orderId)
        .then(applyPolledOrder)
        .catch(() => undefined)
    }

    refreshOrder()
    const interval = window.setInterval(refreshOrder, 2500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [orderId])

  useEffect(() => {
    if (screen !== "tracking") return
    const interval = window.setInterval(() => {
      setTrackingProgress((value) => Math.min(100, value + 7))
    }, 1200)
    return () => window.clearInterval(interval)
  }, [screen])

  const serviceLabel = useMemo(() => services.find((item) => item.key === selectedService)?.label ?? "Евакуатор", [selectedService])
  const distanceKm = useMemo(() => calculateDistanceKm(pickup, destinationPoint), [pickup, destinationPoint])

  const setDestinationFromMap = (point: Point) => {
    setDestinationPoint(point)
    setDestination(`Точка на карті ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`)
  }

  const submitOrder = async () => {
    setLoading(true)
    try {
      const fromTelegram = Boolean(telegramContext.initData)
      const customerSession = await ensureCustomerSession()
      const payload = {
        source: fromTelegram ? "telegram-mini-app" : "web",
        customerId: customerSession.customerId,
        service: selectedService,
        customerLocation: geoState === "success" || geoState === "telegram" ? "Поточна геолокація клієнта" : sanitizeLocation(orderInput.customerLocation),
        customerCoordinates: pickup,
        destination: sanitizeLocation(destination),
        destinationCoordinates: destinationPoint,
        vehicleState,
        distanceKm,
        notify: Boolean(telegramContext.chatId && telegramContext.initData),
        chatId: telegramContext.chatId,
        telegramInitData: telegramContext.initData,
        telegramUserId: telegramContext.user?.id,
        telegramUsername: telegramContext.user?.username,
        telegramFirstName: telegramContext.user?.first_name,
        status: "searching",
      }

      const errors = validateCustomerOrderInput({
        service: selectedService,
        customerLocation: payload.customerLocation,
        destination: payload.destination,
        distanceKm: payload.distanceKm,
      })

      if (errors.length > 0) {
        throw new Error("Validation failed")
      }

      const response = await createOrder(payload, customerSession.token)
      const nextStatus = normalizeOrderStatus(response.status ?? "searching")
      userInitiatedCancelRef.current = false
      setOrderId(response.id)
      setCurrentOrder(response)
      setStatus(nextStatus)
      if (response.id) persistActiveOrder(response.id, nextStatus)
      setScreen("searching")
    } catch {
      setScreen("error")
    } finally {
      setLoading(false)
    }
  }

  const cancelOrder = () => {
    userInitiatedCancelRef.current = true
    setStatus("cancelled")
    setScreen("cancelled")
    clearActiveOrder()
    if (orderId) cancelOrderRequest(orderId).catch(() => undefined)
  }

  const retryOrderDispatch = () => {
    if (!orderId) return
    retryDispatch(orderId)
      .then((order) => {
        setCurrentOrder(order)
        setStatus(normalizeOrderStatus(order.status))
      })
      .catch(() => undefined)
  }

  const verifyCustomerProfile = async () => {
    setCustomerVerificationSaving(true)
    setCustomerVerificationError(undefined)
    try {
      const customerSession = await ensureCustomerSession()
      const savedProfile = await updateCustomerProfile(customerSession.customerId, {
        name: customerProfile.name,
        phone: customerProfile.phone,
        telegram: customerProfile.telegram,
        city: customerProfile.city,
      }, customerSession.token)
      setCustomerProfile((profile) => ({ ...profile, ...savedProfile }))
    } catch {
      setCustomerVerificationError("Не вдалося зберегти профіль. Спробуйте ще раз.")
    } finally {
      setCustomerVerificationSaving(false)
    }
  }

  const contactAssignedProvider = () => {
    const phone = currentOrder?.assignedProvider?.phone ?? provider.phone
    if (phone) window.location.href = `tel:${phone}`
  }

  const confirmProposedPrice = async () => {
    if (!orderId) return
    setPriceConfirming(true)
    setPriceConfirmError(undefined)
    try {
      const order = await confirmOrderPrice(orderId, customerAuthToken)
      setCurrentOrder(order)
      const nextStatus = normalizeOrderStatus(order.status)
      setStatus(nextStatus)
      persistActiveOrder(orderId, nextStatus)
      setScreen(screenForOrderStatus(nextStatus))
    } catch {
      setPriceConfirmError("Не вдалося підтвердити ціну.")
    } finally {
      setPriceConfirming(false)
    }
  }

  const startTracking = () => {
    setTrackingProgress(12)
    setScreen("tracking")
  }

  const completeOrder = () => {
    setScreen("in_progress")
  }

  const restart = () => {
    userInitiatedCancelRef.current = false
    setScreen("home")
    setStatus("draft")
    setOrderId(undefined)
    setCurrentOrder(undefined)
    setTrackingProgress(12)
    clearActiveOrder()
  }

  switch (screen) {
    case "location":
      return (
        <LocationStep
          pickup={pickup}
          addressLabel={`${pickup.lat.toFixed(5)}, ${pickup.lng.toFixed(5)}`}
          geoMessage={geoMessage}
          geoLoading={geoState === "requesting"}
          onPick={(point) => {
            setPickup(point)
            setGeoState("success")
            setGeoMessage("Місце подачі оновлено вручну.")
          }}
          onRetryGeo={() => {
            setGeoState("requesting")
            setGeoMessage("Визначаємо ваше місцезнаходження…")
          }}
          onBack={() => setScreen("home")}
          onNext={() => setScreen("destination")}
        />
      )
    case "destination":
      return <DestinationStep pickup={pickup} destination={destinationPoint} value={destination} onPick={setDestinationFromMap} onChange={setDestination} onBack={() => setScreen("location")} onNext={() => setScreen("details")} />
    case "details":
      return <DetailsStep pickup={pickup} destination={destinationPoint} value={vehicleState} onChange={setVehicleState} onBack={() => setScreen("destination")} onNext={() => setScreen("review")} />
    case "review":
      return <ReviewStep serviceLabel={serviceLabel} pickup={pickup} destination={destinationPoint} vehicleState={vehicleState} loading={loading} onConfirm={submitOrder} onBack={() => setScreen("details")} />
    case "searching":
      return <SearchingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onCancel={cancelOrder} onRetryDispatch={retryOrderDispatch} />
    case "accepted":
      return <AcceptedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} confirming={priceConfirming} confirmError={priceConfirmError} onConfirmPrice={confirmProposedPrice} onContact={contactAssignedProvider} onCancel={cancelOrder} />
    case "assigned":
      return <AssignedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onTrack={startTracking} onCancel={cancelOrder} />
    case "tracking":
      return <TrackingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} progress={trackingProgress} onCancel={cancelOrder} />
    case "arrived":
      return <ArrivedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onComplete={completeOrder} onCancel={cancelOrder} />
    case "in_progress":
      return <InProgressStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onCancel={cancelOrder} />
    case "completed":
      return <OrderFinalStep orderId={orderId} status="completed" pickup={pickup} destination={destinationPoint} onRestart={restart} />
    case "cancelled":
      return <OrderFinalStep orderId={orderId} status="cancelled" pickup={pickup} destination={destinationPoint} onRestart={restart} />
    case "error":
      return <OrderErrorStep pickup={pickup} destination={destinationPoint} onRetry={() => setScreen("review")} />
    case "home":
    default:
      return <HomeStep pickup={pickup} locationLabel={geoMessage} providers={nearbyProviders} providersLoading={providersLoading} customerProfile={customerProfile} customerVerificationSaving={customerVerificationSaving} customerVerificationError={customerVerificationError} onVerifyCustomer={verifyCustomerProfile} onSelect={(service) => { setSelectedService(service); setScreen("location") }} />
  }
}

export default CustomerFlow
