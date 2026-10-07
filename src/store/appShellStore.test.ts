import { beforeEach, describe, expect, it } from "vitest"

import { selectShellPath, useAppShellStore } from "./appShellStore"

describe("selectShellPath", () => {
  beforeEach(() => {
    useAppShellStore.setState({
      role: null,
      showOnboarding: false,
      showLanding: false,
      showCabinet: false,
      forceRolePicker: false,
    })
  })

  it("maps landing when role is null", () => {
    expect(selectShellPath(useAppShellStore.getState())).toBe("/landing")
  })

  it("prefers onboarding over role flows", () => {
    useAppShellStore.setState({ role: "customer", showOnboarding: true })
    expect(selectShellPath(useAppShellStore.getState())).toBe("/onboarding")
  })

  it("maps customer and provider cabinets", () => {
    useAppShellStore.setState({ role: "customer", showCabinet: true })
    expect(selectShellPath(useAppShellStore.getState())).toBe("/customer/cabinet")
    useAppShellStore.setState({ role: "provider", showCabinet: true })
    expect(selectShellPath(useAppShellStore.getState())).toBe("/provider/cabinet")
  })

  it("maps admin and role home paths", () => {
    useAppShellStore.setState({ role: "admin" })
    expect(selectShellPath(useAppShellStore.getState())).toBe("/admin")
    useAppShellStore.setState({ role: "provider", showLanding: false })
    expect(selectShellPath(useAppShellStore.getState())).toBe("/provider")
    useAppShellStore.setState({ role: "customer", showLanding: false })
    expect(selectShellPath(useAppShellStore.getState())).toBe("/customer")
  })
})
