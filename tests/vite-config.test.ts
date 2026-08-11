import { describe, expect, it } from 'vitest'

import configModule from '../vite.config'

describe('Vite dev proxy', () => {
  it('forwards same-origin /api requests to FastAPI without exposing localhost to browsers', async () => {
    const viteConfig = await configModule({ command: 'serve', mode: 'development' } as never)
    const apiProxy = viteConfig.server?.proxy?.['/api'] as { target?: string; changeOrigin?: boolean; rewrite?: (path: string) => string } | undefined

    expect(apiProxy).toBeDefined()
    expect(viteConfig.server?.allowedHosts).toContain('.trycloudflare.com')
    expect(apiProxy?.target).toBe('http://127.0.0.1:8000')
    expect(apiProxy?.changeOrigin).toBe(true)
    expect(apiProxy?.rewrite).toBeUndefined()
  })
})
