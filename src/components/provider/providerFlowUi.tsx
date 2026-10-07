import type { ReactNode } from "react"

import {
  type OrderResponse,
  type ProviderAvailability,
  type VerificationStatus,
} from "../../api/client"
import {
  orderStatusLabels,
  verificationLabel,
  verificationTone,
  type OrderStatus,
} from "../../lib/constants"
import { FormFooterBar, FormHeader } from "../layout/FormContainer"
import {
  BRAND,
  DARK,
  BORDER,
  MUTED,
  SUBTLE,
  CARD,
  SELECTED,
  GHOST,
} from "./providerFlowTokens"

export function VerificationPill({ status }: { status?: VerificationStatus }) {
  const tone = verificationTone(status)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "5px 9px", background: tone.background, color: tone.color, border: `1px solid ${tone.border}`, fontSize: 11, fontWeight: 900 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }} />
      {verificationLabel(status)}
    </span>
  )
}

export function SheetHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 950, color: DARK, letterSpacing: "-0.03em" }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 6, color: MUTED, fontWeight: 700, fontSize: 13, lineHeight: 1.35 }}>{subtitle}</div> : null}
    </div>
  )
}

export function resolveSessionProviderId(session: { providerId?: string; subjectId?: string }, fallback: string) {
  return String(session.providerId || session.subjectId || fallback).trim() || fallback
}

export function PrimaryButton({
  label,
  onClick,
  loading = false,
  disabled = false,
  loadingLabel = "Зачекайте…",
}: {
  label: string
  onClick?: () => void
  loading?: boolean
  disabled?: boolean
  loadingLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`pomich-primary-btn${disabled || loading ? " is-disabled" : ""}`}
    >
      {loading ? loadingLabel : label}
    </button>
  )
}

export function SecondaryButton({ label, onClick, danger = false, disabled = false }: { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`pomich-flow-secondary-btn${danger ? " is-danger" : ""}`}
    >
      {label}
    </button>
  )
}

export function StatusPill({ status }: { status: OrderStatus }) {
  const cancelled = status === "cancelled"
  return (
    <div className={`pomich-status-pill ${cancelled ? "pomich-status-pill--cancelled" : "pomich-status-pill--active"}`}>
      <span className="pomich-status-pill__dot" />
      {orderStatusLabels[status]}
    </div>
  )
}

export function Timeline({ status }: { status: OrderStatus }) {
  const steps: Array<{ status: OrderStatus; label: string }> = [
    { status: "searching", label: "Пошук" },
    { status: "accepted", label: "Ціна" },
    { status: "price_confirmed", label: "Підтверджено" },
    { status: "en_route", label: "У дорозі" },
    { status: "arrived", label: "На місці" },
    { status: "in_progress", label: "Робота" },
    { status: "completed", label: "Готово" },
  ]
  const currentIndex = status === "cancelled" ? -1 : Math.max(0, steps.findIndex((step) => step.status === status))

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 6 }}>
      {steps.map((step, index) => {
        const active = index <= currentIndex
        return (
          <div key={step.status} style={{ minWidth: 0 }}>
            <div style={{ height: 5, borderRadius: 999, background: active ? BRAND : BORDER }} />
            <div style={{ marginTop: 5, fontSize: 10, color: active ? DARK : SUBTLE, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{step.label}</div>
          </div>
        )
      })}
    </div>
  )
}

export function ProviderCard({
  orderId,
  eta,
  assignedProvider,
  fallbackName,
}: {
  orderId?: string
  eta?: number
  assignedProvider?: OrderResponse["assignedProvider"] | ProviderAvailability
  fallbackName?: string
}) {
  const cardProvider = assignedProvider
  if (!cardProvider) {
    return (
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
        <div style={{ fontWeight: 900, color: DARK }}>{fallbackName ?? "Партнер прийняв заявку"}</div>
        <div style={{ color: MUTED, fontWeight: 700, marginTop: 6, fontSize: 13 }}>Завантажуємо дані виконавця…</div>
      </div>
    )
  }
  const phone = cardProvider.phone
  const telegram = cardProvider.telegram
  const rating = cardProvider.rating
  const distanceKm = "distanceKm" in cardProvider && typeof cardProvider.distanceKm === "number" ? cardProvider.distanceKm : undefined
  const verificationStatus = "verificationStatus" in cardProvider ? cardProvider.verificationStatus : "verified"
  const distanceLabel =
    typeof distanceKm === "number"
      ? distanceKm < 0.15
        ? "Поруч із вами"
        : `${distanceKm.toFixed(1)} км від вас`
      : null
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, boxShadow: "0 8px 22px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: SELECTED, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🚛</div>
          <div>
            <div style={{ fontWeight: 900, color: DARK }}>{cardProvider.name ?? fallbackName ?? "Партнер"}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{[cardProvider.vehicle, cardProvider.plate].filter(Boolean).join(" · ") || "Дані авто уточнюються"}</div>
            <div style={{ marginTop: 6 }}><VerificationPill status={verificationStatus} /></div>
          </div>
        </div>
        {typeof rating === "number" ? <div style={{ textAlign: "right", fontWeight: 900, color: BRAND }}>★ {rating}</div> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: phone && telegram ? "1fr 1fr" : "1fr", gap: 10, marginTop: 12 }}>
        {phone ? (
          <SecondaryButton label="📞 Подзвонити" onClick={() => { window.location.href = `tel:${phone}` }} />
        ) : null}
        {telegram ? (
          <SecondaryButton
            label="💬 Чат"
            onClick={() => {
              window.open(`https://t.me/${telegram}${orderId ? `?start=order_${orderId}` : ""}`, "_blank", "noopener,noreferrer")
            }}
          />
        ) : null}
      </div>
      {eta ? <div style={{ marginTop: 10, color: MUTED, fontSize: 13, fontWeight: 700 }}>Прибуття приблизно за {eta} хв</div> : null}
      {distanceLabel ? <div style={{ marginTop: 6, color: MUTED, fontSize: 13, fontWeight: 700 }}>{distanceLabel}</div> : null}
    </div>
  )
}

export function ScreenLayout({ children, footer, className = "" }: { children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={`pomich-themed-shell pomich-screen-layout ${className}`.trim()} style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: "100%", minHeight: "100%", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <div className="pomich-screen-layout__content" style={{ flex: 1, minWidth: 0, overflow: "auto", overflowX: "hidden" }}>{children}</div>
      {footer ? <FormFooterBar>{footer}</FormFooterBar> : null}
    </div>
  )
}

export function Header({
  title,
  subtitle,
  onBack,
  status,
  showThemeToggle: _showThemeToggle,
  compactToggle: _compactToggle,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  status?: OrderStatus
  showThemeToggle?: boolean
  compactToggle?: boolean
}) {
  return (
    <FormHeader>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {onBack ? <button type="button" aria-label="Назад" onClick={onBack} className="pomich-back-btn">←</button> : null}
          <div style={{ minWidth: 0 }}>
            <div className="pomich-header-title">{title}</div>
            {subtitle ? <div className="pomich-header-subtitle">{subtitle}</div> : null}
          </div>
        </div>
        {status ? <StatusPill status={status} /> : null}
      </div>
    </FormHeader>
  )
}

