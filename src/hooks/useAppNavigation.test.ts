import { persistActiveAppRole, readActiveAppRole } from '../lib/appRole'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { useAppNavigation, type AppNavigationState } from './useAppNavigation'
import { sanitizePublicAppUrl } from '../telegram'

const initial: AppNavigationState = {
  role: 'customer', showOnboarding: false, pendingRole: null, startAtRoleSelect: false,
  loginMode: false, showLanding: false, showCabinet: false, cabinetInitialEditing: false,
  forceRolePicker: false, rolePickerKey: 0, onboardingSessionKey: 0, entryScreen: null,
  cabinetFocus: 'profile', providerEntryScreen: undefined,
}
beforeEach(() => {
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
  window.sessionStorage.clear()
})

it('back restores the complete screen instead of only the stored role', () => {
  const { result } = renderHook(() => useAppNavigation(initial))
  const flowSnapshot = window.history.state
  act(() => {
    result.current.setShowCabinet(true)
    result.current.setCabinetFocus('history')
  })
  expect(result.current.showCabinet).toBe(true)
  expect(result.current.cabinetFocus).toBe('history')
  const length = window.history.length
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: flowSnapshot })))
  expect(result.current.showCabinet).toBe(false)
  expect(result.current.cabinetFocus).toBe('profile')
  expect(window.history.length).toBe(length)
})

it('URL cleanup preserves navigation state and stable setter identities', () => {
  const { result, rerender } = renderHook(() => useAppNavigation(initial))
  const setter = result.current.setShowCabinet
  window.history.replaceState(window.history.state, '', '/?role=customer')
  sanitizePublicAppUrl()
  expect(window.history.state.pomichNavigationV1.role).toBe('customer')
  rerender()
  expect(result.current.setShowCabinet).toBe(setter)
})


it('Back synchronizes the role used after a refresh', () => {
  const { result, unmount } = renderHook(() => useAppNavigation(initial))
  const customerSnapshot = window.history.state
  act(() => {
    result.current.setRole('provider')
    persistActiveAppRole('provider')
  })
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: customerSnapshot })))
  expect(readActiveAppRole()).toBe('customer')
  unmount()
  const reopened = renderHook(() => useAppNavigation({ ...initial, role: readActiveAppRole() }))
  expect(reopened.result.current.role).toBe('customer')
})

it('Back to role selection clears the role from both storage locations', () => {
  const { result } = renderHook(() => useAppNavigation({ ...initial, role: null }))
  const landingSnapshot = window.history.state
  act(() => {
    result.current.setRole('provider')
    persistActiveAppRole('provider')
  })
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: landingSnapshot })))
  expect(result.current.role).toBeNull()
  expect(window.sessionStorage.getItem('pomichActiveAppRole')).toBeNull()
  expect(window.localStorage.getItem('pomichActiveAppRole')).toBeNull()
})
