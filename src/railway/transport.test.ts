import { afterEach, describe, expect, it, vi } from 'vitest'

import { railwayRequest, readRateLimit } from './transport'
import { isControlRoomError } from '@/domain/errors'

const TOKEN = 'rw_secret_token_value'

function respondWith(body: unknown, init: ResponseInit = {}) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
    typeof body === 'string'
      ? new Response(body, { status: 200, ...init })
      : new Response(JSON.stringify(body), { status: 200, ...init }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readRateLimit', () => {
  it('reads the remaining count and Retry-After', () => {
    const snapshot = readRateLimit(
      new Headers({ 'x-ratelimit-remaining': '37', 'retry-after': '12' }),
    )
    expect(snapshot).toEqual({ remaining: 37, retryAfterMs: 12_000 })
  })

  it('leaves remaining undefined when the header is absent', () => {
    // Reporting 0 here would tell the polling policy the budget is exhausted.
    expect(readRateLimit(new Headers())).toEqual({})
  })

  it('ignores unparseable headers', () => {
    expect(readRateLimit(new Headers({ 'x-ratelimit-remaining': 'lots' }))).toEqual({})
  })

  it('keeps a genuine zero', () => {
    expect(readRateLimit(new Headers({ 'x-ratelimit-remaining': '0' })).remaining).toBe(0)
  })
})

describe('railwayRequest', () => {
  it('posts the query and variables with a bearer token', async () => {
    const fetchMock = respondWith({ data: { ok: true } })
    await railwayRequest(TOKEN, 'query Q { ok }', { a: 1 }, 'query')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://backboard.railway.com/graphql/v2')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(init.body as string)).toEqual({ query: 'query Q { ok }', variables: { a: 1 } })
  })

  it('returns parsed data alongside the rate limit', async () => {
    respondWith({ data: { value: 42 } }, { headers: { 'x-ratelimit-remaining': '90' } })
    const result = await railwayRequest<{ value: number }>(TOKEN, 'q', {}, 'query')
    expect(result.data.value).toBe(42)
    expect(result.rateLimit.remaining).toBe(90)
  })
})

describe('railwayRequest — HTTP failures', () => {
  it('maps 401 to UNAUTHENTICATED', async () => {
    respondWith({}, { status: 401 })
    await expect(railwayRequest(TOKEN, 'q', {}, 'query')).rejects.toMatchObject({
      category: 'UNAUTHENTICATED',
    })
  })

  it('maps 403 to FORBIDDEN', async () => {
    respondWith({}, { status: 403 })
    await expect(railwayRequest(TOKEN, 'q', {}, 'query')).rejects.toMatchObject({
      category: 'FORBIDDEN',
    })
  })

  it('maps 429 to a rate limit, carrying Retry-After', async () => {
    respondWith({}, { status: 429, headers: { 'retry-after': '30' } })
    await expect(railwayRequest(TOKEN, 'q', {}, 'mutation')).rejects.toMatchObject({
      category: 'RAILWAY_RATE_LIMITED',
      retryable: true,
      retryAfterMs: 30_000,
    })
  })

  it('maps 5xx to RAILWAY_UNAVAILABLE', async () => {
    respondWith({}, { status: 503 })
    await expect(railwayRequest(TOKEN, 'q', {}, 'mutation')).rejects.toMatchObject({
      category: 'RAILWAY_UNAVAILABLE',
    })
  })
})

describe('railwayRequest — network failures and certainty', () => {
  it('says the state is still known when a query fails to reach Railway', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    await expect(railwayRequest(TOKEN, 'q', {}, 'query')).rejects.toMatchObject({
      category: 'RAILWAY_UNAVAILABLE',
      certainty: 'known',
    })
  })

  it('admits the state is unknown when a mutation fails to reach Railway', async () => {
    // The command may or may not have been applied. Claiming otherwise would be a lie.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    await expect(railwayRequest(TOKEN, 'q', {}, 'mutation')).rejects.toMatchObject({
      category: 'RAILWAY_UNAVAILABLE',
      certainty: 'unknown',
    })
  })
})

describe('railwayRequest — GraphQL failures', () => {
  it('surfaces the GraphQL error message', async () => {
    respondWith({ errors: [{ message: 'Not Authorized' }] })
    await expect(railwayRequest(TOKEN, 'q', {}, 'query')).rejects.toMatchObject({
      category: 'RAILWAY_GRAPHQL_ERROR',
      message: 'Railway rejected the request: Not Authorized',
    })
  })

  it('handles a GraphQL error with no message', async () => {
    respondWith({ errors: [{}] })
    await expect(railwayRequest(TOKEN, 'q', {}, 'query')).rejects.toMatchObject({
      category: 'RAILWAY_GRAPHQL_ERROR',
    })
  })

  it('rejects a body that is not JSON', async () => {
    respondWith('<html>gateway error</html>')
    await expect(railwayRequest(TOKEN, 'q', {}, 'query')).rejects.toMatchObject({
      category: 'RAILWAY_GRAPHQL_ERROR',
    })
  })

  it('rejects a 200 with null data', async () => {
    respondWith({ data: null })
    await expect(railwayRequest(TOKEN, 'q', {}, 'query')).rejects.toMatchObject({
      category: 'RAILWAY_GRAPHQL_ERROR',
    })
  })
})

describe('railwayRequest — the token never leaks', () => {
  it('keeps the access token out of anything sent to the browser', async () => {
    respondWith({ errors: [{ message: 'Not Authorized' }] })

    try {
      await railwayRequest(TOKEN, 'query Q { ok }', {}, 'query')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isControlRoomError(error)).toBe(true)
      if (!isControlRoomError(error)) return
      const body = JSON.stringify(error.toResponseBody())
      expect(body).not.toContain(TOKEN)
      expect(body).not.toContain('Bearer')
    }
  })

  it('keeps the token out of an upstream body echoed into a diagnostic', async () => {
    respondWith(`unauthorized: Bearer ${TOKEN}`, { status: 403 })

    try {
      await railwayRequest(TOKEN, 'q', {}, 'query')
      expect.unreachable('should have thrown')
    } catch (error) {
      if (!isControlRoomError(error)) throw error
      expect(JSON.stringify(error.toResponseBody())).not.toContain(TOKEN)
    }
  })
})
