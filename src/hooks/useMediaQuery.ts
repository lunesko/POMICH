import { useEffect, useState } from "react"

function readMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  try {
    return window.matchMedia(query).matches
  } catch {
    return false
  }
}

export function useMediaQuery(query: string) {
  // Sync first paint on phones — otherwise compact chrome flashes as desktop.
  const [matches, setMatches] = useState(() => readMatches(query))

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mediaQuery = window.matchMedia(query)
    setMatches(mediaQuery.matches)
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches)
    mediaQuery.addEventListener("change", listener)
    return () => mediaQuery.removeEventListener("change", listener)
  }, [query])

  return matches
}
