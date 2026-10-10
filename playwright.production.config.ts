import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'production-security.spec.ts',
  use: { baseURL: 'http://127.0.0.1:4175', serviceWorkers: 'block' },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
})
