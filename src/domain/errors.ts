/**
 * Error types for the whole app.
 *
 * Two rules: every failure gets a category and a message a developer can act on,
 * and nothing sensitive crosses the boundary. Tokens, the client secret and raw
 * upstream payloads go in `diagnostic`, which stays server-side. `toResponseBody()`
 * is the only thing the browser sees.
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
  'INTERNAL_ERROR',
] as const

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]

/**
 * Whether we still know what the infrastructure is doing.
 *
 * If a deploy request dies mid-flight we don't know whether Railway accepted the
 * command, and saying "deployment failed" would be a lie. 'unknown' means: re-read
 * the state before doing anything else.
 */
export type StateCertainty = 'known' | 'unknown'

interface ControlRoomErrorOptions {
  category: ErrorCategory
  message: string
  retryable?: boolean
  certainty?: StateCertainty
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
  INTERNAL_ERROR: 500,
}

const RETRYABLE_BY_DEFAULT = new Set<ErrorCategory>([
  'RAILWAY_RATE_LIMITED',
  'RAILWAY_UNAVAILABLE',
])

export class ControlRoomError extends Error {
  readonly category: ErrorCategory
  readonly retryable: boolean
  readonly certainty: StateCertainty
  readonly retryAfterMs?: number
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

export const errors = {
  unauthenticated: (message = 'Your Railway session has expired. Sign in again.') =>
    new ControlRoomError({ category: 'UNAUTHENTICATED', message, retryable: false }),

  forbidden: (message: string, diagnostic?: unknown) =>
    new ControlRoomError({ category: 'FORBIDDEN', message, retryable: false, diagnostic }),

  validation: (message: string, diagnostic?: unknown) =>
    new ControlRoomError({ category: 'VALIDATION_ERROR', message, retryable: false, diagnostic }),

  notFound: (message: string, diagnostic?: unknown) =>
    new ControlRoomError({ category: 'RESOURCE_NOT_FOUND', message, retryable: false, diagnostic }),

  conflict: (message: string) =>
    new ControlRoomError({ category: 'CONFLICT', message, retryable: false }),

  rateLimited: (retryAfterMs?: number) =>
    new ControlRoomError({
      category: 'RAILWAY_RATE_LIMITED',
      message: 'Railway is rate limiting this account. The command was not sent. Try again shortly.',
      retryable: true,
      certainty: 'known',
      retryAfterMs,
    }),

  /**
   * Defaults to 'unknown' because a network failure on a mutation tells us nothing
   * about whether Railway accepted it. Pass 'known' only when the request provably
   * never left.
   */
  railwayUnavailable: (diagnostic?: unknown, certainty: StateCertainty = 'unknown') =>
    new ControlRoomError({
      category: 'RAILWAY_UNAVAILABLE',
      message:
        certainty === 'unknown'
          ? 'Railway could not be reached. The command may or may not have been accepted, so refresh before retrying.'
          : 'Railway could not be reached. The command was not sent.',
      retryable: true,
      certainty,
      diagnostic,
    }),

  railwayGraphQL: (message: string, diagnostic?: unknown) =>
    new ControlRoomError({
      category: 'RAILWAY_GRAPHQL_ERROR',
      message,
      retryable: false,
      certainty: 'known',
      diagnostic,
    }),

  internal: (diagnostic?: unknown, cause?: unknown) =>
    new ControlRoomError({
      category: 'INTERNAL_ERROR',
      message: 'Something broke inside the Control Room. Check the server logs.',
      certainty: 'unknown',
      diagnostic,
      cause,
    }),
}

/**
 * Catch-all so nothing gets swallowed and nothing unexpected leaks its text to the user.
 */
export function toControlRoomError(value: unknown): ControlRoomError {
  if (isControlRoomError(value)) return value
  return errors.internal(value, value)
}
