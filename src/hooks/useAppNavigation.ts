import { useEffect, useMemo, useReducer, useRef, type Dispatch, type SetStateAction } from 'react'
import type { Role } from '../lib/constants'
import type { PomichEntryScreen } from '../telegram'

export interface AppNavigationState {
  role: Role | null
  showOnboarding: boolean
  pendingRole: Role | null
  startAtRoleSelect: boolean
  loginMode: boolean
  showLanding: boolean
  showCabinet: boolean
  cabinetInitialEditing: boolean
  forceRolePicker: boolean
  rolePickerKey: number
  onboardingSessionKey: number
  entryScreen: PomichEntryScreen | null
  cabinetFocus: 'profile' | 'history'
  providerEntryScreen: 'duty' | 'offers' | 'verify' | undefined
}

type InitialState = { [K in keyof AppNavigationState]: AppNavigationState[K] | (() => AppNavigationState[K]) }
type Setters = { [K in keyof AppNavigationState as `set${Capitalize<K>}`]: Dispatch<SetStateAction<AppNavigationState[K]>> }
const HISTORY_KEY = 'pomichNavigationV1'

function screenKey(state: AppNavigationState): string {
  return JSON.stringify([state.role, state.showLanding, state.showOnboarding, state.showCabinet,
    state.cabinetFocus, state.providerEntryScreen, state.loginMode, state.forceRolePicker])
}

/** One navigation reducer; history stores screen state, never account credentials. */
export function useAppNavigation(initial: InitialState): AppNavigationState & Setters {
  const [state, dispatch] = useReducer((current: AppNavigationState, update: (state: AppNavigationState) => AppNavigationState) => update(current), initial,
    seed => Object.fromEntries(Object.entries(seed).map(([key, value]) => [key, typeof value === 'function' ? value() : value])) as unknown as AppNavigationState)
  const restoring = useRef(false)
  const lastScreen = useRef<string | undefined>(undefined)
  const setters = useMemo(() => Object.fromEntries(Object.keys(initial).map(key => [
    `set${key[0].toUpperCase()}${key.slice(1)}`,
    (value: unknown) => dispatch(current => ({ ...current, [key]: typeof value === 'function'
      ? value(current[key as keyof AppNavigationState]) : value })),
  ])) as Setters, [])

  useEffect(() => {
    const restore = (event: PopStateEvent) => {
      const snapshot = event.state?.[HISTORY_KEY] as AppNavigationState | undefined
      if (!snapshot || ![null, 'customer', 'provider', 'admin'].includes(snapshot.role)) return
      restoring.current = true
      dispatch(() => snapshot)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  useEffect(() => {
    const key = screenKey(state)
    const snapshot = { ...(window.history.state ?? {}), [HISTORY_KEY]: state }
    if (lastScreen.current === undefined || restoring.current || lastScreen.current === key) {
      window.history.replaceState(snapshot, '', window.location.href)
    } else {
      window.history.pushState(snapshot, '', window.location.href)
    }
    lastScreen.current = key
    restoring.current = false
  }, [state])
  return { ...state, ...setters }
}
