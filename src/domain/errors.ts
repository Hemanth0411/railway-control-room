/**
 * Application error model.
 *
 * Two hard rules, both from spec 02:
 *
 *  1. Errors are never swallowed. Every failure becomes a categorised error
 *     with a message that answers the four questions in spec 05: what happened,
 *     is the state known, can the user retry, what should they do.
 *  2. Nothing sensitive crosses the boundary. Access tokens, refresh tokens,
 *     the client secret and raw upstream payloads stay server-side. The
 *     `diagnostic` field is for server logs only and is never serialised into
 *     an HTTP response — `toResponseBody()` is the only thing the browser sees.
 */

export const ERROR_CATEGORIES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'CONFLICT',
  'RAILWAY_RATE_LIMITED',
  'RAILWAY_UNAVAILABLE',
  'RAILWAY_GRAPHQL_ERROR',
  'DEPLOYMENT_FAILED',
  'INTERNAL_ERROR',
] as const

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]

/**
 * Whether the *state of the world* is known after this error.
 *
 * This is the distinction spec 05 cares about most. If a deploy request times
 * out mid-flight, we genuinely do not know whether Railway accepted the
 * command, and telling the user "deployment failed" would be a lie. `unknown`
 * means: re-read the state before doing anything else.
 */
export type StateCertainty = 'known' | 'unknown'

interface ControlRoomErrorOptions {
  category: ErrorCategory
  /** Message shown to the user. Must be safe to display and free of upstream detail. */
  message: string
  /** Is retrying the same request reasonable? */
  retryable?: boolean
  /** Do we still know what the infrastructure is doing? */
  certainty?: StateCertainty
  /** Milliseconds to wait before retrying, when the upstream told us. */
  retryAfterMs?: number
  /** Server-side only. Never serialised to the client. */
  diagnostic?: unknown
  cause?: unknown
}

const HTTP_STATUS: Record<ErrorCategory, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  RESOURCE_NOT_FOUND: 404,
  CONFLICT: 409,
  RAILWAY_RATE_LIMITED: 429,
  RAILWAY_UNAVAILABLE: 502,
  RAILWAY_GRAPHQL_ERROR: 502,
  DEPLOYMENT_FAILED: 200, // A reported deployment failure is a valid observation, not a transport error.
  INTERNAL_ERROR: 500,
}

/** Categories where retrying the identical request is safe and sensible. */
const RETRYABLE_BY_DEFAULT = new Set<ErrorCategory>([
  'RAILWAY_RATE_LIMITED',
  'RAILWAY_UNAVAILABLE',
])

export class ControlRoomError extends Error {
  readonly category: ErrorCategory
  readonly retryable: boolean
  readonly certainty: StateCertainty
  readonly retryAfterMs?: number
  /** Server-side diagnostic context. Deliberately not part of the response body. */
  readonly diagnostic?: unknown

  constructor(options: ControlRoomErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ControlRoomError'
    this.category = options.category
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(options.category)
    this.certainty = options.certainty ?? 'known'
    this.retryAfterMs = options.retryAfterMs
    this.diagnostic = options.diagnostic
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.category]
  }

  /** The complete, safe representation sent to the browser. */
  toResponseBody(): {
    error: {
      category: ErrorCategory
      message: string
      retryable: boolean
      certainty: StateCertainty
      retryAfterMs?: number
    }
  } {
    return {
      error: {
        category: this.category,
        message: this.message,
        retryable: this.retryable,
        certainty: this.certainty,
        ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      },
    }
  }
}

export function isControlRoomError(value: unknown): value is ControlRoomError {
  return value instanceof ControlRoomError
}

/**
 * Wrap anything thrown into a `ControlRoomError`.
 *
 * Unrecognised throwables become INTERNAL_ERROR with a generic message; the
 * original is preserved in `diagnostic` for the server log. This is the
 * catch-all that keeps rule 1 true — nothing gets swallowed, and nothing
 * unexpected leaks its text to the user.
 */
export function toControlRoomError(value: unknown): ControlRoomError {
  if (isControlRoomError(value)) return value
  return new ControlRoomError({
    category: 'INTERNAL_ERROR',
    message: 'Something went wrong inside the Control Room. The details were logged server-side.',
    certainty: 'unknown',
    diagnostic: value,
    cause: value,
  })
}

// --- Constructors for the failures this application actually produces ---------
// Each one exists so the wording of a given failure is written once.

export const errors = {
  unauthenticated: (message = 'Your Railway session has expired. Sign in again to continue.') =>
    new ControlRoomError({ category: 'UNAUTHENTICATED', message, retryable: false }),

  forbidden: (message: string, diagnostic?: unknown) =>
    new ControlRoomError({ category: 'FORBIDDEN', message, retryable: false, diagnostic }),

  validation: (message: string, diagnostic?: unknown) =>
    new ControlRoomError({ category: 'VALIDATION_ERROR', message, retryable: false, diagnostic }),

  notFound: (message: string, diagnostic?: unknown) =>
    new ControlRoomError({ category: 'RESOURCE_NOT_FOUND', message, retryable: false, diagnostic }),

  /** A command that is not valid against the current Railway state. */
  conflict: (message: string) =>
    new ControlRoomError({ category: 'CONFLICT', message, retryable: false }),

  rateLimited: (retryAfterMs?: number) =>
    new ControlRoomError({
      category: 'RAILWAY_RATE_LIMITED',
      message:
        'Railway is rate limiting this account. The command was not sent. Wait a moment and try again.',
      retryable: true,
      certainty: 'known',
      retryAfterMs,
    }),

  /**
   * Railway could not be reached, or returned a transport-level failure.
   *
   * `certainty` defaults to 'unknown' because a network failure on a mutation
   * gives us no way to know whether Railway accepted the command. Callers that
   * know the request never left (e.g. a DNS failure before sending) may pass
   * 'known'.
   */
  railwayUnavailable: (diagnostic?: unknown, certainty: StateCertainty = 'unknown') =>
    new ControlRoomError({
      category: 'RAILWAY_UNAVAILABLE',
      message:
        certainty === 'unknown'
          ? 'Railway could not be reached. We do not know whether the command was accepted — refresh the deployment state before retrying.'
          : 'Railway could not be reached. The command was not sent.',
      retryable: true,
      certainty,
      diagnostic,
    }),

  /** Railway answered, but with GraphQL errors in the body. */
  railwayGraphQL: (message: string, diagnostic?: unknown) =>
    new ControlRoomError({
      category: 'RAILWAY_GRAPHQL_ERROR',
      message,
      retryable: false,
      certainty: 'known',
      diagnostic,
    }),

  internal: (diagnostic?: unknown) =>
    new ControlRoomError({
      category: 'INTERNAL_ERROR',
      message: 'Something went wrong inside the Control Room. The details were logged server-side.',
      certainty: 'unknown',
      diagnostic,
    }),
}
