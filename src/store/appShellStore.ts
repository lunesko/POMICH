import { create } from "zustand"

import type { Role } from "../lib/constants"
import type { UserAccountStatus } from "../api/client"
import type { PomichEntryScreen } from "../telegram"

/** Declarative shell paths (MemoryRouter / Routes location). Clean browser URL stays pomich.help. */
export type AppShellPath =
  | "/landing"
  | "/onboarding"
  | "/customer"
  | "/customer/cabinet"
  | "/provider"
  | "/provider/cabinet"
  | "/admin"

export type CabinetFocus = "profile" | "history"
export type ProviderEntryScreen = "duty" | "offers" | "verify"

type AppShellState = {
  role: Role | null
  account: UserAccountStatus | null
  showOnboarding: boolean
  showLanding: boolean
  showCabinet: boolean
  pendingRole: Role | null
  startAtRoleSelect: boolean
  loginMode: boolean
  customerToken: string | undefined
  forceRolePicker: boolean
  rolePickerKey: number
  onboardingSessionKey: number
  entryScreen: PomichEntryScreen | null
  cabinetFocus: CabinetFocus
  cabinetInitialEditing: boolean
  providerEntryScreen: ProviderEntryScreen | undefined

  setRole: (role: Role | null) => void
  setAccount: (account: UserAccountStatus | null | ((prev: UserAccountStatus | null) => UserAccountStatus | null)) => void
  setShowOnboarding: (value: boolean) => void
  setShowLanding: (value: boolean) => void
  setShowCabinet: (value: boolean) => void
  setPendingRole: (role: Role | null) => void
  setStartAtRoleSelect: (value: boolean) => void
  setLoginMode: (value: boolean) => void
  setCustomerToken: (token: string | undefined) => void
  setForceRolePicker: (value: boolean) => void
  bumpRolePickerKey: () => void
  bumpOnboardingSessionKey: () => void
  setEntryScreen: (screen: PomichEntryScreen | null) => void
  setCabinetFocus: (focus: CabinetFocus) => void
  setCabinetInitialEditing: (value: boolean) => void
  setProviderEntryScreen: (screen: ProviderEntryScreen | undefined) => void

  /** Reset transient UI when leaving a role / going to landing. */
  resetTransientNav: () => void
}

export function selectShellPath(state: Pick<
  AppShellState,
  "role" | "showLanding" | "showOnboarding" | "showCabinet" | "forceRolePicker"
>): AppShellPath {
  if (state.forceRolePicker || state.showOnboarding) return "/onboarding"
  if (state.showCabinet && state.role === "customer") return "/customer/cabinet"
  if (state.showCabinet && state.role === "provider") return "/provider/cabinet"
  if (state.role === "admin") return "/admin"
  if (state.role === null || state.showLanding) return "/landing"
  if (state.role === "provider") return "/provider"
  return "/customer"
}

export const useAppShellStore = create<AppShellState>((set) => ({
  role: null,
  account: null,
  showOnboarding: false,
  showLanding: false,
  showCabinet: false,
  pendingRole: null,
  startAtRoleSelect: false,
  loginMode: false,
  customerToken: undefined,
  forceRolePicker: false,
  rolePickerKey: 0,
  onboardingSessionKey: 0,
  entryScreen: null,
  cabinetFocus: "profile",
  cabinetInitialEditing: false,
  providerEntryScreen: undefined,

  setRole: (role) => set({ role }),
  setAccount: (account) =>
    set((state) => ({
      account: typeof account === "function" ? account(state.account) : account,
    })),
  setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
  setShowLanding: (showLanding) => set({ showLanding }),
  setShowCabinet: (showCabinet) => set({ showCabinet }),
  setPendingRole: (pendingRole) => set({ pendingRole }),
  setStartAtRoleSelect: (startAtRoleSelect) => set({ startAtRoleSelect }),
  setLoginMode: (loginMode) => set({ loginMode }),
  setCustomerToken: (customerToken) => set({ customerToken }),
  setForceRolePicker: (forceRolePicker) => set({ forceRolePicker }),
  bumpRolePickerKey: () => set((state) => ({ rolePickerKey: state.rolePickerKey + 1 })),
  bumpOnboardingSessionKey: () => set((state) => ({ onboardingSessionKey: state.onboardingSessionKey + 1 })),
  setEntryScreen: (entryScreen) => set({ entryScreen }),
  setCabinetFocus: (cabinetFocus) => set({ cabinetFocus }),
  setCabinetInitialEditing: (cabinetInitialEditing) => set({ cabinetInitialEditing }),
  setProviderEntryScreen: (providerEntryScreen) => set({ providerEntryScreen }),

  resetTransientNav: () =>
    set({
      showCabinet: false,
      cabinetInitialEditing: false,
      forceRolePicker: false,
      pendingRole: null,
      startAtRoleSelect: false,
      loginMode: false,
    }),
}))
