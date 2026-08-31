import { NextResponse } from 'next/server'

import { completeLogin, readCallbackError } from '@/auth/oauth'
import { getOAuthTransaction, getSession } from '@/auth/session'
import { getConfig } from '@/config'
import { errors } from '@/domain/errors'
import { authErrorRedirect } from '../shared'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const transaction = await getOAuthTransaction()

  try {
    const denied = readCallbackError(params)
    if (denied !== null) throw denied

    const { state, codeVerifier, returnTo } = transaction

    // No transaction cookie means this callback wasn't started by us, or it's a replay
    // of one we already consumed. Either way there's no verifier to exchange with.
    if (state === undefined || codeVerifier === undefined) {
      throw errors.unauthenticated('That sign-in link has expired. Start again.')
    }

    const { tokens, user } = await completeLogin(params, state, codeVerifier)

    const session = await getSession()
    session.accessToken = tokens.accessToken
    session.refreshToken = tokens.refreshToken
    session.accessTokenExpiresAt = tokens.accessTokenExpiresAt
    session.user = user
    await session.save()

    return NextResponse.redirect(new URL(returnTo ?? '/', getConfig().baseUrl))
  } catch (cause) {
    return authErrorRedirect(cause, 'completing the Railway sign-in')
  } finally {
    // Consume the transaction whatever happened, so a code can't be replayed against it.
    transaction.destroy()
  }
}
