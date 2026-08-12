import { render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OrderFinalStep } from './OrderTerminalStep'

vi.mock('../layout/RideScreen', () => ({
  RideScreen: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../ui/PrimaryButton', () => ({
  PrimaryButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
}))

vi.mock('../ui/StatusPill', () => ({
  StatusPill: ({ status }: { status: string }) => <span>{status}</span>,
}))

describe('OrderFinalStep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-dismisses cancelled screen after 15 seconds', () => {
    const onRestart = vi.fn()

    render(
      <OrderFinalStep
        orderId="PM-123"
        status="cancelled"
        pickup={{ lat: 48.62, lng: 22.28 }}
        onRestart={onRestart}
      />,
    )

    expect(screen.getByText(/Нова заявка через 15 сек/i)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(15000)
    })

    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('does not reset countdown when onRestart identity changes', () => {
    const onRestart = vi.fn()
    const { rerender } = render(
      <OrderFinalStep
        orderId="PM-123"
        status="cancelled"
        pickup={{ lat: 48.62, lng: 22.28 }}
        onRestart={onRestart}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByText(/Нова заявка через 10 сек/i)).toBeInTheDocument()

    rerender(
      <OrderFinalStep
        orderId="PM-123"
        status="cancelled"
        pickup={{ lat: 48.62, lng: 22.28 }}
        onRestart={() => onRestart()}
      />,
    )

    expect(screen.getByText(/Нова заявка через 10 сек/i)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('shows manual new-order button on cancelled screen', () => {
    const onRestart = vi.fn()

    render(
      <OrderFinalStep
        orderId="PM-123"
        status="cancelled"
        pickup={{ lat: 48.62, lng: 22.28 }}
        onRestart={onRestart}
        showAction
      />,
    )

    screen.getByRole('button', { name: 'Нова заявка' }).click()
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('does not auto-dismiss completed screen', () => {
    const onRestart = vi.fn()

    render(
      <OrderFinalStep
        orderId="PM-123"
        status="completed"
        pickup={{ lat: 48.62, lng: 22.28 }}
        onRestart={onRestart}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(20000)
    })

    expect(onRestart).not.toHaveBeenCalled()
  })
})
