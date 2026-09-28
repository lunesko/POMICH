import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

async function expectNoSeriousAccessibilityViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")
  expect(blocking, blocking.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([])
}

test("public landing is visually stable and has no serious axe violations", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: /Допомога на дорозі — поруч/i })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  await expect(page).toHaveScreenshot("01-public-landing.png", { fullPage: true })
})

test("role selection is clear and accessible", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Зареєструватися" }).first().click()
  await expect(page.getByText(/Оберіть роль/i)).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  await expect(page).toHaveScreenshot("02-role-selection.png", { fullPage: true })
})

test("admin login is visually stable and accessible", async ({ page }) => {
  await page.goto("/?role=admin")
  await expect(page.getByRole("heading", { name: "Захищена адмін-панель" })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  await expect(page).toHaveScreenshot("03-admin-login.png", { fullPage: true })
})
