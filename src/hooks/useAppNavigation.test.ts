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
beforeEach(() => window.history.replaceState({}, '', '/'))

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
