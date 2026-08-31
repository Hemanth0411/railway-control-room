import { afterEach, describe, expect, it, vi } from 'vitest'

import { EXPIRY_SKEW_MS, isSignedIn, needsRefresh, oauthOptions, safeReturnTo, sessionOptions } from './session'
import type { Session } from './session'

const SECRET = 'a'.repeat(32)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cookie options', () => {
  it('marks cookies secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(sessionOptions(SECRET).cookieOptions?.secure).toBe(true)
    expect(oauthOptions(SECRET).cookieOptions?.secure).toBe(true)
  })

  it('leaves cookies insecure outside production so localhost http works', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(sessionOptions(SECRET).cookieOptions?.secure).toBe(false)
  })

  it('keeps both cookies httpOnly, so browser JavaScript can never read the tokens', () => {
    expect(sessionOptions(SECRET).cookieOptions?.httpOnly).toBe(true)
    expect(oauthOptions(SECRET).cookieOptions?.httpOnly).toBe(true)
  })

  it('uses sameSite lax, because the OAuth callback is a cross-site redirect', () => {
    // 'strict' would withhold the transaction cookie on the callback and break login.
    expect(oauthOptions(SECRET).cookieOptions?.sameSite).toBe('lax')
  })

  it('gives the two cookies different names', () => {
    expect(sessionOptions(SECRET).cookieName).not.toBe(oauthOptions(SECRET).cookieName)
  })

  it('expires the OAuth transaction far sooner than the session', () => {
    const oauthAge = oauthOptions(SECRET).cookieOptions?.maxAge ?? 0
    const sessionAge = sessionOptions(SECRET).cookieOptions?.maxAge ?? 0
    expect(oauthAge).toBeGreaterThan(0)
    expect(oauthAge).toBeLessThan(sessionAge)
  })
})

describe('isSignedIn', () => {
  it('needs an access token', () => {
    expect(isSignedIn({})).toBe(false)
    expect(isSignedIn({ accessToken: '' })).toBe(false)
    expect(isSignedIn({ accessToken: 'tok' })).toBe(true)
  })
})

describe('needsRefresh', () => {
  const now = 1_700_000_000_000
  const signedIn = (expiresAt?: number): Session => ({ accessToken: 'tok', accessTokenExpiresAt: expiresAt })

  it('is false for a token with plenty of life left', () => {
    expect(needsRefresh(signedIn(now + 10 * 60_000), now)).toBe(false)
  })

  it('is true once the token has expired', () => {
    expect(needsRefresh(signedIn(now - 1), now)).toBe(true)
  })

  it('refreshes early, before the token expires in flight', () => {
    // Just inside the skew window: still valid, but not for long enough to trust.
    expect(needsRefresh(signedIn(now + EXPIRY_SKEW_MS - 1), now)).toBe(true)
    expect(needsRefresh(signedIn(now + EXPIRY_SKEW_MS + 1), now)).toBe(false)
  })

  it('refreshes when we do not know the expiry', () => {
    expect(needsRefresh(signedIn(undefined), now)).toBe(true)
  })

  it('is false when nobody is signed in', () => {
    expect(needsRefresh({}, now)).toBe(false)
  })
})

describe('safeReturnTo', () => {
  it('keeps a relative path', () => {
    expect(safeReturnTo('/control-room')).toBe('/control-room')
  })

  it('falls back to / when absent', () => {
    expect(safeReturnTo(null)).toBe('/')
  })

  it('rejects anything that could redirect off-site', () => {
    // Otherwise /api/auth/login?returnTo=... becomes an open redirect.
    for (const hostile of [
      'https://evil.example.com',
      '//evil.example.com',
      'http://evil.example.com',
      'javascript:alert(1)',
    ]) {
      expect(safeReturnTo(hostile)).toBe('/')
    }
  })
})
