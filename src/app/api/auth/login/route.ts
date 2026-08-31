import { NextResponse } from 'next/server'

import { buildLoginRequest } from '@/auth/oauth'
import { getOAuthTransaction, safeReturnTo } from '@/auth/session'
import { authErrorRedirect } from '../shared'

export async function GET(request: Request) {
  try {
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'))
    const login = await buildLoginRequest()

    const transaction = await getOAuthTransaction()
    transaction.state = login.state
    transaction.codeVerifier = login.codeVerifier
    transaction.returnTo = returnTo
    await transaction.save()

    return NextResponse.redirect(login.url)
  } catch (cause) {
    return authErrorRedirect(cause, 'starting the Railway sign-in')
  }
}
