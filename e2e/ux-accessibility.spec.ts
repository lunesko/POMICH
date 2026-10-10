import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

async function dismissCookieNotice(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Зрозуміло", exact: true }).click()
  await expect(page.getByRole("complementary", { name: "Cookies та локальне сховище" })).toHaveCount(0)
}

async function expectNoSeriousAccessibilityViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")
  expect(blocking, blocking.map((item) => `${item.id}: ${item.help}\n${item.nodes.map((node) => `${node.target.join(", ")}: ${node.failureSummary ?? ""}`).join("\n")}`).join("\n")).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.addInitScript(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.origin === "http://127.0.0.1:4173" && url.pathname.startsWith("/api/")) {
      return route.abort("connectionrefused")
    }
    return route.continue()
  })
})

test("loads application styles and renders the landing layout", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("body")).toHaveCSS("margin", "0px")
  await expect.poll(() => page.evaluate(() => Array.from(document.styleSheets).some((sheet) => {
    try { return sheet.cssRules.length > 100 } catch { return false }
  }))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
})

test("public landing fits the viewport and has no serious axe violations", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Допомога на дорозі за хвилини", { exact: true })).toBeVisible()
  await expect(page.locator('img[src="/pomich-logo.png"]')).toHaveJSProperty("naturalWidth", 2149)
  await expectNoSeriousAccessibilityViolations(page)
  await expect(page.locator("body")).toBeInViewport({ ratio: 0.1 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  await dismissCookieNotice(page)
  await expect(page).toHaveScreenshot("01-public-landing.png", { fullPage: true })
})

test("role selection is clear and accessible", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Допомога на дорозі за хвилини", { exact: true })).toBeVisible()
  const register = page.getByRole("button", { name: "Зареєструватися" })
  if (!(await register.first().isVisible())) {
    await page.getByRole("button", { name: "Меню" }).click()
  }
  await register.first().click()
  await expect(page.getByText("Оберіть вашу роль", { exact: true })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  await dismissCookieNotice(page)
  await expect(page).toHaveScreenshot("02-role-selection.png", { fullPage: true })
})

test("admin login fits the viewport and is accessible", async ({ page }) => {
  await page.goto("/?role=admin")
  await expect(page.getByRole("heading", { name: "Захищена адмін-панель" })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  await dismissCookieNotice(page)
  await expect(page).toHaveScreenshot("03-admin-login.png", { fullPage: true })
})
