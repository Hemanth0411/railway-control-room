/**
 * Environment configuration, read at call time rather than at import time so a
 * missing variable fails on the request that needs it instead of breaking the build.
 */

export interface AppConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  sessionSecret: string
  baseUrl: string
  sandboxImage: string
}

export const RAILWAY_ISSUER = 'https://backboard.railway.com'

/**
 * Railway does not serve its discovery document at the standard path. The issuer is
 * https://backboard.railway.com, but issuer + /.well-known/openid-configuration is a 404;
 * the document lives under /oauth/. So we pass the full URL rather than letting the
 * client derive it from the issuer.
 */
export const RAILWAY_DISCOVERY_URL =
  'https://backboard.railway.com/oauth/.well-known/openid-configuration'

/** Confirmed against Railway's discovery document. See docs/railway-schema-verification.md. */
export const OAUTH_SCOPES = 'openid email profile offline_access project:member'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local.`)
  }
  return value
}

export function getConfig(): AppConfig {
  const sessionSecret = required('SESSION_SECRET')
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters.')
  }

  return {
    clientId: required('RAILWAY_OAUTH_CLIENT_ID'),
    clientSecret: required('RAILWAY_OAUTH_CLIENT_SECRET'),
    redirectUri: required('RAILWAY_OAUTH_REDIRECT_URI'),
    sessionSecret,
    baseUrl: required('APP_BASE_URL'),
    sandboxImage: required('SANDBOX_IMAGE'),
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}
