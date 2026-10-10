import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('built application loads under production CSP and blocks injected scripts', async ({ page }) => {
  const config = readFileSync('deploy/nginx/pomich.help.conf', 'utf8')
  const policy = config.match(/add_header Content-Security-Policy "([^"]+)"/)![1]
  const violations: string[] = []
  page.on('console', message => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(message.text())
  })
  await page.route('**/api/**', route => route.fulfill({ status: 503, body: '{}' }))
  await page.route('http://127.0.0.1:4175/', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
  await page.goto('/')
  await expect(page.locator('#pomich-boot')).toHaveCount(0)
  await expect(page.locator('body')).toHaveCSS('margin', '0px')
  expect(violations).toEqual([])
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__injectedAuditScript = true'
    document.body.appendChild(script)
  })
  expect(await page.evaluate(() => '__injectedAuditScript' in window)).toBe(false)
})
