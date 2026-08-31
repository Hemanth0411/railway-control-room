import { NextResponse } from 'next/server'

import { getSession, isSignedIn } from '@/auth/session'

export async function GET() {
  const session = await getSession()

  if (!isSignedIn(session)) {
    return NextResponse.json({ signedIn: false }, { status: 401 })
  }

  // Identity only. The access token stays server-side.
  return NextResponse.json({ signedIn: true, user: session.user })
}
