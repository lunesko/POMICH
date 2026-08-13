"""
Mechanical split of src/CustomerApp.tsx into maintainable modules.
Source of truth = current inline implementations (not stale stubs).
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
# Prefer backup if present (idempotent re-runs after a bad extract)
BAK = SRC / "CustomerApp.tsx.bak-p2"
CUSTOMER_APP = BAK if BAK.exists() else SRC / "CustomerApp.tsx"


def slice_lines(lines: list[str], start: int, end: int) -> str:
    return "".join(lines[start - 1 : end])


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({len(content.splitlines())} lines)")


LOCAL_TOKENS = '''
const BRAND = "var(--pomich-brand)"
const DARK = "var(--pomich-text)"
const BG = "var(--pomich-bg)"
const BORDER = "var(--pomich-border)"
const MUTED = "var(--pomich-muted)"
const SUBTLE = "var(--pomich-subtle)"
const CARD = "var(--pomich-card-bg)"
const SURFACE_TONE = "var(--pomich-service-tone-default)"
const SELECTED = "var(--pomich-selected-bg)"
const GHOST = "var(--pomich-ghost-bg)"
'''


def main() -> None:
    lines = CUSTOMER_APP.read_text(encoding="utf-8").splitlines(True)
    n = len(lines)
    print(f"source: {CUSTOMER_APP.name} ({n} lines)")

    # Ensure Screen includes profile
    constants_path = SRC / "lib" / "constants.ts"
    constants = constants_path.read_text(encoding="utf-8")
    if '| "profile"' not in constants:
        constants = constants.replace(
            'export type Screen =\n  | "home"',
            'export type Screen =\n  | "profile"\n  | "home"',
            1,
        )
        constants_path.write_text(constants, encoding="utf-8")
        print("updated Screen union in constants.ts")

    write(
        SRC / "lib" / "orderStatus.ts",
        '''import type { OrderStatus, Screen } from "./constants"

export function normalizeOrderStatus(status?: string): OrderStatus {
  if (status === "searching" || status === "accepted" || status === "price_confirmed" || status === "assigned" || status === "en_route" || status === "arrived" || status === "in_progress" || status === "completed" || status === "cancelled" || status === "draft") {
    return status
  }
  if (status === "created" || status === "matching") return "searching"
  if (status === "tracking") return "en_route"
  return "draft"
}

export function screenForOrderStatus(status: OrderStatus): Screen {
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
''',
    )

    # AppShell
    app_shell_body = slice_lines(lines, 475, 533).replace(
        "function AppShell(", "export function AppShell(", 1
    )
    write(
        SRC / "components" / "layout" / "AppShell.tsx",
        '''import type { ReactNode } from "react"

import type { Role } from "../../lib/constants"
import { ThemeToggle } from "../ui/ThemeToggle"

interface AppShellProps {
  children: ReactNode
  compact: boolean
  role: Role | null
  loggedInName?: string
  onRoleChange: (role: Role | null) => void
  onOpenCabinet?: () => void
  onSwitchRole?: () => void
  onLogout?: () => void
}

'''
        + app_shell_body
        + "\n\nexport default AppShell\n",
    )

    # Fallback (uses CSS classes only)
    fallback_body = slice_lines(lines, 535, 555).replace(
        "function CustomerAppFallback(",
        "export default function CustomerAppFallback(",
        1,
    )
    write(SRC / "components" / "CustomerAppFallback.tsx", fallback_body)

    # Landing
    landing_body = slice_lines(lines, 1454, 1981).replace(
        "function LandingPage(", "export default function LandingPage(", 1
    )
    write(
        SRC / "components" / "landing" / "LandingPage.tsx",
        '''import { useEffect, useState, type ReactNode } from "react"

import { getMapProviders, type ProviderAvailability } from "../../api/client"
import RouteMap from "../map/RouteMap"
import { PomichMapBackground, useSuppressMapAtmosphere } from "../layout/PomichMapShell"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { mediaQueries } from "../../lib/breakpoints"
import { ADMIN_LOGO_HOLD_MS } from "../../lib/adminAccess"
import { PICKUP, type Point, type Role } from "../../lib/constants"
import { usePomichTheme } from "../../context/PomichThemeProvider"
import { type PomichThemeColors, type PomichThemeMode } from "../../lib/theme"
'''
        + LOCAL_TOKENS
        + "\n"
        + landing_body,
    )

    # CustomerFlow: helpers + steps + flow
    # Include distanceToProvider local? Prefer import from constants.
    # VerificationPill through ProviderCard (324-473), layout+steps (557-1452), flow (1983-2747)
    customer_locals = slice_lines(lines, 324, 473)
    customer_steps = slice_lines(lines, 557, 1452)
    customer_flow = slice_lines(lines, 1983, 2747).replace(
        "function CustomerFlow(", "export default function CustomerFlow(", 1
    )
    write(
        SRC / "components" / "customer" / "CustomerFlow.tsx",
        '''import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  cancelOrder as cancelOrderRequest,
  confirmOrderPrice,
  createGuestCustomerSession,
  createOrder,
  getCustomerOrders,
  getOrder,
  getProviders,
  retryDispatch,
  submitOrderReview,
  updateCustomerProfile,
  type AuthSession,
  type CustomerProfile,
  type OrderResponse,
  type ProviderAvailability,
  type VerificationStatus,
} from "../../api/client"
import { RideScreen } from "../layout/RideScreen"
import {
  calculateDistanceKm,
  calculatePrice,
  ON_SITE_DESTINATION_LABEL,
  sanitizeLocation,
  serviceRequiresDestination,
  validateCustomerOrderInput,
  type CustomerOrderInput,
  type ServiceKey,
} from "../../lib/pomichDomain"
import { getTelegramContext } from "../../telegram"
import {
  getProfileChecklist,
  isCustomerProfileComplete,
  isCustomerReadyForOrder,
  mergeCustomerProfiles,
  profileChecklistItemStatus,
  profileChecklistSummary,
} from "../../lib/customerProfile"
import {
  PICKUP,
  DEFAULT_DESTINATION,
  services,
  provider,
  vehicleOptions,
  orderStatusLabels,
  getServiceLabel,
  getProviderCapabilityLabel,
  toServiceKeys,
  getServiceEmoji,
  providerStatusLabel,
  isVerified,
  nearbyProvidersFor,
  distanceToProvider,
  type Point,
  type OrderStatus,
  type Screen,
  type GeoState,
} from "../../lib/constants"
import {
  authSessionStorageKey,
  guestSessionCustomerIdForRestore,
  isExplicitLogout,
  purgeStaleCustomerSessions,
  readPersistedCustomerId,
  readStoredAuthSession,
  storeAuthSession,
} from "../../lib/auth"
import {
  clearActiveOrder,
  enrichProfileWithTelegram,
  persistActiveOrder,
  pickLatestActiveOrder,
  readActiveOrder,
  readBootstrapProfileForCustomer,
  resolveCustomerAuthSession,
} from "../../lib/customerSession"
import { reverseGeocodeAddress } from "../../lib/reverseGeocode"
import { MAP_GEO_DEBOUNCE_MS, MAP_RECENTER_THRESHOLD_M, requestCurrentPosition, shouldRecenterMap } from "../../lib/mapGeo"
import { OrderErrorStep, OrderFinalStep } from "./OrderTerminalStep"
import { useTelegramMainButton, useTelegramBackButton, useTelegramUx } from "../../hooks/useTelegramUx"
import { normalizeOrderStatus, screenForOrderStatus } from "../../lib/orderStatus"
import FormContainer, { FormFooterBar, FormHeader } from "../layout/FormContainer"
import { PhoneInput } from "../ui/PhoneInput"
import { FieldError } from "../ui/FieldError"
import { phoneInputValueFromStored, validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { validatePersonName } from "../../lib/personName"
import { ThemeToggle } from "../ui/ThemeToggle"
import { subscribeOrderEvents } from "../../lib/realtime"
'''
        + LOCAL_TOKENS
        + "\n"
        + customer_locals
        + "\n"
        + customer_steps
        + "\n"
        + customer_flow,
    )

    # ProviderFlow: resolveSessionProviderId + UI locals + flow
    resolve_session = slice_lines(lines, 227, 229)
    provider_ui = slice_lines(lines, 356, 473)  # PrimaryButton .. ProviderCard
    provider_layout = slice_lines(lines, 557, 585)  # ScreenLayout + Header
    # Ends immediately before normalizeOrderStatus
    provider_end = next(
        i
        for i, line in enumerate(lines, 1)
        if line.startswith("function normalizeOrderStatus")
    ) - 1
    while provider_end > 1 and not lines[provider_end - 1].strip():
        provider_end -= 1
    provider_flow = slice_lines(lines, 2749, provider_end).replace(
        "function ProviderFlow(", "export default function ProviderFlow(", 1
    )
    print(f"ProviderFlow slice: 2749-{provider_end}")
    write(
        SRC / "components" / "provider" / "ProviderFlow.tsx",
        '''import { useEffect, useMemo, useRef, useState } from "react"

import {
  acceptProviderOffer,
  createProviderAccountSession,
  createProviderSession,
  createSelfProviderSession,
  declineProviderOffer,
  getOrder,
  getProviderOffers,
  getProviders,
  messageFromFetchError,
  submitOrderReview,
  updateProviderOrderStatus,
  updateProviderPresence,
  updateProviderProfile,
  ApiRequestError,
  type AuthSession,
  type CustomerProfile,
  type DispatchOffer,
  type MapRequestPin,
  type OrderResponse,
  type ProviderAvailability,
} from "../../api/client"
import { RideScreen } from "../layout/RideScreen"
import {
  DEFAULT_SERVICE_RADIUS_KM,
  PICKUP,
  DEFAULT_DESTINATION,
  PROVIDER_START,
  services,
  provider,
  partnerRegistrationServices,
  getActiveProviderId,
  getServiceEmoji,
  getProviderCapabilityLabel,
  toServiceKeys,
  composePartnerVehicle,
  emptyPartnerRegistrationForm,
  hydratePartnerVehicleFromProfile,
  isProviderPhoneVerified,
  partnerVehicleSelectionIsComplete,
  providerPoint,
  resolvePartnerVehicleMake,
  orderStatusLabels,
  type PartnerRegistrationForm,
  type Point,
  type OrderStatus,
} from "../../lib/constants"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { isValidUkrainePlate, validateUkrainePlate } from "../../lib/ukrainePlate"
import { validatePersonName } from "../../lib/personName"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../lib/ukraineCities"
import { PhoneInput } from "../ui/PhoneInput"
import { UkrainePlateInput } from "../ui/UkrainePlateInput"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import { CitySelect } from "../ui/CitySelect"
import { FieldError } from "../ui/FieldError"
import { storeLinkedProviderId } from "../../lib/userAccount"
import {
  authSessionStorageKey,
  isAuthSessionToken,
  readAuthSessionSubject,
  readPersistedCustomerId,
  readStoredAuthSession,
  storeAuthSession,
} from "../../lib/auth"
import { clearActiveOrder, persistActiveOrder, readActiveOrder } from "../../lib/customerSession"
import { OrderFinalStep } from "../customer/OrderTerminalStep"
import { DutyStatusToggle, PresenceToast, presenceErrorMessage } from "../ui/DutyStatusToggle"
import { OrderRequestSheet } from "./OrderRequestSheet"
import { IncomingOfferStep } from "./IncomingOfferStep"
import { filterActiveOffers, filterVisibleOffers, isOfferActive, offerActionErrorMessage, offerSecondsLeft, parseOfferPrice, pinFromOffer, pinsFromActiveOffers } from "../../lib/dispatchOffer"
import { subscribeOrderEvents, subscribeProviderEvents } from "../../lib/realtime"
import { getTelegramContext } from "../../telegram"
import FormContainer, { FormFooterBar, FormHeader } from "../layout/FormContainer"
import { AccountLoginStep } from "../views/AccountLoginStep"
import { ProviderRegistrationStep } from "../views/ProviderRegistrationStep"
import { ServiceRadiusField } from "../ui/ServiceRadiusField"
import { PartnerVehicleFields } from "./PartnerVehicleFields"
import { normalizeOrderStatus } from "../../lib/orderStatus"
import type { ServiceKey } from "../../lib/pomichDomain"
import { ThemeToggle } from "../ui/ThemeToggle"
'''
        + LOCAL_TOKENS
        + "\n"
        + resolve_session
        + "\n"
        + provider_ui
        + "\n"
        + provider_layout
        + "\n"
        + provider_flow,
    )

    # Thin orchestrator — starts at export default function CustomerApp
    orch_start = next(
        i
        for i, line in enumerate(lines, 1)
        if line.startswith("export default function CustomerApp")
    )
    orchestrator = slice_lines(lines, orch_start, n)
    print(f"CustomerApp orchestrator slice: {orch_start}-{n}")
    write(
        SRC / "CustomerApp.tsx",
        '''import { useCallback, useEffect, useMemo, useState } from "react"

import { getUserAccount, type UserAccountStatus } from "./api/client"
import AppShell from "./components/layout/AppShell"
import LandingPage from "./components/landing/LandingPage"
import CustomerFlow from "./components/customer/CustomerFlow"
import ProviderFlow from "./components/provider/ProviderFlow"
import CustomerAppFallback from "./components/CustomerAppFallback"
import OnboardingGate from "./components/onboarding/OnboardingGate"
import ClientCabinet from "./components/cabinet/ClientCabinet"
import ProviderCabinet from "./components/cabinet/ProviderCabinet"
import AdminFlow from "./components/admin/AdminFlow"
import { getTelegramContext, resolveEntryRole } from "./telegram"
import { DEFAULT_CUSTOMER_NAME, isCustomerProfileComplete, isCustomerVerified } from "./lib/customerProfile"
import { getActiveProviderId, type Role } from "./lib/constants"
import { mediaQueries } from "./lib/breakpoints"
import { useMediaQuery } from "./hooks/useMediaQuery"
import { isReturningClient, mergeAccountProfile, storeLinkedProviderId } from "./lib/userAccount"
import {
  applyHiddenAdminEntry,
  isAdminEntryLocation,
  isHiddenAdminHash,
} from "./lib/adminAccess"
import {
  authSessionStorageKey,
  clearAllAuthStorage,
  clearProviderAuthStorage,
  clearExplicitLogout,
  dismissSessionMismatchNotice,
  getStoredQueryToken,
  isExplicitLogout,
  markExplicitLogout,
  purgeStaleCustomerSessions,
  readPersistedCustomerId,
  readStoredAuthSession,
  resolveSessionMismatchWarning,
} from "./lib/auth"
import {
  clearActiveOrder,
  enrichProfileWithTelegram,
  resolveCustomerAuthSession,
} from "./lib/customerSession"
import { syncProfileCityFromGeo } from "./lib/syncProfileCityFromGeo"

'''
        + orchestrator,
    )

    print("extraction complete")


if __name__ == "__main__":
    main()
