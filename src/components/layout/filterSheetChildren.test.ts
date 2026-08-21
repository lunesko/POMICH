import { createElement, isValidElement } from "react"
import { describe, expect, it } from "vitest"

import { filterSheetChildren } from "./RideScreen"

function labels(nodes: ReturnType<typeof filterSheetChildren>): string[] {
  return (Array.isArray(nodes) ? nodes : [nodes])
    .filter(isValidElement)
    .map((node) => String((node.props as { children?: unknown }).children ?? ""))
}

describe("filterSheetChildren", () => {
  const peek = createElement("div", { "data-sheet-peek": true }, "peek")
  const full = createElement("div", { "data-sheet-full": true }, "full")
  const other = createElement("div", null, "other")

  it("keeps peek content when the mobile sheet is collapsed", () => {
    expect(labels(filterSheetChildren([peek, full, other], true, "collapsed"))).toEqual(["peek", "other"])
  })

  it("keeps full content when the mobile sheet is half/expanded", () => {
    expect(labels(filterSheetChildren([peek, full, other], true, "half"))).toEqual(["full", "other"])
    expect(labels(filterSheetChildren([peek, full, other], true, "expanded"))).toEqual(["full", "other"])
  })

  it("hides peek on non-mobile sheet (desktop uses full content)", () => {
    expect(labels(filterSheetChildren([peek, full, other], false, "collapsed"))).toEqual(["full", "other"])
  })
})
