import { refreshTokens } from './oauth'
import { getSession, isSignedIn, needsRefresh } from './session'
import { errors } from '@/domain/errors'

/**
 * The single place anything server-side gets a Railway access token.
 *
 * Tokens last an hour, so a session that's been open a while will hand back an expired
 * one. Refreshing here means callers never have to think about expiry, and there's one
 * place where a failed refresh forces re-authentication.
 */
export async function requireAccessToken(): Promise<string> {
  const session = await getSession()

  if (!isSignedIn(session) || session.accessToken === undefined) {
    throw errors.unauthenticated()
  }

  if (!needsRefresh(session)) return session.accessToken

  if (session.refreshToken === undefined) {
    session.destroy()
    throw errors.unauthenticated('Your Railway session expired. Sign in again.')
  }

  try {
    const tokens = await refreshTokens(session.refreshToken)
    if (tokens.accessToken === undefined) {
      throw new Error('refresh returned no access token')
    }
    session.accessToken = tokens.accessToken
    session.refreshToken = tokens.refreshToken
    session.accessTokenExpiresAt = tokens.accessTokenExpiresAt
    await session.save()
    return tokens.accessToken
  } catch (cause) {
    // A refresh token Railway won't accept is not recoverable by retrying, so the
    // session goes. Log the reason: this is the failure that silently signs people out.
    console.error('[auth] token refresh failed:', cause)
    session.destroy()
    throw errors.unauthenticated(
      'Your Railway session expired and could not be renewed. Sign in again.',
    )
  }
}
