import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

async function expectNoSeriousAccessibilityViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")
  expect(blocking, blocking.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.addInitScript(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.route("**/api/**", (route) => route.abort("connectionrefused"))
})

test("public landing is visually stable and has no serious axe violations", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Допомога на дорозі — поруч", { exact: true })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  await expect(page).toHaveScreenshot("01-public-landing.png", { fullPage: true })
})

test("role selection is clear and accessible", async ({ page }) => {
  await page.goto("/")
  const register = page.getByRole("button", { name: "Зареєструватися" })
  if (!(await register.first().isVisible())) {
    await page.getByRole("button", { name: "Меню" }).click()
  }
  await register.first().click()
  await expect(page.getByText("Оберіть вашу роль", { exact: true })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  await expect(page).toHaveScreenshot("02-role-selection.png", { fullPage: true })
})

test("admin login is visually stable and accessible", async ({ page }) => {
  await page.goto("/?role=admin")
  await expect(page.getByRole("heading", { name: "Захищена адмін-панель" })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  await expect(page).toHaveScreenshot("03-admin-login.png", { fullPage: true })
})
