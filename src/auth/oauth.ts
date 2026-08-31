/**
 * Railway OAuth, using openid-client so we aren't writing OAuth cryptography ourselves.
 *
 * Flow: /api/auth/login builds an authorization URL with PKCE + state and stashes both
 * in the rcr_oauth cookie. Railway redirects back to /api/auth/callback, which reads
 * that cookie, exchanges the code, and stores the tokens in rcr_session.
 */

import * as client from 'openid-client'

import { OAUTH_SCOPES, RAILWAY_DISCOVERY_URL, getConfig } from '@/config'
import { errors } from '@/domain/errors'
import type { RailwayUser, Session } from './session'

let configPromise: Promise<client.Configuration> | undefined

/**
 * Discovery is cached for the life of the process. Railway's endpoints don't move, and
 * re-fetching the document on every login would waste a round trip per sign-in.
 */
export function getOidcConfig(): Promise<client.Configuration> {
  if (configPromise === undefined) {
    const { clientId, clientSecret } = getConfig()
    configPromise = client
      .discovery(new URL(RAILWAY_DISCOVERY_URL), clientId, clientSecret, client.ClientSecretPost())
      .catch((cause) => {
        configPromise = undefined
        throw errors.railwayUnavailable(cause, 'known')
      })
  }
  return configPromise
}

export interface LoginRequest {
  url: string
  state: string
  codeVerifier: string
}

export async function buildLoginRequest(): Promise<LoginRequest> {
  const config = await getOidcConfig()
  const { redirectUri } = getConfig()

  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
  const state = client.randomState()

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    // Railway only issues a refresh token when offline_access is paired with this.
    prompt: 'consent',
  })

  return { url: url.href, state, codeVerifier }
}

/**
 * Railway reports a refused or failed consent by redirecting back with ?error=,
 * not by failing the token exchange. Returns null when the callback looks normal.
 */
export function readCallbackError(params: URLSearchParams): Error | null {
  const error = params.get('error')
  if (error === null) return null

  const description = params.get('error_description') ?? undefined

  if (error === 'access_denied') {
    return errors.unauthenticated('You cancelled the Railway sign-in, so nothing was authorized.')
  }
  return errors.unauthenticated(
    description ?? `Railway refused the sign-in (${error}). Try again.`,
  )
}

/**
 * Turn a token response into the fields we keep in the session.
 *
 * Railway may rotate the refresh token. When the response carries a new one we store it;
 * when it doesn't, the existing one stays valid and must be kept, or the next refresh
 * has nothing to use.
 */
export function tokensToSession(
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
  previousRefreshToken: string | undefined,
  now: number = Date.now(),
): Pick<Session, 'accessToken' | 'refreshToken' | 'accessTokenExpiresAt'> {
  const expiresIn = tokens.expiresIn()
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previousRefreshToken,
    accessTokenExpiresAt: expiresIn === undefined ? undefined : now + expiresIn * 1000,
  }
}

export function userFromClaims(claims: client.IDToken | undefined): RailwayUser {
  if (claims === undefined || typeof claims.sub !== 'string') {
    throw errors.unauthenticated('Railway did not return an identity for this sign-in.')
  }
  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    name: typeof claims.name === 'string' ? claims.name : undefined,
  }
}

export interface CompletedLogin {
  tokens: Pick<Session, 'accessToken' | 'refreshToken' | 'accessTokenExpiresAt'>
  user: RailwayUser
}

export async function completeLogin(
  callbackParams: URLSearchParams,
  expectedState: string,
  codeVerifier: string,
): Promise<CompletedLogin> {
  const config = await getOidcConfig()
  const { redirectUri } = getConfig()

  // Rebuild the callback URL from the configured redirect URI rather than the incoming
  // request URL. Behind Railway's proxy the request's host and protocol are the
  // internal ones, which would not match what was sent to the authorization server.
  const currentUrl = new URL(redirectUri)
  currentUrl.search = callbackParams.toString()

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
    idTokenExpected: true,
  })

  return {
    tokens: tokensToSession(tokens, undefined),
    user: userFromClaims(tokens.claims()),
  }
}

export async function refreshTokens(
  refreshToken: string,
): Promise<Pick<Session, 'accessToken' | 'refreshToken' | 'accessTokenExpiresAt'>> {
  const config = await getOidcConfig()
  const tokens = await client.refreshTokenGrant(config, refreshToken)
  return tokensToSession(tokens, refreshToken)
}
