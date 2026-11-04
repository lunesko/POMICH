import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear() })
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).pathname.startsWith("/api/")) return route.fulfill({ status: 503, body: "{}" })
    return route.continue()
  })
})

test("shared SVG assets render and FAQ shows exactly one expand or collapse icon", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Зрозуміло", exact: true }).click()

  // A nonzero glyph box verifies that the external symbol was actually loaded,
  // rather than just checking that an empty SVG element exists in the DOM.
  const battery = page.locator('svg.pomich-service-icon-svg use[href$="#battery"]').first()
  await expect.poll(() => battery.evaluate((node) => (node as SVGGraphicsElement).getBBox().width)).toBeGreaterThan(0)
  const paths = await page.locator("svg.pomich-service-icon-svg use").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""))
  expect(paths.length).toBeGreaterThanOrEqual(6)
  expect(paths.every((href) => !href.startsWith("data:"))).toBe(true)

  const question = page.locator(".landing-faq__item").first()
  const summary = question.locator("summary")
  await summary.scrollIntoViewIfNeeded()
  await expect(question.locator(".landing-faq__expand")).toBeVisible()
  await expect(question.locator(".landing-faq__collapse")).toBeHidden()
  await summary.click()
  await expect(question.locator(".landing-faq__expand")).toBeHidden()
  await expect(question.locator(".landing-faq__collapse")).toBeVisible()
  await summary.click()
  await expect(question.locator(".landing-faq__expand")).toBeVisible()
  await expect(question.locator(".landing-faq__collapse")).toBeHidden()
})

test("cookie notice has a bounded height and leaves the bottom action area clear", async ({ page }) => {
  await page.goto("/")
  const notice = page.getByRole("complementary", { name: "Cookies та локальне сховище" })
  await expect(notice).toBeVisible()
  const box = await notice.boundingBox()
  const viewport = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.height).toBeLessThan(viewport.height / 2)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThan(viewport.height - 72)
  await page.getByRole("button", { name: "Зрозуміло", exact: true }).click()
  await expect(notice).toHaveCount(0)
})
