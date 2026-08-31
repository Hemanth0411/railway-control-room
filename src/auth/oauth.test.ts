import { describe, expect, it } from 'vitest'

import { readCallbackError, tokensToSession, userFromClaims } from './oauth'
import { isControlRoomError } from '@/domain/errors'

type TokenResponse = Parameters<typeof tokensToSession>[0]

function tokenResponse(fields: {
  access_token: string
  refresh_token?: string
  expiresIn?: number
}): TokenResponse {
  return {
    access_token: fields.access_token,
    refresh_token: fields.refresh_token,
    token_type: 'bearer',
    expiresIn: () => fields.expiresIn,
    claims: () => undefined,
  } as unknown as TokenResponse
}

describe('readCallbackError', () => {
  it('returns null for a normal callback', () => {
    expect(readCallbackError(new URLSearchParams('code=abc&state=xyz'))).toBeNull()
  })

  it('handles the user refusing consent', () => {
    const error = readCallbackError(new URLSearchParams('error=access_denied'))
    expect(isControlRoomError(error)).toBe(true)
    expect(error?.message).toMatch(/cancelled/i)
  })

  it('reports other authorization-server errors', () => {
    const error = readCallbackError(
      new URLSearchParams('error=invalid_scope&error_description=Bad+scope'),
    )
    expect(error?.message).toBe('Bad scope')
  })

  it('still reports an error with no description', () => {
    const error = readCallbackError(new URLSearchParams('error=server_error'))
    expect(error?.message).toMatch(/server_error/)
  })
})

describe('tokensToSession', () => {
  const now = 1_700_000_000_000

  it('converts expires_in into an absolute expiry', () => {
    const result = tokensToSession(tokenResponse({ access_token: 'a', expiresIn: 3600 }), undefined, now)
    expect(result.accessToken).toBe('a')
    expect(result.accessTokenExpiresAt).toBe(now + 3_600_000)
  })

  it('leaves the expiry undefined when Railway does not send one', () => {
    const result = tokensToSession(tokenResponse({ access_token: 'a' }), undefined, now)
    expect(result.accessTokenExpiresAt).toBeUndefined()
  })

  it('stores a rotated refresh token', () => {
    const result = tokensToSession(
      tokenResponse({ access_token: 'a', refresh_token: 'new' }),
      'old',
      now,
    )
    expect(result.refreshToken).toBe('new')
  })

  it('keeps the existing refresh token when the response does not rotate it', () => {
    // Dropping it here would leave the session unable to refresh again.
    const result = tokensToSession(tokenResponse({ access_token: 'a' }), 'old', now)
    expect(result.refreshToken).toBe('old')
  })

  it('has no refresh token when there was none to begin with', () => {
    const result = tokensToSession(tokenResponse({ access_token: 'a' }), undefined, now)
    expect(result.refreshToken).toBeUndefined()
  })
})

describe('userFromClaims', () => {
  it('reads sub, email and name', () => {
    const user = userFromClaims({ sub: 'user_1', email: 'a@b.com', name: 'A B' } as never)
    expect(user).toEqual({ sub: 'user_1', email: 'a@b.com', name: 'A B' })
  })

  it('tolerates a missing email and name', () => {
    const user = userFromClaims({ sub: 'user_1' } as never)
    expect(user).toEqual({ sub: 'user_1', email: undefined, name: undefined })
  })

  it('rejects claims with no subject', () => {
    expect(() => userFromClaims(undefined)).toThrow(/identity/i)
    expect(() => userFromClaims({} as never)).toThrow(/identity/i)
  })

  it('ignores non-string email and name rather than storing junk', () => {
    const user = userFromClaims({ sub: 'user_1', email: 42, name: {} } as never)
    expect(user.email).toBeUndefined()
    expect(user.name).toBeUndefined()
  })
})
