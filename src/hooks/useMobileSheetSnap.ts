import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"

export type SheetSnap = "collapsed" | "half" | "expanded"

const SNAP_ORDER: SheetSnap[] = ["collapsed", "half", "expanded"]

/** Heights as % of the ride-screen (not raw vh — avoids browser-chrome clipping). */
export interface SheetHeights {
  peek: number
  half: number
  expanded: number
  min: number
  max: number
}

const DEFAULT_HEIGHTS: SheetHeights = {
  peek: 28,
  half: 54,
  expanded: 74,
  min: 22,
  max: 82,
}

function resolveDefaultSnap(mapFocus?: boolean, expandedSheet?: boolean, defaultSnap: SheetSnap = "half"): SheetSnap {
  if (expandedSheet) return "expanded"
  if (mapFocus) return "collapsed"
  return defaultSnap
}

function snapToHeightPct(snap: SheetSnap, heights: SheetHeights): number {
  if (snap === "collapsed") return heights.peek
  if (snap === "expanded") return heights.expanded
  return heights.half
}

function parseCssLengthToPct(value: string, viewportHeight: number): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const pctMatch = trimmed.match(/^([\d.]+)%$/i)
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1])
    return Number.isFinite(pct) ? pct : null
  }

  const minMatch = trimmed.match(/^min\(\s*([\d.]+)(?:vh|%)\s*,\s*([\d.]+)px\s*\)$/i)
  if (minMatch) {
    const unit = parseFloat(minMatch[1])
    const px = parseFloat(minMatch[2])
    if (!Number.isFinite(unit) || !Number.isFinite(px) || viewportHeight <= 0) return null
    return Math.min(unit, (px / viewportHeight) * 100)
  }

  const vhMatch = trimmed.match(/^([\d.]+)vh$/i)
  if (vhMatch) {
    const vh = parseFloat(vhMatch[1])
    return Number.isFinite(vh) ? vh : null
  }

  const pxMatch = trimmed.match(/^([\d.]+)px$/i)
  if (pxMatch) {
    const px = parseFloat(pxMatch[1])
    if (!Number.isFinite(px) || viewportHeight <= 0) return null
    return (px / viewportHeight) * 100
  }

  return null
}

export function readSheetHeights(): SheetHeights {
  if (typeof window === "undefined" || typeof document === "undefined") return DEFAULT_HEIGHTS

  const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 1
  const style = getComputedStyle(document.documentElement)

  const peek = parseCssLengthToPct(style.getPropertyValue("--pomich-sheet-peek"), viewportHeight) ?? DEFAULT_HEIGHTS.peek
  const half = parseCssLengthToPct(style.getPropertyValue("--pomich-sheet-half"), viewportHeight) ?? DEFAULT_HEIGHTS.half
  const expanded =
    parseCssLengthToPct(style.getPropertyValue("--pomich-sheet-expanded"), viewportHeight) ?? DEFAULT_HEIGHTS.expanded
  const min = parseCssLengthToPct(style.getPropertyValue("--pomich-sheet-min"), viewportHeight) ?? DEFAULT_HEIGHTS.min
  const max = parseCssLengthToPct(style.getPropertyValue("--pomich-sheet-max"), viewportHeight) ?? DEFAULT_HEIGHTS.max

  return { peek, half, expanded, min, max }
}

export function clampSheetHeight(heightPct: number, heights: SheetHeights = DEFAULT_HEIGHTS): number {
  return Math.min(heights.max, Math.max(heights.min, heightPct))
}

export function heightToSnap(heightPct: number, heights: SheetHeights = DEFAULT_HEIGHTS): SheetSnap {
  const distances: Array<{ snap: SheetSnap; distance: number }> = [
    { snap: "collapsed", distance: Math.abs(heightPct - heights.peek) },
    { snap: "half", distance: Math.abs(heightPct - heights.half) },
    { snap: "expanded", distance: Math.abs(heightPct - heights.expanded) },
  ]

  distances.sort((a, b) => a.distance - b.distance)
  return distances[0]?.snap ?? "half"
}

