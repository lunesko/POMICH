import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react"
import "./ConfirmDialog.css"

type ConfirmDialogOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type PendingConfirmation = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void
}

const ConfirmDialogContext = createContext<((options: ConfirmDialogOptions) => Promise<boolean>) | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const confirm = useCallback((options: ConfirmDialogOptions) => new Promise<boolean>((resolve) => {
    setPending((current) => {
      current?.resolve(false)
      return { ...options, resolve }
    })
  }), [])

  const close = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed)
      return null
    })
  }, [])

  useEffect(() => {
    if (!pending) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    requestAnimationFrame(() => confirmButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false)
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [close, pending])

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {pending ? (
        <div className="pomich-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(false) }}>
          <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="pomich-confirm-dialog">
            <h2 id={titleId}>{pending.title}</h2>
            <p id={descriptionId}>{pending.description}</p>
            <div className="pomich-confirm-actions">
              <button type="button" className="pomich-confirm-cancel" onClick={() => close(false)}>
                {pending.cancelLabel ?? "Назад"}
              </button>
              <button ref={confirmButtonRef} type="button" className={`pomich-confirm-submit${pending.danger ? " is-danger" : ""}`} onClick={() => close(true)}>
                {pending.confirmLabel ?? "Підтвердити"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmDialogContext.Provider>
  )
}

export function useConfirmDialog() {
  const confirm = useContext(ConfirmDialogContext)
  return confirm ?? (async () => false)
}
