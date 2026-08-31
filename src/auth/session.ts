/**
 * Session and OAuth transaction cookies.
 *
 * Two separate cookies:
 *
 *   rcr_session — the signed-in session. Holds the Railway tokens.
 *   rcr_oauth   — short-lived, holds the PKCE verifier and state between the redirect
 *                 to Railway and the callback.
 *
 * They're separate so starting a new login doesn't disturb an existing session, and so
 * the transaction cookie can be deleted the moment the callback consumes it.
 */

import { getIronSession } from 'iron-session'
import type { IronSession, SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'

import { getConfig, isProduction } from '@/config'

export interface RailwayUser {
  sub: string
  email?: string
  name?: string
}

export interface Session {
  accessToken?: string
  refreshToken?: string
  /** Epoch milliseconds. */
  accessTokenExpiresAt?: number
  user?: RailwayUser
}

export interface OAuthTransaction {
  state?: string
  codeVerifier?: string
  /** Where to send the user once login finishes. Relative paths only. */
  returnTo?: string
}

const SESSION_COOKIE = 'rcr_session'
const OAUTH_COOKIE = 'rcr_oauth'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
const OAUTH_MAX_AGE_SECONDS = 60 * 10

export function sessionOptions(secret: string): SessionOptions {
  return {
    password: secret,
    cookieName: SESSION_COOKIE,
    cookieOptions: {
      httpOnly: true,
      // Off in dev so the flow works over plain http on localhost.
      secure: isProduction(),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  }
}

export function oauthOptions(secret: string): SessionOptions {
  return {
    password: secret,
    cookieName: OAUTH_COOKIE,
    cookieOptions: {
      httpOnly: true,
      secure: isProduction(),
      // 'lax' rather than 'strict': the callback is a cross-site redirect from
      // Railway, and 'strict' would withhold the cookie exactly when we need it.
      sameSite: 'lax',
      path: '/',
      maxAge: OAUTH_MAX_AGE_SECONDS,
    },
  }
}

export async function getSession(): Promise<IronSession<Session>> {
  const cookieStore = await cookies()
  return getIronSession<Session>(cookieStore, sessionOptions(getConfig().sessionSecret))
}

export async function getOAuthTransaction(): Promise<IronSession<OAuthTransaction>> {
  const cookieStore = await cookies()
  return getIronSession<OAuthTransaction>(cookieStore, oauthOptions(getConfig().sessionSecret))
}

export function isSignedIn(session: Session): boolean {
  return typeof session.accessToken === 'string' && session.accessToken.length > 0
}

/**
 * Refresh a minute before the token actually expires, so a request that passes this
 * check doesn't expire in flight.
 */
export const EXPIRY_SKEW_MS = 60_000

export function needsRefresh(session: Session, now: number = Date.now()): boolean {
  if (!isSignedIn(session)) return false
  if (session.accessTokenExpiresAt === undefined) return true
  return session.accessTokenExpiresAt - EXPIRY_SKEW_MS <= now
}

/**
 * Only same-origin relative paths are accepted, so a crafted ?returnTo= can't turn the
 * login route into an open redirect.
 */
export function safeReturnTo(value: string | null): string {
  if (value === null) return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}
