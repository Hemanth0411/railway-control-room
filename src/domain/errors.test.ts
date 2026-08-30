import { describe, expect, it } from 'vitest'

import {
  ControlRoomError,
  ERROR_CATEGORIES,
  errors,
  isControlRoomError,
  toControlRoomError,
} from './errors'

describe('ControlRoomError', () => {
  it('maps each category to an HTTP status', () => {
    for (const category of ERROR_CATEGORIES) {
      const error = new ControlRoomError({ category, message: 'x' })
      expect(error.httpStatus).toBeGreaterThan(0)
    }
  })

  it('marks transport-level Railway failures as retryable by default', () => {
    expect(errors.rateLimited().retryable).toBe(true)
    expect(errors.railwayUnavailable().retryable).toBe(true)
  })

  it('does not mark user-caused failures as retryable', () => {
    expect(errors.validation('bad input').retryable).toBe(false)
    expect(errors.conflict('already deploying').retryable).toBe(false)
    expect(errors.unauthenticated().retryable).toBe(false)
  })
})

describe('response serialisation', () => {
  it('never includes the diagnostic payload', () => {
    const secret = { accessToken: 'rw_live_do_not_leak', query: 'mutation { ... }' }
    const error = errors.railwayGraphQL('Railway rejected the request.', secret)

    const body = JSON.stringify(error.toResponseBody())

    expect(body).not.toContain('rw_live_do_not_leak')
    expect(body).not.toContain('accessToken')
    expect(error.diagnostic).toBe(secret) // still available server-side
  })

  it('includes only the fields the browser needs', () => {
    const body = errors.conflict('A deployment is already in progress.').toResponseBody()
    expect(Object.keys(body.error).sort()).toEqual([
      'category',
      'certainty',
      'message',
      'retryable',
    ])
  })

  it('includes retryAfterMs when the upstream supplied it', () => {
    const body = errors.rateLimited(30_000).toResponseBody()
    expect(body.error.retryAfterMs).toBe(30_000)
  })
})

describe('state certainty', () => {
  it('admits the state is unknown when Railway could not be reached mid-command', () => {
    const error = errors.railwayUnavailable(new Error('ECONNRESET'))
    expect(error.certainty).toBe('unknown')
    // Spec 05: never claim the deployment failed when we only failed to reach Railway.
    expect(error.message).not.toMatch(/deployment failed/i)
    expect(error.message).toMatch(/do not know whether/i)
  })

  it('says the command was not sent when we know it was not', () => {
    const error = errors.railwayUnavailable(undefined, 'known')
    expect(error.certainty).toBe('known')
    expect(error.message).toMatch(/was not sent/i)
  })

  it('treats a rate limit as a known state — the command never reached Railway', () => {
    expect(errors.rateLimited().certainty).toBe('known')
  })
})

describe('toControlRoomError', () => {
  it('passes through an existing ControlRoomError unchanged', () => {
    const original = errors.conflict('nope')
    expect(toControlRoomError(original)).toBe(original)
  })

  it('wraps an unexpected throwable without leaking its message', () => {
    const thrown = new Error('connect ECONNREFUSED 10.0.0.1:5432 with token rw_secret')
    const wrapped = toControlRoomError(thrown)

    expect(wrapped.category).toBe('INTERNAL_ERROR')
    expect(wrapped.certainty).toBe('unknown')
    expect(JSON.stringify(wrapped.toResponseBody())).not.toContain('rw_secret')
    expect(wrapped.diagnostic).toBe(thrown)
    expect(wrapped.cause).toBe(thrown)
  })

  it('wraps non-Error throwables', () => {
    const wrapped = toControlRoomError('just a string')
    expect(wrapped.category).toBe('INTERNAL_ERROR')
    expect(wrapped.diagnostic).toBe('just a string')
  })
})

describe('isControlRoomError', () => {
  it('distinguishes our errors from ordinary ones', () => {
    expect(isControlRoomError(errors.internal())).toBe(true)
    expect(isControlRoomError(new Error('plain'))).toBe(false)
    expect(isControlRoomError(null)).toBe(false)
  })
})
