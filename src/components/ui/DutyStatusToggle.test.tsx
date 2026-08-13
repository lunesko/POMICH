import { describe, expect, it } from 'vitest'

import { presenceErrorMessage } from './DutyStatusToggle'

describe('presenceErrorMessage', () => {
  it('maps auth and verification failures to honest Ukrainian copy', () => {
    expect(presenceErrorMessage('provider_identity_mismatch')).toContain('не збігається')
    expect(presenceErrorMessage('provider_session_required')).toContain('Сесію')
    expect(presenceErrorMessage('bearer_token_invalid')).toContain('Сесію')
    expect(presenceErrorMessage('provider verification must be approved before going online')).toContain('телефон')
    expect(presenceErrorMessage('provider profile must be registered before going online')).toContain('профіль')
  })

  it('keeps already localized API messages', () => {
    expect(presenceErrorMessage('Акаунт партнера не збігається. Оновіть сторінку та спробуйте ще раз.')).toContain('не збігається')
  })

  it('falls back to connection copy only for unknown errors', () => {
    expect(presenceErrorMessage(undefined)).toContain("з'єднання")
    expect(presenceErrorMessage('Provider presence request failed with 500')).toContain("з'єднання")
  })
})
