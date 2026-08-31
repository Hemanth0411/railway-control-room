import { NextResponse } from 'next/server'

import { getSession } from '@/auth/session'
import { getConfig } from '@/config'

/**
 * POST rather than GET so a link or prefetch on another site can't sign the user out.
 *
 * This only clears our session. It does not revoke the grant at Railway - the user
 * revokes that from their Railway account settings.
 */
export async function POST() {
  const session = await getSession()
  session.destroy()
  return NextResponse.redirect(new URL('/', getConfig().baseUrl), { status: 303 })
}
