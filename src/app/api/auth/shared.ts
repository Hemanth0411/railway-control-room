import { NextResponse } from 'next/server'

import { getConfig } from '@/config'
import { toControlRoomError } from '@/domain/errors'

/**
 * Auth failures happen during a browser redirect, so there's nowhere to return JSON to.
 * We send the user back to the landing page with the error category in the query string
 * and keep the detail in the server log.
 *
 * Only the category travels in the URL, never the upstream message, so nothing
 * attacker-controlled ends up rendered on the page.
 */
export function authErrorRedirect(cause: unknown, whileDoing: string): NextResponse {
  const error = toControlRoomError(cause)
  console.error(`[auth] failed while ${whileDoing}:`, {
    category: error.category,
    message: error.message,
    diagnostic: error.diagnostic,
  })

  const target = new URL('/', getConfig().baseUrl)
  target.searchParams.set('auth_error', error.category)
  return NextResponse.redirect(target)
}
