import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: 'backend-lifecycle.spec.ts', workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:18001', ...devices['Desktop Chrome'],
    serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    geolocation: { latitude: 48.6208, longitude: 22.2879 }, permissions: ['geolocation'] },
  webServer: {
    command: `"${process.env.POMICH_TEST_PYTHON || 'python'}" scripts/run_e2e_backend.py`,
    url: 'http://127.0.0.1:18001/internal/ready', timeout: 60_000,
    reuseExistingServer: false,
  },
})
