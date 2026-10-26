import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { services } from "./constants"
import { iconNames, iconHref, iconMarkup, resolveServiceIcon, serviceIconHref, serviceMarkerMarkup } from "./icons"

const uiSprite = readFileSync("src/assets/icons/ui.svg", "utf8")
const serviceSprite = readFileSync("src/assets/icons/services.svg", "utf8")

describe("shared icon assets", () => {
  it("has a real SVG symbol for every utility and service reference", () => {
    const parser = new DOMParser()
    for (const [source, names] of [[uiSprite, iconNames], [serviceSprite, services.map((service) => service.key)]] as const) {
      const doc = parser.parseFromString(source, "image/svg+xml")
      expect(doc.querySelector("parsererror")).toBeNull()
      for (const name of names) expect(doc.querySelector(`symbol[id="${name}"]`)).not.toBeNull()
      expect(doc.querySelector("script, foreignObject, image")).toBeNull()
    }
    for (const name of iconNames) expect(iconHref(name)).toContain(`#${name}`)
    for (const service of services) expect(serviceIconHref(service.key)).toContain(`#${service.key}`)
  })

  it("never interpolates untrusted service values into Leaflet HTML", () => {
    const unsafe = '\"><img src=x onerror=alert(1)>'
    const markup = serviceMarkerMarkup(unsafe)
    expect(resolveServiceIcon(unsafe)).toBe("mechanic")
    expect(markup).toContain("#mechanic")
    expect(markup).not.toContain(unsafe)
    expect(markup).not.toContain("onerror")
    expect(serviceMarkerMarkup("tow", Infinity)).toContain('width="20"')
    expect(iconMarkup("close", -10)).toContain('width="12"')
  })
})
