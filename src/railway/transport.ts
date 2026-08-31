/**
 * The only place this app speaks HTTP to Railway.
 *
 * Everything above this file works with typed results and ControlRoomErrors, and never
 * sees a GraphQL string, a status code, or a token.
 */

import { ControlRoomError, errors } from '@/domain/errors'
import type { RateLimitSnapshot } from '@/domain/polling'

const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2'
const REQUEST_TIMEOUT_MS = 15_000

export interface RailwayResponse<T> {
  data: T
  rateLimit: RateLimitSnapshot
}

interface GraphQLError {
  message?: string
}

interface GraphQLBody<T> {
  data?: T | null
  errors?: GraphQLError[]
}

/**
 * Whether the operation changes anything on Railway.
 *
 * This decides what we say when the request fails without an answer: a failed query
 * leaves the world untouched, but a failed mutation might have been applied anyway.
 */
type OperationKind = 'query' | 'mutation'

/**
 * A missing header must stay undefined, not become 0. Number(null) is 0, and a
 * "0 remaining" reading would tell the polling policy the request budget is gone and
 * stop it dead.
 */
function headerNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export function readRateLimit(headers: Headers): RateLimitSnapshot {
  const snapshot: RateLimitSnapshot = {}

  const remaining = headerNumber(headers, 'x-ratelimit-remaining')
  if (remaining !== undefined) snapshot.remaining = remaining

  // Retry-After is in seconds and is only sent once the limit has been passed.
  const retryAfter = headerNumber(headers, 'retry-after')
  if (retryAfter !== undefined && retryAfter > 0) snapshot.retryAfterMs = retryAfter * 1000

  return snapshot
}

export async function railwayRequest<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  kind: OperationKind,
): Promise<RailwayResponse<T>> {
  let response: Response
  try {
    response = await fetch(RAILWAY_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (cause) {
    // Never reached Railway, or gave up waiting. For a mutation we genuinely cannot
    // tell whether it was applied, so errors.railwayUnavailable defaults to 'unknown'.
    throw errors.railwayUnavailable(cause, kind === 'query' ? 'known' : 'unknown')
  }

  const rateLimit = readRateLimit(response.headers)

  if (!response.ok) {
    throw httpError(response.status, rateLimit, await safeBodyText(response))
  }

  let body: GraphQLBody<T>
  try {
    body = (await response.json()) as GraphQLBody<T>
  } catch (cause) {
    throw errors.railwayGraphQL('Railway sent a response this app could not read.', cause)
  }

  if (body.errors !== undefined && body.errors.length > 0) {
    throw graphQLError(body.errors)
  }

  if (body.data === undefined || body.data === null) {
    throw errors.railwayGraphQL('Railway returned no data for that request.', body)
  }

  return { data: body.data, rateLimit }
}

function httpError(status: number, rateLimit: RateLimitSnapshot, body: string): ControlRoomError {
  if (status === 401) {
    return errors.unauthenticated('Railway rejected the access token. Sign in again.')
  }
  if (status === 403) {
    return errors.forbidden(
      'Railway refused this action for the projects you authorized. Check the permissions you granted.',
      { status, body },
    )
  }
  if (status === 429) {
    return errors.rateLimited(rateLimit.retryAfterMs)
  }
  if (status >= 500) {
    // Railway answered, so the request definitely arrived - but a 500 on a mutation
    // still leaves us unsure whether it took effect.
    return errors.railwayUnavailable({ status, body }, 'unknown')
  }
  return errors.railwayGraphQL(`Railway rejected the request (HTTP ${status}).`, { status, body })
}

/**
 * Railway's GraphQL error messages are short and useful ("Not Authorized"), so we show
 * them rather than replacing them with something generic. The full payload stays in the
 * diagnostic for the server log.
 */
function graphQLError(graphQLErrors: GraphQLError[]): ControlRoomError {
  const first = graphQLErrors[0]?.message
  const message =
    typeof first === 'string' && first.length > 0
      ? `Railway rejected the request: ${first}`
      : 'Railway rejected the request but gave no reason.'
  return errors.railwayGraphQL(message, graphQLErrors)
}

async function safeBodyText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}