export function useMobileSheetSnap(options: {
  enabled: boolean
  mapFocus?: boolean
  expandedSheet?: boolean
  defaultSnap?: SheetSnap
}) {
  const { enabled, mapFocus = false, expandedSheet = false, defaultSnap = "half" } = options
  const [snap, setSnap] = useState<SheetSnap>(() => resolveDefaultSnap(mapFocus, expandedSheet, defaultSnap))
  const [heightVh, setHeightVh] = useState<number>(() => snapToHeightPct(resolveDefaultSnap(mapFocus, expandedSheet, defaultSnap), DEFAULT_HEIGHTS))
  const [isDragging, setIsDragging] = useState(false)

  const heightsRef = useRef<SheetHeights>(DEFAULT_HEIGHTS)
  const heightRef = useRef(heightVh)
  const dragRef = useRef<{ pointerId: number; startY: number; startHeightVh: number } | null>(null)
  const pendingHeightRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  const refreshHeights = useCallback(() => {
    heightsRef.current = readSheetHeights()
  }, [])

  const applyHeight = useCallback((nextHeightVh: number) => {
    const clamped = clampSheetHeight(nextHeightVh, heightsRef.current)
    heightRef.current = clamped
    setHeightVh(clamped)
    setSnap(heightToSnap(clamped, heightsRef.current))
  }, [])

  const scheduleHeightUpdate = useCallback(
    (nextHeightVh: number) => {
      pendingHeightRef.current = clampSheetHeight(nextHeightVh, heightsRef.current)
      if (rafRef.current !== null) return

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (pendingHeightRef.current === null) return
        const clamped = pendingHeightRef.current
        pendingHeightRef.current = null
        heightRef.current = clamped
        setHeightVh(clamped)
        setSnap(heightToSnap(clamped, heightsRef.current))
      })
    },
    [],
  )

  useEffect(() => {
    if (!enabled) return
    refreshHeights()
    const initialSnap = resolveDefaultSnap(mapFocus, expandedSheet, defaultSnap)
    setSnap(initialSnap)
    const nextHeight = snapToHeightPct(initialSnap, heightsRef.current)
    heightRef.current = nextHeight
    setHeightVh(nextHeight)
  }, [enabled, mapFocus, expandedSheet, defaultSnap, refreshHeights])

  useEffect(() => {
    if (!enabled) return

    refreshHeights()
    const onResize = () => {
      refreshHeights()
      /* Don't collapse sheet if user is currently typing in an input field */
      const active = document.activeElement
      const isTyping =
        Boolean(active) &&
        (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || (active as HTMLElement)?.isContentEditable)
      if (isTyping) return
      applyHeight(heightRef.current)
    }
    window.addEventListener("resize", onResize)
    window.visualViewport?.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      window.visualViewport?.removeEventListener("resize", onResize)
    }
  }, [enabled, refreshHeights, applyHeight])

  useEffect(() => {
    if (!enabled) return

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        refreshHeights()
        const expandedHeight = heightsRef.current.expanded
        heightRef.current = expandedHeight
        setHeightVh(expandedHeight)
        setSnap("expanded")
      }
    }

    window.addEventListener("focusin", handleFocusIn)
    return () => window.removeEventListener("focusin", handleFocusIn)
  }, [enabled, refreshHeights])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  useEffect(() => {
    heightRef.current = heightVh
  }, [heightVh])

  const cycleSnap = useCallback(() => {
    refreshHeights()
    setSnap((prev) => {
      const index = SNAP_ORDER.indexOf(prev)
      const nextSnap = SNAP_ORDER[(index + 1) % SNAP_ORDER.length]
      const nextHeight = snapToHeightPct(nextSnap, heightsRef.current)
      heightRef.current = nextHeight
      setHeightVh(nextHeight)
      return nextSnap
    })
  }, [refreshHeights])

  const goToSnap = useCallback(
    (nextSnap: SheetSnap) => {
      refreshHeights()
      const nextHeight = snapToHeightPct(nextSnap, heightsRef.current)
      heightRef.current = nextHeight
      setHeightVh(nextHeight)
      setSnap(nextSnap)
    },
    [refreshHeights],
  )

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return
      refreshHeights()
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeightVh: heightRef.current,
      }
      setIsDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [enabled, refreshHeights],
  )

  const onHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!enabled || !drag || drag.pointerId !== event.pointerId) return

      const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 1
      const deltaVh = ((drag.startY - event.clientY) / viewportHeight) * 100
      scheduleHeightUpdate(drag.startHeightVh + deltaVh)
      event.preventDefault()
    },
    [enabled, scheduleHeightUpdate],
  )

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!enabled || !drag || drag.pointerId !== event.pointerId) return

      event.currentTarget.releasePointerCapture(event.pointerId)
      dragRef.current = null
      setIsDragging(false)

      refreshHeights()
      const releaseHeight = pendingHeightRef.current ?? heightRef.current
      pendingHeightRef.current = null
      const snappedHeight = snapToHeightPct(heightToSnap(releaseHeight, heightsRef.current), heightsRef.current)
      applyHeight(snappedHeight)
    },
    [enabled, refreshHeights, applyHeight],
  )

  const onHandlePointerUp = finishDrag
  const onHandlePointerCancel = finishDrag

  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!enabled) return
      refreshHeights()

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        cycleSnap()
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSnap((prev) => {
          const index = SNAP_ORDER.indexOf(prev)
          const nextSnap = SNAP_ORDER[Math.min(index + 1, SNAP_ORDER.length - 1)]
          const nextHeight = snapToHeightPct(nextSnap, heightsRef.current)
          heightRef.current = nextHeight
          setHeightVh(nextHeight)
          return nextSnap
        })
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSnap((prev) => {
          const index = SNAP_ORDER.indexOf(prev)
          const nextSnap = SNAP_ORDER[Math.max(index - 1, 0)]
          const nextHeight = snapToHeightPct(nextSnap, heightsRef.current)
          heightRef.current = nextHeight
          setHeightVh(nextHeight)
          return nextSnap
        })
      }
    },
    [enabled, cycleSnap, refreshHeights],
  )

  return {
    snap,
    heightVh,
    isDragging,
    setSnap: goToSnap,
    cycleSnap,
    handleProps: {
      role: "button" as const,
      tabIndex: 0,
      "aria-label": "Перетягніть, щоб змінити розмір панелі",
      "aria-expanded": snap !== "collapsed",
      onPointerDown: onHandlePointerDown,
      onPointerMove: onHandlePointerMove,
      onPointerUp: onHandlePointerUp,
      onPointerCancel: onHandlePointerCancel,
      onKeyDown: onHandleKeyDown,
    },
    sheetStyle: enabled
      ? ({
          "--pomich-sheet-height": `${heightVh}%`,
        } as CSSProperties)
      : undefined,
  }
}
