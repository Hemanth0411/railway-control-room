import { ControlRoom } from './control-room/control-room'
import { getSession, isSignedIn } from '@/auth/session'

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'That sign-in did not complete. Try again.',
  RAILWAY_UNAVAILABLE: 'Railway could not be reached to sign you in. Try again shortly.',
  INTERNAL_ERROR: 'Something broke while signing in. The details are in the server log.',
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>
}) {
  const session = await getSession()

  if (isSignedIn(session) && session.user !== undefined) {
    return <ControlRoom user={session.user} />
  }

  const { auth_error: authError } = await searchParams

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Railway Control Room</h1>
        <p className="mt-3 text-muted">
          Control a Railway deployment without losing sight of its state. Create one Sandbox
          service, deploy it, and watch what Railway actually reports — building, deploying,
          running, failed — with the logs and the controls that match.
        </p>
      </div>

      {authError !== undefined && (
        <p role="alert" className="rounded-md border border-status-bad/40 bg-status-bad/5 px-4 py-3 text-sm text-status-bad">
          {AUTH_ERROR_MESSAGES[authError] ?? 'Sign-in failed. Try again.'}
        </p>
      )}

      <div>
        <a
          href="/api/auth/login"
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-[#0b0d10] hover:bg-[#8bbcff]"
        >
          Sign in with Railway
        </a>
        <p className="mt-3 text-xs text-muted">
          Railway asks which projects to share. This app only sees the ones you pick, and your
          Railway token never reaches the browser.
        </p>
      </div>
    </main>
  )
}
