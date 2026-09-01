/**
 * Shared bits for the API routes: input checks and error responses.
 */

import { NextResponse } from 'next/server'

import { SANDBOX_ACTIONS } from '@/domain/actions'
import type { SandboxAction } from '@/domain/actions'
import { errors, toControlRoomError } from '@/domain/errors'

export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw errors.validation(`Missing ${name}.`)
  }
  return value
}

export function requireAction(value: unknown): SandboxAction {
  if (typeof value !== 'string' || !(SANDBOX_ACTIONS as readonly string[]).includes(value)) {
    throw errors.validation(`Unknown action. Expected one of: ${SANDBOX_ACTIONS.join(', ')}.`)
  }
  return value as SandboxAction
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (body === null || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch (cause) {
    throw errors.validation('Expected a JSON object body.', cause)
  }
}

/**
 * Turns anything thrown into the one response shape the browser sees. The diagnostic
 * stays in the server log; toResponseBody never includes it.
 */
export function errorResponse(cause: unknown): NextResponse {
  const error = toControlRoomError(cause)

  if (error.category === 'INTERNAL_ERROR' || error.category === 'RAILWAY_GRAPHQL_ERROR') {
    console.error('[api]', error.category, error.message, error.diagnostic)
  }

  const response = NextResponse.json(error.toResponseBody(), { status: error.httpStatus })
  if (error.retryAfterMs !== undefined) {
    response.headers.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)))
  }
  return response
}
