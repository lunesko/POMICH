import { afterEach, expect, it, vi } from 'vitest'

import { reportCrash } from './crashReporting'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('sends only an anonymous category and ignores reporting failures', async () => {
  vi.stubEnv('PROD', true)
  const fetch = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetch)
  reportCrash('render_error')
  await Promise.resolve()
  expect(fetch).toHaveBeenCalledWith('/api/telemetry/crashes', expect.objectContaining({
    credentials: 'omit', body: '{"category":"render_error"}',
  }))
})
